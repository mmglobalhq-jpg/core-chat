import { describe, expect, it } from "vitest";
import { routeMessage } from "@/lib/router";
import type { ModelTier } from "@/lib/types";

const TIERS: ModelTier[] = ["flash", "pro", "reasoning"];

describe("routeMessage (FR-024, FR-025, FR-029, SC-009)", () => {
  it("returns a complete, correctly-typed payload", async () => {
    const p = await routeMessage("Hello there");
    expect(typeof p.primary_action).toBe("string");
    expect(p.primary_action.length).toBeGreaterThan(0);
    expect(typeof p.requires_tools).toBe("boolean");
    expect(Array.isArray(p.entities)).toBe(true);
    expect(p.entities.every((e) => typeof e === "string")).toBe(true);
    expect(TIERS).toContain(p.model_tier);
  });

  it("is deterministic for the same input", async () => {
    const a = await routeMessage("Summarize the Q3 report for Acme");
    const b = await routeMessage("Summarize the Q3 report for Acme");
    expect(a).toEqual(b);
  });

  it("sets requires_tools=true when the text implies a tool/action", async () => {
    const p = await routeMessage("search the web for today's weather");
    expect(p.requires_tools).toBe(true);
  });

  it("sets requires_tools=false for a plain conversational message", async () => {
    const p = await routeMessage("how are you doing today");
    expect(p.requires_tools).toBe(false);
  });

  it("extracts de-duplicated entities from capitalized tokens", async () => {
    const p = await routeMessage("Email Alice and Alice about Berlin");
    expect(p.entities).toContain("Alice");
    // de-duplicated
    expect(p.entities.filter((e) => e === "Alice").length).toBe(1);
    expect(p.entities).toContain("Berlin");
  });

  it("classifies a trailing-question as a question action", async () => {
    const p = await routeMessage("What is the capital of France?");
    expect(p.primary_action).toBe("question");
  });

  it("classifies a leading imperative verb as that action", async () => {
    const p = await routeMessage("Write a haiku about the sea");
    expect(p.primary_action).toBe("write");
  });
});
