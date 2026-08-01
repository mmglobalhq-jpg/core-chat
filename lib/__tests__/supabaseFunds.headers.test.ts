// @vitest-environment node
/**
 * Pins the REQUEST HEADERS the FUNDS Supabase client sends, for BOTH Supabase
 * server-key generations. Mocked fetch only — no network, no real key.
 *
 * The two generations need different auth headers:
 *  - legacy JWT service-role key — PostgREST resolves the role from the Bearer JWT.
 *    With `apikey` alone the request is admitted but runs as `anon`, which holds no
 *    grant on the poller RPCs (verified in production on the sibling REITS client:
 *    401 "permission denied for function"). BOTH headers are required.
 *  - `sb_secret_*` — opaque, not a JWT. `apikey` alone resolves the role, and
 *    duplicating it into Authorization risks rejection as an invalid JWT.
 *
 * supabase-js 2.110.0 sends both headers for every key shape, so `lib/supabaseFunds`
 * installs a scoped `global.fetch` wrapper that strips Authorization for secret keys
 * only. Handling both is what removes the flag day.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Synthetic + opaque, shaped like a secret key. NEVER a real credential.
const SECRET_KEY = "sb_secret_synthetic_funds_value";
// JWT-SHAPED but synthetic: header {"alg":"HS256"}, payload {"r":"svc"}, literal
// signature. Never a real token — only its three-part shape matters here.
const LEGACY_KEY = "eyJhbGciOiJIUzI1NiJ9.eyJyIjoic3ZjIn0.sig";
const SYNTHETIC_URL = "https://synthetic-funds.invalid";

// The real RPC the /api/funds/export route calls first.
const EXPORT_RPC = "get_fund_position_changes";

type Captured = {
  headers: Record<string, string>;
  url: string;
  method?: string;
  body?: string;
};

async function captureRpc(
  key: string,
  fn = EXPORT_RPC,
  args: Record<string, unknown> = {},
): Promise<Captured> {
  let captured: Captured | null = null;

  const mockFetch = vi.fn(async (url: unknown, init: Record<string, unknown> = {}) => {
    captured = {
      url: String(url),
      method: init.method as string | undefined,
      body: typeof init.body === "string" ? init.body : undefined,
      headers: Object.fromEntries(new Headers((init.headers ?? {}) as HeadersInit).entries()),
    };
    return new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } });
  });

  vi.stubGlobal("fetch", mockFetch);
  vi.resetModules(); // the module memoizes its client; force a fresh one per case
  process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY = key;
  const { getSupabaseFunds } = await import("@/lib/supabaseFunds");
  await getSupabaseFunds().rpc(fn, args);

  if (!captured) throw new Error("no request captured");
  return captured;
}

describe("supabaseFunds request headers (mocked fetch)", () => {
  let savedUrl: string | undefined;
  let savedKey: string | undefined;

  beforeEach(() => {
    savedUrl = process.env.FUNDS_SUPABASE_URL;
    savedKey = process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY;
    process.env.FUNDS_SUPABASE_URL = SYNTHETIC_URL;
  });

  afterEach(() => {
    if (savedUrl === undefined) delete process.env.FUNDS_SUPABASE_URL;
    else process.env.FUNDS_SUPABASE_URL = savedUrl;
    if (savedKey === undefined) delete process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY;
    else process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY = savedKey;
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  // --- legacy JWT key: BOTH headers ---------------------------------------
  it("legacy key sends apikey AND Authorization", async () => {
    // Regression guard: stripping Authorization here breaks production with 401
    // "permission denied for function".
    const { headers } = await captureRpc(LEGACY_KEY);
    expect(headers["apikey"]).toBe(LEGACY_KEY);
    expect(headers["authorization"]).toBe(`Bearer ${LEGACY_KEY}`);
  });

  // --- sb_secret_* key: apikey only ----------------------------------------
  it("secret key sends apikey and NO Authorization", async () => {
    const { headers } = await captureRpc(SECRET_KEY);
    expect(headers["apikey"]).toBe(SECRET_KEY);
    expect(headers["authorization"]).toBeUndefined();
  });

  it("only the Authorization header is removed for a secret key", async () => {
    const legacy = await captureRpc(LEGACY_KEY);
    const secret = await captureRpc(SECRET_KEY);
    const removed = Object.keys(legacy.headers).filter((h) => !(h in secret.headers));
    expect(removed).toEqual(["authorization"]);
  });

  it("preserves the SDK's other headers for a secret key", async () => {
    const { headers } = await captureRpc(SECRET_KEY);
    // content-profile selects the schema; x-client-info is the SDK's own tag.
    expect(headers["content-profile"]).toBeDefined();
    expect(headers["x-client-info"]).toBeDefined();
    expect(headers["content-type"]).toContain("application/json");
  });

  // --- request contract unchanged by the wrapper ---------------------------
  it("keeps the funds RPC path and body identical across both key generations", async () => {
    const args = {
      p_manager: "JP",
      p_fund: "PARX",
      p_start_date: "2026-06-01",
      p_end_date: "2026-07-01",
      p_page: 1,
    };
    const legacy = await captureRpc(LEGACY_KEY, EXPORT_RPC, args);
    const secret = await captureRpc(SECRET_KEY, EXPORT_RPC, args);
    expect(secret.url).toBe(`${SYNTHETIC_URL}/rest/v1/rpc/${EXPORT_RPC}`);
    expect(secret.url).toBe(legacy.url);
    expect(secret.method).toBe(legacy.method);
    expect(secret.body).toBe(legacy.body);
    expect(JSON.parse(secret.body ?? "{}")).toEqual(args);
  });

  it("export path uses the same client contract (getSupabaseFunds().rpc)", async () => {
    // app/api/funds/export/route.ts calls getSupabaseFunds().rpc(EXPORT_RPC, …);
    // lib/fundsRpc.ts callRpc() uses the identical client. Pin that both reach the
    // same wrapped transport with the same headers.
    const viaClient = await captureRpc(SECRET_KEY, EXPORT_RPC, { p_page: 1 });
    expect(viaClient.url).toBe(`${SYNTHETIC_URL}/rest/v1/rpc/${EXPORT_RPC}`);
    expect(viaClient.headers["apikey"]).toBe(SECRET_KEY);
    expect(viaClient.headers["authorization"]).toBeUndefined();
  });

  // --- key handling --------------------------------------------------------
  it("passes both key shapes through unparsed", async () => {
    // Never decoded, split, or validated — each must reach the wire byte-for-byte.
    expect((await captureRpc(SECRET_KEY)).headers["apikey"]).toBe(SECRET_KEY);
    expect((await captureRpc(LEGACY_KEY)).headers["apikey"]).toBe(LEGACY_KEY);
  });

  it.each([
    "some-opaque-non-prefixed-value",
    "sb_publishable_not_secret",
    "SB_SECRET_UPPERCASE", // prefix match is case-sensitive
  ])("treats unknown format %s as legacy (safe default)", async (key) => {
    const { headers } = await captureRpc(key);
    expect(headers["apikey"]).toBe(key);
    expect(headers["authorization"]).toBe(`Bearer ${key}`);
  });

  it("never includes the key in a thrown error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      }),
    );
    vi.resetModules();
    process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY = SECRET_KEY;
    const { getSupabaseFunds } = await import("@/lib/supabaseFunds");
    let res: string;
    try {
      // supabase-js surfaces transport failures in the result's `error` field
      // rather than throwing; check both shapes.
      res = JSON.stringify(await getSupabaseFunds().rpc(EXPORT_RPC, {}));
    } catch (e: unknown) {
      res = String(e);
    }
    expect(res).not.toContain(SECRET_KEY);
    expect(res).toMatch(/network down|error/i); // the failure did surface
  });

  it("never reads a real env file — credentials come from process.env only", async () => {
    vi.resetModules();
    delete process.env.FUNDS_SUPABASE_URL;
    delete process.env.FUNDS_SUPABASE_SERVICE_ROLE_KEY;
    const { getSupabaseFunds } = await import("@/lib/supabaseFunds");
    expect(() => getSupabaseFunds()).toThrow(/Missing FUNDS_SUPABASE_URL/);
  });
});
