/**
 * The isolation property for the briefing API.
 *
 * These routes use the service-role client, which BYPASSES RLS. The database
 * policies therefore protect nothing here — the `.eq("user_id", …)` filter, keyed
 * to the id from the verified token, is the entire control. If it were dropped,
 * or keyed to an id from the request, every user's briefing would be readable by
 * every other user and no test of the database would notice.
 *
 * So these tests assert on the query the route builds, not on its output.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const eqCalls: Array<[string, unknown]> = [];
const upsertCalls: Array<Record<string, unknown>> = [];
let currentUser: { id: string } | null = { id: "user-a" };

const builder = {
  select: vi.fn(() => builder),
  eq: vi.fn((column: string, value: unknown) => {
    eqCalls.push([column, value]);
    return builder;
  }),
  order: vi.fn(() => builder),
  limit: vi.fn(() => builder),
  maybeSingle: vi.fn(async () => ({ data: null, error: null })),
  upsert: vi.fn(async (row: Record<string, unknown>) => {
    upsertCalls.push(row);
    return { error: null };
  }),
  then: undefined as unknown,
};

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ from: () => builder }),
}));

vi.mock("@/lib/reqUser", () => ({
  requireUser: async () =>
    currentUser
      ? { user: currentUser, token: "t" }
      : { error: new Response(null, { status: 401 }) },
}));

// The select chain is awaited directly, so the builder must be thenable.
Object.defineProperty(builder, "then", {
  value: (resolve: (v: unknown) => void) => resolve({ data: [], error: null }),
  writable: true,
});

beforeEach(() => {
  eqCalls.length = 0;
  upsertCalls.length = 0;
  currentUser = { id: "user-a" };
  vi.clearAllMocks();
});

describe("GET /api/briefing", () => {
  it("filters by the caller's own id", async () => {
    const { GET } = await import("@/app/api/briefing/route");
    await GET(new Request("http://localhost/api/briefing"));
    expect(eqCalls).toContainEqual(["user_id", "user-a"]);
  });

  it("ignores a user_id supplied in the query string", async () => {
    // The attack this prevents: ?user_id=someone-else.
    const { GET } = await import("@/app/api/briefing/route");
    await GET(new Request("http://localhost/api/briefing?user_id=user-b"));
    const userFilters = eqCalls.filter(([column]) => column === "user_id");
    expect(userFilters).toEqual([["user_id", "user-a"]]);
  });

  it("rejects a malformed date instead of passing it to the database", async () => {
    const { GET } = await import("@/app/api/briefing/route");
    const res = await GET(new Request("http://localhost/api/briefing?date=2026-13-99x"));
    expect(res.status).toBe(400);
  });

  it("returns 401 when the caller is not signed in", async () => {
    currentUser = null;
    const { GET } = await import("@/app/api/briefing/route");
    const res = await GET(new Request("http://localhost/api/briefing"));
    expect(res.status).toBe(401);
  });
});

describe("PUT /api/briefing/prefs", () => {
  const put = async (body: unknown) => {
    const { PUT } = await import("@/app/api/briefing/prefs/route");
    return PUT(
      new Request("http://localhost/api/briefing/prefs", {
        method: "PUT",
        body: JSON.stringify(body),
      }),
    );
  };

  it("writes the caller's id, not one from the body", async () => {
    await put({ user_id: "user-b", enabled: true, deliver_at: "07:00" });
    expect(upsertCalls[0].user_id).toBe("user-a");
  });

  it("rejects a malformed time", async () => {
    expect((await put({ deliver_at: "25:99" })).status).toBe(400);
  });

  it("rejects an unknown timezone", async () => {
    expect((await put({ deliver_at: "07:00", timezone: "Mars/Olympus" })).status).toBe(400);
  });

  it("rejects an invalid email address", async () => {
    expect((await put({ deliver_at: "07:00", email_to: "not-an-email" })).status).toBe(400);
  });

  it("caps the number of topics", async () => {
    await put({ deliver_at: "07:00", topics: Array.from({ length: 50 }, (_, i) => `t${i}`) });
    expect((upsertCalls[0].topics as string[]).length).toBeLessThanOrEqual(12);
  });

  it("drops non-string topics rather than storing them", async () => {
    await put({ deliver_at: "07:00", topics: ["ok", 42, null, { a: 1 }] });
    expect(upsertCalls[0].topics).toEqual(["ok"]);
  });
});
