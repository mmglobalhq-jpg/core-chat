import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { NextResponse } from "next/server";

// Every /api route is reachable from the internet (chat.mmglobal.us has no Cloudflare
// Access in front of it) and signup is open. Until 2026-10-25 nine proxy routes
// forwarded straight to core-heartbeat without checking anything, and heartbeat maps a
// missing or unverifiable token to its sandbox user — so anyone could drive paid model
// calls (/api/intent, /api/title, /api/kb/chat), document parsing and KB ingest, and
// any signed-up but unapproved account could do so as itself.

const requireUser = vi.fn();
vi.mock("@/lib/reqUser", () => ({ requireUser: (r: Request) => requireUser(r) }));

const fetchSpy = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  requireUser.mockResolvedValue({
    error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
  });
  vi.stubGlobal("fetch", fetchSpy);
});
afterEach(() => vi.unstubAllGlobals());

type Handler = (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>;
const ctx = { params: Promise.resolve({ id: "x" }) };

function post(path: string, body: unknown, headers: Record<string, string> = {}): Request {
  return new Request(`https://app${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

const CASES: [string, () => Promise<Handler>, () => Request][] = [
  ["POST /api/intent", async () => (await import("@/app/api/intent/route")).POST as Handler,
    () => post("/api/intent", { text: "hello" })],
  ["POST /api/title", async () => (await import("@/app/api/title/route")).POST as Handler,
    () => post("/api/title", { messages: [{ role: "user", content: "hi" }] })],
  ["POST /api/documents", async () => (await import("@/app/api/documents/route")).POST as Handler,
    () => post("/api/documents", { doc_id: "d", filename: "f.pdf" })],
  ["POST /api/uploads", async () => (await import("@/app/api/uploads/route")).POST as Handler,
    () => post("/api/uploads", "x", { "x-upload-filename": "f.txt" })],
  ["GET /api/uploads", async () => (await import("@/app/api/uploads/route")).GET as Handler,
    () => new Request("https://app/api/uploads")],
  ["DELETE /api/uploads", async () => (await import("@/app/api/uploads/route")).DELETE as Handler,
    () => new Request("https://app/api/uploads?name=f.txt", { method: "DELETE" })],
  ["POST /api/kb/chat", async () => (await import("@/app/api/kb/chat/route")).POST as Handler,
    () => post("/api/kb/chat", { message: "hi", history: [] })],
  ["POST /api/kb/ingest", async () => (await import("@/app/api/kb/ingest/route")).POST as Handler,
    () => post("/api/kb/ingest", { doc_id: "d", filename: "f" })],
  ["GET /api/kb/documents", async () => (await import("@/app/api/kb/documents/route")).GET as Handler,
    () => new Request("https://app/api/kb/documents")],
  ["DELETE /api/kb/documents/[id]",
    async () => (await import("@/app/api/kb/documents/[id]/route")).DELETE as Handler,
    () => new Request("https://app/api/kb/documents/x", { method: "DELETE" })],
  ["GET /api/kb/jobs/[id]", async () => (await import("@/app/api/kb/jobs/[id]/route")).GET as Handler,
    () => new Request("https://app/api/kb/jobs/x")],
];

describe("backend proxy routes refuse unauthenticated or unapproved callers", () => {
  it.each(CASES)("%s → 401, and the backend is never called", async (_name, load, make) => {
    const handler = await load();
    const res = await handler(make(), ctx);
    expect(res.status).toBe(401);
    expect(requireUser).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("an approved user still reaches the backend", async () => {
    requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
    fetchSpy.mockResolvedValue(new Response(JSON.stringify({ documents: [] }), { status: 200 }));
    const { GET } = await import("@/app/api/kb/documents/route");
    const res = await GET(new Request("https://app/api/kb/documents", {
      headers: { authorization: "Bearer t" },
    }));
    expect(res.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

// --------------------------------------------------------------------------- //
// Structural guard: a NEW route must not ship ungated by accident.
// --------------------------------------------------------------------------- //

// Routes that are deliberately not behind requireUser/requireAdmin, and why.
const UNGATED_ALLOWLIST: Record<string, string> = {
  "integrations/google/callback/route.ts":
    "OAuth redirect from Google carries no Bearer token; protected by the HMAC-signed `state` (verifyState)",
};

function routeFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (name === "__tests__") continue;
    if (statSync(p).isDirectory()) out.push(...routeFiles(p));
    else if (name === "route.ts") out.push(p);
  }
  return out;
}

describe("every /api route is gated", () => {
  const apiDir = join(process.cwd(), "app", "api");
  const files = routeFiles(apiDir);

  it("finds the routes (guards against a vacuous pass)", () => {
    expect(files.length).toBeGreaterThan(25);
  });

  it.each(files.map((f) => [relative(apiDir, f), f]))("%s", (rel, file) => {
    const src = readFileSync(file, "utf8");
    if (UNGATED_ALLOWLIST[rel]) {
      expect(src).not.toMatch(/requireUser|requireAdmin/);
      return;
    }
    const handlers = src.match(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g) ?? [];
    const gates = src.match(/await require(User|Admin)\(/g) ?? [];
    expect(handlers.length).toBeGreaterThan(0);
    // One gate call per exported handler.
    expect(gates.length).toBeGreaterThanOrEqual(handlers.length);
  });
});
