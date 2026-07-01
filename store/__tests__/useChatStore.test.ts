import { beforeEach, describe, expect, it } from "vitest";
import { useChatStore } from "@/store/useChatStore";
import { seedConversations } from "@/lib/mock-data";

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

  it("keeps prior mock conversations available for history browsing", () => {
    const withMessages = INITIAL_STATE.conversations.filter(
      (c) => c.messages.length > 0,
    );
    expect(withMessages.length).toBeGreaterThanOrEqual(1);
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
