import { create } from "zustand";
import type { Conversation, IntentPayload, Message, ModelId } from "@/lib/types";
import { DEFAULT_MODEL_ID, createId, isModelId } from "@/lib/mock-data";
import {
  deleteChat,
  ensureChat,
  insertMessage,
  listChats,
  loadMessages,
  renameChat,
} from "@/lib/chatHistory";

interface ChatStore {
  // Model selection (US3 / FR-010, FR-011)
  selectedModelId: ModelId;
  setSelectedModel: (id: ModelId) => void;

  // Conversations / persisted history (US2 / FR-007, FR-008, FR-023)
  conversations: Conversation[];
  activeConversationId: string | null;

  newConversation: () => void;
  selectConversation: (id: string) => void;
  appendMessage: (conversationId: string, message: Message) => void;
  deleteConversation: (id: string) => void;
  /** Apply an (LLM-generated) title: update state, flag titled, persist via RLS. */
  setConversationTitle: (id: string, title: string) => void;

  /** Load the signed-in user's chats from Supabase (call on mount / user change). */
  hydrateForUser: () => Promise<void>;

  // Intent routing (amendment / FR-024, FR-028)
  attachIntent: (
    conversationId: string,
    messageId: string,
    payload: IntentPayload,
  ) => void;

  // Derived helper
  activeConversation: () => Conversation | null;
}

/** Prefer a real UUID (so it maps 1:1 onto the Supabase `chats.id` uuid column);
 * fall back to the counter id only in environments without WebCrypto (tests). */
function newChatId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return createId("conv");
}

function blankConversation(): Conversation {
  return {
    id: newChatId(),
    title: "New chat",
    messages: [],
    updatedAt: Date.now(),
    persisted: false, // no DB row until the first message is sent
    loaded: true, // nothing to hydrate — it's empty
  };
}

// --- Supabase write plumbing (best-effort, never surfaced to the UI) --------
// Per-conversation promise chains serialize writes so ensureChat() lands before
// its first insertMessage() (FK order) and turns persist in submission order.
const writeChains = new Map<string, Promise<void>>();
// Conversations already known to have a `chats` row (fetched or ensured), so we
// don't re-issue the idempotent upsert on every turn.
const ensured = new Set<string>();

function persistTurn(convId: string, title: string, message: Message) {
  const prev = writeChains.get(convId) ?? Promise.resolve();
  const next = prev
    .then(async () => {
      if (!ensured.has(convId)) {
        await ensureChat(convId, title);
        ensured.add(convId);
      }
      await insertMessage(convId, message);
    })
    .catch(() => {
      // Best-effort persistence: a failed write must never break the live chat.
      // Allow a later turn to retry ensureChat by clearing the flag.
      ensured.delete(convId);
    });
  writeChains.set(convId, next);
}

const initialConversation = blankConversation();

