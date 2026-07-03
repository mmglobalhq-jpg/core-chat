import { describe, expect, it } from "vitest";
import {
  MODEL_OPTIONS,
  canSend,
  isModelId,
  mockReply,
  seedConversations,
} from "@/lib/mock-data";

describe("canSend (FR-018, SC-005)", () => {
  it("is false for an empty string", () => {
    expect(canSend("")).toBe(false);
  });

  it("is false for whitespace-only input", () => {
    expect(canSend("   ")).toBe(false);
    expect(canSend("\n\t  \n")).toBe(false);
  });

  it("is true for any non-whitespace text", () => {
    expect(canSend("hi")).toBe(true);
    expect(canSend("   padded   ")).toBe(true);
  });
});

describe("mockReply (FR-014)", () => {
  it("returns an assistant message with non-empty content", () => {
    const reply = mockReply("hello");
    expect(reply.role).toBe("assistant");
    expect(reply.content.trim().length).toBeGreaterThan(0);
  });

  it("is deterministic for the same input", () => {
    expect(mockReply("same").content).toBe(mockReply("same").content);
  });
});

describe("model options (FR-010)", () => {
  it("exposes exactly the three named models", () => {
    expect(MODEL_OPTIONS.map((m) => m.label)).toEqual([
      "Gemini 2.5 Flash",
      "Claude Haiku 4.5",
      "GPT-4o Mini",
    ]);
  });

  it("validates model ids", () => {
    expect(isModelId("gpt-5.5")).toBe(true);
    expect(isModelId("not-a-model")).toBe(false);
  });
});

describe("seedConversations (FR-023)", () => {
  it("returns at least one sample conversation with messages", () => {
    const seeded = seedConversations();
    expect(seeded.length).toBeGreaterThanOrEqual(1);
    expect(seeded[0].messages.length).toBeGreaterThan(0);
  });
});
