// @vitest-environment node
/**
 * Tests for GET /api/reits/reports/[reportId]/pdf.
 *
 * Separate from `routes.test.ts` because PDFKit needs the node environment (real
 * Buffers and streams), while the other REIT route tests run under jsdom.
 *
 * The auth gate and the server-only REIT client are mocked; the real validators,
 * data layer, error mapping and PDF renderer all run — so a 200 here means bytes
 * were genuinely produced from the faked report, not that a stub was returned.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";

import { makeFakeReitsClient, REPORT_IDS, SAMPLE } from "@/lib/__tests__/reitFake";

const requireUser = vi.fn();
vi.mock("@/lib/reqUser", () => ({ requireUser: (req: Request) => requireUser(req) }));

const holder = vi.hoisted(() => ({ client: null as unknown, fail: false }));
vi.mock("@/lib/supabaseReits", () => ({
  getSupabaseReits: () => {
    if (holder.fail) throw new Error("Missing REITS_SUPABASE_URL / REITS_SUPABASE_SERVICE_ROLE_KEY");
    return holder.client;
  },
}));

import { GET as pdfGET } from "@/app/api/reits/reports/[reportId]/pdf/route";

function call(reportId: string) {
  const url = `https://app/api/reits/reports/${encodeURIComponent(reportId)}/pdf`;
  return pdfGET(new Request(url, { headers: { authorization: "Bearer test-token" } }), {
    params: Promise.resolve({ reportId }),
  });
}

beforeEach(() => {
  requireUser.mockReset();
  requireUser.mockResolvedValue({ user: { id: "u1" }, token: "t" });
  holder.client = makeFakeReitsClient(SAMPLE);
  holder.fail = false;
});

describe("GET /api/reits/reports/[reportId]/pdf", () => {
  it("returns 401 when unauthenticated — a report must not be downloadable anonymously", async () => {
    requireUser.mockResolvedValue({
      error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    });
    const res = await call(REPORT_IDS.ARR_A);
    expect(res.status).toBe(401);
  });

  it("returns real PDF bytes for a current report", async () => {
    const res = await call(REPORT_IDS.ARR_A);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    const buf = Buffer.from(await res.arrayBuffer());
    expect(buf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(buf.toString("latin1").trimEnd().endsWith("%%EOF")).toBe(true);
    expect(Number(res.headers.get("Content-Length"))).toBe(buf.byteLength);
  });

  it("asks the browser to download it, under a name derived from the report", async () => {
    const res = await call(REPORT_IDS.ARR_A);
    const cd = res.headers.get("Content-Disposition") ?? "";
    expect(cd).toMatch(/^attachment; filename="arr-\d{4}-\d{2}-\d{2}(-v\d+)?\.pdf"$/);
  });

  it("is never cached — reports are revised in place", async () => {
    const res = await call(REPORT_IDS.ARR_A);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });

  it("works for ORC as well as ARR, so the button is not issuer-specific", async () => {
    const res = await call(REPORT_IDS.ORC_A);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toMatch(/filename="orc-/);
  });

  it("returns 400 for a malformed report id", async () => {
    const res = await call("not-a-uuid");
    expect(res.status).toBe(400);
    expect(res.headers.get("Content-Type")).toMatch(/json/);
  });

  it("returns 404 for an unknown or superseded report", async () => {
    expect((await call("arr:00000000-0000-4000-8000-000000000000")).status).toBe(404);
    expect((await call(REPORT_IDS.ARR_SUP)).status).toBe(404);
  });

  it("answers a failure with JSON, not a broken PDF", async () => {
    // A truncated or error-bodied `application/pdf` would download as a corrupt
    // file; the client reads `error` from the body instead.
    holder.fail = true;
    const res = await call(REPORT_IDS.ARR_A);
    expect(res.status).toBe(502);
    expect(res.headers.get("Content-Type")).toMatch(/json/);
    const body = await res.json();
    expect(body.error).toBeTruthy();
    expect(JSON.stringify(body)).not.toMatch(/REITS_SUPABASE|service_role|key/i);
  });
});
