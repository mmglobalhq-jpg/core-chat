import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  isDataIntelligenceEnabled,
  isFundsModeEnabled,
  enabledModes,
} from "@/lib/dataIntelligence/flags";

const KEYS = ["DATA_INTELLIGENCE_ENABLED", "DATA_INTELLIGENCE_FUNDS_ENABLED"] as const;

describe("data-intelligence flags", () => {
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

  it("defaults to disabled", () => {
    expect(isDataIntelligenceEnabled()).toBe(false);
    expect(isFundsModeEnabled()).toBe(false);
    expect(enabledModes()).toEqual([]);
  });

  it("master flag alone does not enable funds", () => {
    process.env.DATA_INTELLIGENCE_ENABLED = "true";
    expect(isDataIntelligenceEnabled()).toBe(true);
    expect(isFundsModeEnabled()).toBe(false);
  });

  it("both flags enable funds mode", () => {
    process.env.DATA_INTELLIGENCE_ENABLED = "true";
    process.env.DATA_INTELLIGENCE_FUNDS_ENABLED = "true";
    expect(isFundsModeEnabled()).toBe(true);
    expect(enabledModes()).toEqual(["funds"]);
  });
});
