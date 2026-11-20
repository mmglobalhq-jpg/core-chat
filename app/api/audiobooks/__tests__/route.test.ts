import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// The Audiobooks proxy is a catch-all, so what it refuses to forward matters as much as what it forwards:
// it must never become a general proxy into core-heartbeat.

const requireUser = vi.fn();
vi.mock("@/lib/reqUser", () => ({ requireUser: (r: Request) => requireUser(r) }));
const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
  fetchSpy.mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

const JOB = "0123456789abcdef";
const ctx = (path: string[]) => ({ params: Promise.resolve({ path }) });

describe("allowedPath", () => {
  it.each([
    ["GET", ["voices"], "/audiobooks/voices"],
    ["GET", ["voices", "en-US-AndrewNeural", "sample"], "/audiobooks/voices/en-US-AndrewNeural/sample"],
    ["GET", ["jobs"], "/audiobooks/jobs"],
    ["GET", ["jobs", JOB], `/audiobooks/jobs/${JOB}`],
    ["POST", ["jobs"], "/audiobooks/jobs"],
    ["POST", ["jobs", JOB, "confirm"], `/audiobooks/jobs/${JOB}/confirm`],
    ["POST", ["jobs", JOB, "cancel"], `/audiobooks/jobs/${JOB}/cancel`],
    ["POST", ["jobs", JOB, "retry"], `/audiobooks/jobs/${JOB}/retry`],
    ["DELETE", ["jobs", JOB], `/audiobooks/jobs/${JOB}`],
  ])("%s %j -> %s", async (method, parts, want) => {
    const { allowedPath } = await import("@/app/api/audiobooks/[...path]/route");
    expect(allowedPath(method, parts)).toBe(want);
  });

  it.each([
    ["GET", ["voices", "../../uploads", "sample"]],
    ["GET", ["jobs", "../uploads"]],
    ["GET", ["jobs", JOB.toUpperCase()]],
    ["GET", ["jobs", JOB, "confirm"]],
    ["POST", ["jobs", JOB, "delete"]],
    ["POST", ["jobs", JOB, "confirm", "x"]],
    ["DELETE", ["jobs"]],
    ["PUT", ["jobs"]],
    ["GET", ["kb", "documents"]],
    ["GET", []],
  ])("refuses %s %j", async (method, parts) => {
    const { allowedPath } = await import("@/app/api/audiobooks/[...path]/route");
    expect(allowedPath(method, parts)).toBeNull();
  });
});

describe("proxy", () => {
  it("forwards an allowed request with the caller's Bearer token", async () => {
    const { POST } = await import("@/app/api/audiobooks/[...path]/route");
    const res = await POST(
      new Request(`https://app/api/audiobooks/jobs/${JOB}/confirm`, {
        method: "POST",
        headers: { authorization: "Bearer t", "content-type": "application/json" },
        body: JSON.stringify({ voice: "en-US-AndrewNeural" }),
      }),
      ctx(["jobs", JOB, "confirm"]),
    );
    expect(res.status).toBe(200);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url.endsWith(`/audiobooks/jobs/${JOB}/confirm`)).toBe(true);
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer t");
    expect(init.body).toBe(JSON.stringify({ voice: "en-US-AndrewNeural" }));
  });

  it("404s a shape it does not allow, without calling the backend", async () => {
    const { GET } = await import("@/app/api/audiobooks/[...path]/route");
    const res = await GET(new Request("https://app/api/audiobooks/kb/documents"), ctx(["kb", "documents"]));
    expect(res.status).toBe(404);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("passes a backend refusal through", async () => {
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ detail: "admin required" }), { status: 403 }));
    const { GET } = await import("@/app/api/audiobooks/[...path]/route");
    const res = await GET(new Request("https://app/api/audiobooks/jobs"), ctx(["jobs"]));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ detail: "admin required" });
  });

  it("streams a voice sample as audio", async () => {
    fetchSpy.mockResolvedValue(new Response(new Uint8Array([73, 68, 51]), { status: 200 }));
    const { GET } = await import("@/app/api/audiobooks/[...path]/route");
    const res = await GET(
      new Request("https://app/api/audiobooks/voices/en-US-AndrewNeural/sample"),
      ctx(["voices", "en-US-AndrewNeural", "sample"]),
    );
    expect(res.headers.get("content-type")).toBe("audio/mpeg");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([73, 68, 51]));
  });
});
