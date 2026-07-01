import { create } from "zustand";
import type { Conversation, Message, ModelId } from "@/lib/types";
import {
  DEFAULT_MODEL_ID,
  createId,
  isModelId,
  seedConversations,
} from "@/lib/mock-data";

interface ChatStore {
  // Model selection (US3 / FR-010, FR-011)
  selectedModelId: ModelId;
  setSelectedModel: (id: ModelId) => void;

  // Conversations / mock history (US2 / FR-007, FR-008, FR-023)
  conversations: Conversation[];
  activeConversationId: string | null;

  newConversation: () => void;
  selectConversation: (id: string) => void;
  appendMessage: (conversationId: string, message: Message) => void;

  // Derived helper
  activeConversation: () => Conversation | null;
}

function blankConversation(order: number): Conversation {
  return { id: createId("conv"), title: "New chat", messages: [], updatedAt: order };
}

const seeded = seedConversations();
// Open on a fresh, blank conversation so the first paint shows the empty-state
// hero. Prior mock conversations remain available in the sidebar history; the
// blank one is hidden from that list until it has messages (see Sidebar).
const initialConversation = blankConversation(seeded.length + 1);

export const useChatStore = create<ChatStore>((set, get) => ({
  selectedModelId: DEFAULT_MODEL_ID,

  setSelectedModel: (id) => {
    // Guard: only accept one of the fixed MODEL_OPTIONS ids.
    if (!isModelId(id)) return;
    set({ selectedModelId: id });
  },

  conversations: [initialConversation, ...seeded],
  activeConversationId: initialConversation.id,

  newConversation: () => {
    const conversation = blankConversation(get().conversations.length + 1);
    set((state) => ({
      conversations: [conversation, ...state.conversations],
      activeConversationId: conversation.id,
    }));
  },

  selectConversation: (id) => {
    const exists = get().conversations.some((c) => c.id === id);
    if (!exists) return;
    set({ activeConversationId: id });
  },

  appendMessage: (conversationId, message) => {
    set((state) => ({
      conversations: state.conversations.map((c) =>
        c.id === conversationId
          ? {
              ...c,
              messages: [...c.messages, message],
              updatedAt: c.messages.length + 1,
              title:
                c.title === "New chat" && message.role === "user"
                  ? deriveTitle(message.content)
                  : c.title,
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

function deriveTitle(content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) return "New chat";
  return trimmed.length > 40 ? `${trimmed.slice(0, 40)}…` : trimmed;
}
