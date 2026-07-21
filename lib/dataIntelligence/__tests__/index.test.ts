import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { getQueryDataToolDefinition } from "@/lib/dataIntelligence";

describe("getQueryDataToolDefinition (tool exposure gate)", () => {
  const KEYS = ["DATA_INTELLIGENCE_ENABLED", "DATA_INTELLIGENCE_FUNDS_ENABLED"] as const;
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const k of KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });

  it("returns null when disabled (no tool exposed to the chat model)", () => {
    expect(getQueryDataToolDefinition()).toBeNull();
    process.env.DATA_INTELLIGENCE_ENABLED = "true"; // master only
    expect(getQueryDataToolDefinition()).toBeNull();
  });

  it("exposes only funds mode when enabled", () => {
    process.env.DATA_INTELLIGENCE_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_FUNDS_ENABLED = "true";
    const def = getQueryDataToolDefinition();
    expect(def?.name).toBe("query_data");
    expect((def?.input_schema as { properties: { mode: { enum: string[] } } }).properties.mode.enum).toEqual([
      "funds",
    ]);
  });
});
