import { beforeEach, describe, expect, it, vi } from "vitest";

const calls = vi.hoisted(() => ({ list: [] as string[], ensure: [] as string[], insert: [] as unknown[] }));

vi.mock("@/lib/chatHistory", () => ({
  getUserId: async () => "user-1",
  listChats: async (kind: string) => {
    calls.list.push(kind);
    return [{ id: `${kind}-chat`, title: `${kind} chat`, created_at: "", updated_at: "2026-09-17T00:00:00Z" }];
  },
  ensureChat: async (_uid: string, _id: string, _title: string, kind: string) => {
    calls.ensure.push(kind);
  },
  insertMessage: async (_uid: string, _chat: string, message: unknown) => {
    calls.insert.push(message);
  },
  loadMessages: async () => [],
  renameChat: async () => {},
  hideChat: async () => {},
}));

import { createChatStore } from "@/store/useChatStore";

beforeEach(() => {
  calls.list.length = 0;
  calls.ensure.length = 0;
  calls.insert.length = 0;
});

const settle = () => new Promise((r) => setTimeout(r, 0));

describe("per-kind chat stores", () => {
  it("each store loads and creates only its own kind of chat", async () => {
    const main = createChatStore("main");
    const knowledge = createChatStore("knowledge");
    await main.getState().hydrateForUser();
    await knowledge.getState().hydrateForUser();
    expect(calls.list).toEqual(["main", "knowledge"]);
    expect(main.getState().conversations.map((c) => c.id)).toContain("main-chat");
    expect(knowledge.getState().conversations.map((c) => c.id)).not.toContain("main-chat");

    const conv = knowledge.getState().activeConversationId!;
    knowledge.getState().appendMessage(conv, { id: "u1", role: "user", content: "q", createdAt: 1 });
    await settle();
    expect(calls.ensure).toEqual(["knowledge"]);
  });

  it("persists an answer's cited sources with it", async () => {
    const store = createChatStore("knowledge");
    const conv = store.getState().activeConversationId!;
    store.getState().appendMessage(conv, { id: "u1", role: "user", content: "q", createdAt: 1 });
    store.getState().beginAssistantMessage(conv, { id: "a1", role: "assistant", content: "", createdAt: 2 });
    const sources = [{ n: 1, document_id: "d1", title: "Doc", chunk_index: 3, excerpt: "x" }];
    store.getState().finalizeAssistantMessage(conv, "a1", "Answer [1].", sources);
    await settle();
    await settle();

    const saved = calls.insert.at(-1) as { id: string; content: string; sources?: unknown };
    expect(saved).toMatchObject({ id: "a1", content: "Answer [1].", sources });
    expect(store.getState().conversations[0].messages.at(-1)?.sources).toEqual(sources);
  });
});