export const useChatStore = create<ChatStore>((set, get) => ({
  selectedModelId: DEFAULT_MODEL_ID,

  setSelectedModel: (id) => {
    // Guard: only accept one of the fixed MODEL_OPTIONS ids.
    if (!isModelId(id)) return;
    set({ selectedModelId: id });
  },

  // Open on a fresh blank conversation; real history is loaded from Supabase by
  // hydrateForUser() once the auth session is known (see useChatSync).
  conversations: [initialConversation],
  activeConversationId: initialConversation.id,

  newConversation: () => {
    const conversation = blankConversation();
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
    }));
  },

  selectConversation: (id) => {
    const conv = get().conversations.find((c) => c.id === id);
    if (!conv) return; // ignore unknown ids (FR-008)
    set({ activeConversationId: id });
    // Lazily hydrate a persisted conversation's messages on first open. The
    // `loaded` flip re-runs the feed effect in page.tsx (keyed on it).
    if (conv.persisted && !conv.loaded) {
      void loadMessages(id).then((messages) => {
        set((state) => ({
          conversations: state.conversations.map((c) =>
            c.id === id ? { ...c, messages, loaded: true } : c,
          ),
        }));
      });
    }
  },

  appendMessage: (conversationId, message) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              updatedAt: Date.now(),
              // Optimistically show in history immediately; the row is written
              // below (lazily created on the first user turn).
              persisted: true,
              title:
                c.title === "New chat" && message.role === "user"
                  ? deriveTitle(message.content)
                  : c.title,
            }
          : c,
      ),
    }));
    // Persist this turn (best-effort, serialized per conversation).
    const conv = get().conversations.find((c) => c.id === conversationId);
    if (conv) persistTurn(conversationId, conv.title, message);
  },

  setConversationTitle: (id, title) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === id ? { ...c, title, titled: true } : c,
      ),
    }));
    void renameChat(id, title); // best-effort persist (RLS-scoped)
  },

  deleteConversation: (id) => {
    void deleteChat(id); // best-effort; messages cascade via FK. RLS-scoped.
    ensured.delete(id);
    writeChains.delete(id);
    set((state) => {
      const remaining = state.conversations.filter((c) => c.id !== id);
      if (state.activeConversationId !== id) {
        return {
          conversations: remaining,
          activeConversationId: state.activeConversationId,
        };
      }
      // Deleting the active chat: fall back to a fresh blank one.
      const blank = blankConversation();
      return { conversations: [blank, ...remaining], activeConversationId: blank.id };
    });
  },

  hydrateForUser: async () => {
    const chats = await listChats(); // [] when signed out
    const fetched: Conversation[] = chats.map((c) => ({
      id: c.id,
      title: c.title,
      messages: [],
      updatedAt: Date.parse(c.updated_at) || 0,
      persisted: true,
      loaded: false,
    }));
    fetched.forEach((c) => ensured.add(c.id)); // rows already exist
    set((state) => {
      // Preserve an in-progress conversation (already has messages) across a
      // hydrate; otherwise start fresh on a blank one.
      const current = state.conversations.find(
        (c) => c.id === state.activeConversationId,
      );
      const keepCurrent = !!current && current.messages.length > 0;
      const head = keepCurrent ? current! : blankConversation();
      const rest = keepCurrent
        ? fetched.filter((c) => c.id !== current!.id)
        : fetched;
      return { conversations: [head, ...rest], activeConversationId: head.id };
    });
  },

  attachIntent: (conversationId, messageId, payload) => {
    // No-op if the conversation or message is gone (graceful — FR-028).
    // Does not touch message order, updatedAt, or the reply flow. In-memory
    // only for now — see the chat-history plan re: the DB intent column.
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: c.messages.map((m) =>
                m.id === messageId ? { ...m, intent: payload } : m,
              ),
            }
          : c,
      ),
    }));
  },

  activeConversation: () => {
    const { conversations, activeConversationId } = get();
    return conversations.find((c) => c.id === activeConversationId) ?? null;
  },
}));

// Development-only debug handle (stripped from production builds). Lets tooling
// inspect store state (e.g. attached intent payloads) at runtime.
if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
  (window as unknown as { __chatStore?: typeof useChatStore }).__chatStore =
    useChatStore;
}

export function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return "New chat";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}

/**
 * Whether a conversation is due for an LLM-generated title: exactly two completed
 * assistant replies (the 2nd exchange), not already titled, and the title is still
 * the auto default (the blank "New chat" or the first-message-derived stand-in) —
 * so a title the user/LLM already set is never overwritten. Pure + exported so the
 * page trigger stays testable.
 */
export function shouldAutoTitle(conversation: Conversation): boolean {
  if (conversation.titled) return false;
  const assistantReplies = conversation.messages.filter(
    (m) => m.role === "assistant" && m.content.trim().length > 0,
  ).length;
  if (assistantReplies !== 2) return false; // fire once, at the 2nd exchange
  const firstUser = conversation.messages.find((m) => m.role === "user");
  const autoTitle = firstUser ? deriveTitle(firstUser.content) : "New chat";
  return conversation.title === "New chat" || conversation.title === autoTitle;
}
