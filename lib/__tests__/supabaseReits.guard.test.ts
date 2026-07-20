import { describe, it, expect } from "vitest";

/**
 * Security boundary: the server-only REIT client must refuse to load in a browser
 * context. Under jsdom `window` is defined, so importing the module throws before
 * any client is built or any REITS_SUPABASE_* value is read — the runtime backstop
 * that keeps the service-role key out of any client bundle.
 */
describe("supabaseReits server-only guard", () => {
  it("throws if imported in a browser context", async () => {
    await expect(import("@/lib/supabaseReits")).rejects.toThrow(/server-only/);
  });
});
