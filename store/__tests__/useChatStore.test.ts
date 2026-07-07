import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  useChatStore,
  shouldAutoTitle,
  deriveTitle,
} from "@/store/useChatStore";
import { seedConversations } from "@/lib/mock-data";
import { loadMessages } from "@/lib/chatHistory";
import type { Conversation, Message, Role } from "@/lib/types";

// Keep chatHistory real (its fns short-circuit with no session) but make
// loadMessages controllable so we can reproduce the lazy-load race in C-1.
vi.mock("@/lib/chatHistory", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/chatHistory")>()),
  loadMessages: vi.fn(async () => [] as Message[]),
}));

// Snapshot the store's true initial state at import time, before beforeEach
// mutates it. Zustand replaces the state object on setState, so this reference
// keeps the original blank-on-load values.
const INITIAL_STATE = useChatStore.getState();

describe("initial state (blank-on-load)", () => {
  it("opens on a blank active conversation with no messages", () => {
    const active = INITIAL_STATE.conversations.find(
      (c) => c.id === INITIAL_STATE.activeConversationId,
    );
    expect(active).toBeDefined();
    expect(active?.messages).toEqual([]);
  });

  it("starts with only a fresh blank conversation (history loads from Supabase)", () => {
    // No mock seeds in the store anymore — real per-user history is hydrated via
    // hydrateForUser(); the store opens on a single empty, unpersisted chat.
    expect(INITIAL_STATE.conversations).toHaveLength(1);
    expect(INITIAL_STATE.conversations[0].persisted).toBe(false);
    expect(INITIAL_STATE.conversations[0].messages).toEqual([]);
  });
});

// Reset to a known seeded state before each test.
beforeEach(() => {
  const seeded = seedConversations();
  useChatStore.setState({
    selectedModelId: "gemini-2.5-flash",
    conversations: seeded,
    activeConversationId: seeded[0].id,
  });
});

describe("selectConversation lazy-load reconciliation (C-1)", () => {
  it("does not clobber a turn appended while the DB load is in flight", async () => {
    let resolveLoad!: (m: Message[]) => void;
    (loadMessages as ReturnType<typeof vi.fn>).mockImplementationOnce(
      () => new Promise<Message[]>((res) => (resolveLoad = res)),
    );
    const persisted: Conversation = {
      id: "persisted-1",
      title: "Old chat",
      messages: [],
      updatedAt: 0,
      persisted: true,
      loaded: false,
    };
    useChatStore.setState({
      conversations: [persisted],
      activeConversationId: "persisted-1",
    });

    useChatStore.getState().selectConversation("persisted-1"); // kicks off load
    // user sends before the load resolves
    useChatStore.getState().appendMessage("persisted-1", {
      id: "new-1",
      role: "user",
      content: "hi",
      createdAt: 1,
    });
    // DB load now resolves with the prior history
    resolveLoad([{ id: "db-1", role: "user", content: "old", createdAt: 0 }]);
    await Promise.resolve();
    await Promise.resolve();

    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === "persisted-1")!;
    const contents = conv.messages.map((m) => m.content);
    expect(contents).toContain("hi"); // appended turn survived (not clobbered)
    expect(contents).toContain("old"); // db history present
    expect(conv.loaded).toBe(true);
  });
});

describe("newConversation (US2 / FR-007)", () => {
  it("prepends an empty conversation and makes it active", () => {
    const before = useChatStore.getState().conversations.length;
    useChatStore.getState().newConversation();

    const state = useChatStore.getState();
    expect(state.conversations.length).toBe(before + 1);
    expect(state.conversations[0].messages).toEqual([]);
    expect(state.activeConversationId).toBe(state.conversations[0].id);
  });
});

describe("selectConversation (US2 / FR-008)", () => {
  it("sets the active conversation id for a known conversation", () => {
    const target = useChatStore.getState().conversations[2];
    useChatStore.getState().selectConversation(target.id);
    expect(useChatStore.getState().activeConversationId).toBe(target.id);
  });

  it("ignores unknown conversation ids", () => {
    const current = useChatStore.getState().activeConversationId;
    useChatStore.getState().selectConversation("does-not-exist");
    expect(useChatStore.getState().activeConversationId).toBe(current);
  });
});

