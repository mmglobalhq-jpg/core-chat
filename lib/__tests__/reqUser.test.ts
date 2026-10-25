import { describe, it, expect, vi, beforeEach } from "vitest";

// requireUser is the real security boundary for every /api/* route that is not
// admin-only. The /funds page's AuthGuard hides the UI from unapproved accounts, but
// signup is open, so a self-registered account can call these routes directly with
// its own Bearer token. These tests pin the server-side approval check.

const getUser = vi.fn();
const maybeSingle = vi.fn();
const eq = vi.fn(() => ({ maybeSingle }));
const select = vi.fn(() => ({ eq }));
const from = vi.fn(() => ({ select }));

vi.mock("@/lib/supabaseAdmin", () => ({
  getSupabaseAdmin: () => ({ auth: { getUser }, from }),
}));

import { requireUser } from "@/lib/reqUser";

function req(token?: string): Request {
  return new Request("https://app/api/x", {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

const USER = { id: "u1", email: "someone@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  getUser.mockResolvedValue({ data: { user: USER }, error: null });
  maybeSingle.mockResolvedValue({ data: { is_approved: true }, error: null });
});

describe("requireUser", () => {
  it("401s without a Bearer token", async () => {
    const gate = await requireUser(req());
    expect("error" in gate && gate.error.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
  });

  it("401s for a token Supabase does not recognise", async () => {
    getUser.mockResolvedValue({ data: { user: null }, error: { message: "bad jwt" } });
    const gate = await requireUser(req("bad"));
    expect("error" in gate && gate.error.status).toBe(401);
  });

  it("admits an approved user and returns them", async () => {
    const gate = await requireUser(req("good"));
    expect(gate).toEqual({ user: USER, token: "good" });
    expect(from).toHaveBeenCalledWith("profiles");
    expect(eq).toHaveBeenCalledWith("id", USER.id);
  });

  it("403s a signed-up but unapproved account", async () => {
    maybeSingle.mockResolvedValue({ data: { is_approved: false }, error: null });
    const gate = await requireUser(req("good"));
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("403s an account with no profile row", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: null });
    const gate = await requireUser(req("good"));
    expect("error" in gate && gate.error.status).toBe(403);
  });

  it("fails closed (503) when the approval lookup itself errors", async () => {
    maybeSingle.mockResolvedValue({ data: null, error: { message: "db down" } });
    const gate = await requireUser(req("good"));
    expect("error" in gate && gate.error.status).toBe(503);
  });
});
