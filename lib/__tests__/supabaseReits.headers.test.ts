// @vitest-environment node
/**
 * Pins the REQUEST HEADERS the installed @supabase/supabase-js actually sends for a
 * REITS reader-contract RPC, using a mocked fetch. No network, no real key.
 *
 * Why this exists: Supabase secret keys (`sb_secret_*`) are OPAQUE, not JWTs. A
 * hand-rolled request must send them in `apikey` only — duplicating one into
 * `Authorization: Bearer` can be rejected as an invalid JWT (that is why
 * core-heartbeat's raw httpx client sends `apikey` alone).
 *
 * The SDK path is different: `createClient(url, sb_secret_*)` is the documented
 * server-side migration pattern, and this SDK version sends BOTH `apikey` and
 * `Authorization: Bearer <key>`. We do not suppress that — there is no supported
 * mechanism to, and Supabase supports the pattern. We pin it instead, so an SDK
 * upgrade that changes the header contract fails here and forces a live re-validation
 * against the project before it reaches production.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Synthetic, opaque, and shaped like a secret key. NEVER a real credential.
const SYNTHETIC_KEY = "sb_secret_synthetic_test_value";
const SYNTHETIC_URL = "https://synthetic.invalid";

type Captured = { headers: Record<string, string>; url: string; method?: string };

async function captureRpcRequest(key = SYNTHETIC_KEY): Promise<Captured> {
  let captured: Captured | null = null;

  const mockFetch = vi.fn(async (url: unknown, init: Record<string, unknown> = {}) => {
    captured = {
      url: String(url),
      method: init.method as string | undefined,
      headers: Object.fromEntries(new Headers((init.headers ?? {}) as HeadersInit).entries()),
    };
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  vi.stubGlobal("fetch", mockFetch);
  vi.resetModules(); // the module memoizes its client; force a fresh one per case
  process.env.REITS_SUPABASE_SERVICE_ROLE_KEY = key;
  const { getSupabaseReits } = await import("@/lib/supabaseReits");
  await getSupabaseReits().rpc("reit_research_list_issuers_v1", {});

  if (!captured) throw new Error("no request captured");
  return captured;
}

describe("supabaseReits request headers (mocked fetch)", () => {
  let savedUrl: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedUrl = process.env.REITS_SUPABASE_URL;
    savedKey = process.env.REITS_SUPABASE_SERVICE_ROLE_KEY;
    process.env.REITS_SUPABASE_URL = SYNTHETIC_URL;
    process.env.REITS_SUPABASE_SERVICE_ROLE_KEY = SYNTHETIC_KEY;
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.REITS_SUPABASE_URL;
    else process.env.REITS_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.REITS_SUPABASE_SERVICE_ROLE_KEY;
    else process.env.REITS_SUPABASE_SERVICE_ROLE_KEY = savedKey;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("sends the configured key in the apikey header", async () => {
    const { headers } = await captureRpcRequest();
    expect(headers["apikey"]).toBe(SYNTHETIC_KEY);
  });

  it("passes an opaque sb_secret_* value through unparsed", async () => {
    // No decoding, splitting, or JWT validation may happen to the key.
    const { headers } = await captureRpcRequest();
    expect(headers["apikey"]).toBe(SYNTHETIC_KEY);
    expect(headers["apikey"]).not.toContain(".");
  });

  it("targets the reader-contract RPC path", async () => {
    const { url } = await captureRpcRequest();
    expect(url).toBe(`${SYNTHETIC_URL}/rest/v1/rpc/reit_research_list_issuers_v1`);
  });

  it("PINS the SDK Authorization behavior — change here means re-validate live", async () => {
    // Current @supabase/supabase-js mirrors the key into Authorization: Bearer.
    // This is the documented createClient(url, sb_secret_*) migration pattern, so we
    // record it rather than fight it. If an upgrade flips this, do NOT just update
    // the expectation: re-run the live REITS canaries first.
    const { headers } = await captureRpcRequest();
    expect(headers["authorization"]).toBe(`Bearer ${SYNTHETIC_KEY}`);
  });

  it("does not special-case key shape (opaque and JWT-shaped behave identically)", async () => {
    const opaque = await captureRpcRequest(SYNTHETIC_KEY);
    const jwtShaped = await captureRpcRequest("eyJhbGciOiJIUzI1NiJ9.eyJyIjoic3ZjIn0.sig");
    expect(Object.keys(opaque.headers).sort()).toEqual(Object.keys(jwtShaped.headers).sort());
  });

  it("never reads a real env file — credentials come from process.env only", async () => {
    vi.resetModules();
    delete process.env.REITS_SUPABASE_URL;
    delete process.env.REITS_SUPABASE_SERVICE_ROLE_KEY;
    const { getSupabaseReits } = await import("@/lib/supabaseReits");
    expect(() => getSupabaseReits()).toThrow(/Missing REITS_SUPABASE_URL/);
  });
});