describe("hideConversation", () => {
  it("removes a non-active conversation from the list and keeps the active one", () => {
    const state = useChatStore.getState();
    const active = state.activeConversationId;
    const victim = state.conversations.find((c) => c.id !== active)!;
    useChatStore.getState().hideConversation(victim.id);

    const after = useChatStore.getState();
    expect(after.conversations.some((c) => c.id === victim.id)).toBe(false);
    expect(after.activeConversationId).toBe(active);
  });

  it("falls back to a fresh blank conversation when the active chat is hidden", () => {
    const active = useChatStore.getState().activeConversationId!;
    useChatStore.getState().hideConversation(active);

    const after = useChatStore.getState();
    expect(after.conversations.some((c) => c.id === active)).toBe(false);
    // A new blank conversation becomes active.
    expect(after.activeConversationId).not.toBe(active);
    const head = after.conversations[0];
    expect(head.id).toBe(after.activeConversationId);
    expect(head.messages).toEqual([]);
  });
});

describe("shouldAutoTitle (fire once at the 2nd exchange)", () => {
  const m = (role: Role, content: string): Message => ({
    id: `${role}-${content}`,
    role,
    content,
    createdAt: 0,
  });
  const conv = (messages: Message[], extra: Partial<Conversation> = {}): Conversation => {
    const firstUser = messages.find((x) => x.role === "user");
    return {
      id: "c",
      title: deriveTitle(firstUser?.content ?? "New chat"),
      messages,
      updatedAt: 0,
      ...extra,
    };
  };
  const two = [
    m("user", "Museums in DC?"),
    m("assistant", "The Smithsonian is great."),
    m("user", "Which is best?"),
    m("assistant", "Air and Space."),
  ];

  it("fires at exactly two completed assistant replies", () => {
    expect(shouldAutoTitle(conv(two))).toBe(true);
  });

  it("does not fire after only one exchange", () => {
    expect(shouldAutoTitle(conv(two.slice(0, 2)))).toBe(false);
  });

  it("does not fire after three exchanges", () => {
    expect(
      shouldAutoTitle(conv([...two, m("user", "more"), m("assistant", "sure")])),
    ).toBe(false);
  });

  it("does not fire when already titled", () => {
    expect(shouldAutoTitle(conv(two, { titled: true }))).toBe(false);
  });

  it("does not fire when the title was already changed off the auto default", () => {
    expect(shouldAutoTitle(conv(two, { title: "Custom Title" }))).toBe(false);
  });

  it("ignores empty assistant replies when counting", () => {
    const withEmpty = [
      m("user", "Museums in DC?"),
      m("assistant", ""),
      m("user", "Which is best?"),
      m("assistant", "Air and Space."),
    ];
    expect(shouldAutoTitle(conv(withEmpty))).toBe(false); // only 1 real reply
  });
});

describe("setConversationTitle", () => {
  it("updates the title and flags it titled", () => {
    const id = useChatStore.getState().conversations[0].id;
    useChatStore.getState().setConversationTitle(id, "DC Museums");
    const c = useChatStore.getState().conversations.find((x) => x.id === id);
    expect(c?.title).toBe("DC Museums");
    expect(c?.titled).toBe(true);
  });
});

describe("setSelectedModel (US3 / FR-010, FR-011)", () => {
  it("updates the selected model for a valid id", () => {
    useChatStore.getState().setSelectedModel("gpt-5.5");
    expect(useChatStore.getState().selectedModelId).toBe("gpt-5.5");
  });

  it("rejects ids outside the fixed model set", () => {
    // @ts-expect-error deliberately passing an invalid id to assert the guard
    useChatStore.getState().setSelectedModel("claude-x");
    expect(useChatStore.getState().selectedModelId).toBe("gemini-2.5-flash");
  });
});

describe("appendMessage (FR-013/FR-014)", () => {
  it("appends a message and derives a title for a new chat", () => {
    useChatStore.getState().newConversation();
    const convId = useChatStore.getState().conversations[0].id;
    useChatStore.getState().appendMessage(convId, {
      id: "m1",
      role: "user",
      content: "What is the capital of France?",
      createdAt: 1,
    });
    const conv = useChatStore
      .getState()
      .conversations.find((c) => c.id === convId);
    expect(conv?.messages.length).toBe(1);
    expect(conv?.title).toContain("What is the capital");
  });
});

