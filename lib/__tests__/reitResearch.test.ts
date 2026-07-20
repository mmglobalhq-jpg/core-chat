import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeReitsClient, SAMPLE, REPORT_IDS } from "@/lib/__tests__/reitFake";

// The real supabaseReits module throws under jsdom (browser guard); mock it so the
// data layer runs against the in-memory fake instead.
const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabaseReits", () => ({ getSupabaseReits: () => holder.client }));

import {
  listIssuers,
  listReports,
  getReport,
  validateIssuerSymbol,
  validateReportId,
  ReitServiceError,
} from "@/lib/reitResearch";

beforeEach(() => {
  holder.client = makeFakeReitsClient(SAMPLE);
});

describe("listIssuers (data-driven)", () => {
  it("returns only issuers that have completed reports, with names + latest date", async () => {
    const issuers = await listIssuers();
    const symbols = issuers.map((i) => i.symbol);
    expect(symbols).toContain("ARR");
    expect(symbols).toContain("XYZ"); // second issuer surfaces automatically
    expect(symbols).not.toContain("QQQ"); // only a needs_review report -> absent

    const arr = issuers.find((i) => i.symbol === "ARR")!;
    expect(arr.name).toBe("ARMOUR Residential REIT");
    expect(arr.latestReportDate).toBe("2026-05-31");
    expect(arr.reportCount).toBeGreaterThanOrEqual(3);

    const xyz = issuers.find((i) => i.symbol === "XYZ")!;
    expect(xyz.name).toBe("XYZ"); // unknown code falls back to the code itself
  });
});

describe("listReports", () => {
  it("returns completed current reports newest first", async () => {
    const reports = await listReports("ARR");
    expect(reports.map((r) => r.id)).toEqual([REPORT_IDS.A, REPORT_IDS.B, REPORT_IDS.C]);
    expect(reports.map((r) => r.portfolioDate)).toEqual(["2026-05-31", "2026-04-30", "2026-03-31"]);
  });

  it("excludes superseded current versions and non-completed reports", async () => {
    const reports = await listReports("ARR");
    const ids = reports.map((r) => r.id);
    expect(ids).not.toContain(REPORT_IDS.SUP); // current version is superseded
    expect(ids).not.toContain(REPORT_IDS.GEN); // report is still generating
    expect(reports.some((r) => r.title.includes("SUPERSEDED"))).toBe(false);
  });

  it("uses the stored headline as the title, else a deterministic fallback", async () => {
    const reports = await listReports("ARR");
    const byId = new Map(reports.map((r) => [r.id, r]));
    expect(byId.get(REPORT_IDS.A)!.title).toBe("ARR adds $466mm to portfolio in May");
    // v-b has no headline -> fallback from issuer + period, not a pipeline timestamp.
    expect(byId.get(REPORT_IDS.B)!.title).toBe("ARMOUR Residential REIT — April 2026 Monthly Report");
  });

  it("carries publication date + version", async () => {
    const reports = await listReports("ARR");
    const a = reports.find((r) => r.id === REPORT_IDS.A)!;
    expect(a.publicationDate).toBe("2026-06-12");
    const c = reports.find((r) => r.id === REPORT_IDS.C)!;
    expect(c.version).toBe(2);
  });

  it("returns an empty list for an issuer with no completed reports", async () => {
    expect(await listReports("QQQ")).toEqual([]);
    expect(await listReports("NOPE")).toEqual([]);
  });
});

describe("getReport", () => {
  it("returns the completed current report with its full body", async () => {
    const detail = await getReport(REPORT_IDS.A);
    expect(detail).not.toBeNull();
    expect(detail!.title).toBe("ARR adds $466mm to portfolio in May");
    expect(detail!.issuerSymbol).toBe("ARR");
    expect(detail!.issuerName).toBe("ARMOUR Residential REIT");
    expect(detail!.publicationDate).toBe("2026-06-12");
    expect(detail!.bodyMarkdown).toContain("# Executive summary");
  });

  it("returns null when the current version is superseded (never serves it)", async () => {
    expect(await getReport(REPORT_IDS.SUP)).toBeNull();
  });

  it("returns null for a non-completed report and for an unknown id", async () => {
    expect(await getReport(REPORT_IDS.GEN)).toBeNull();
    expect(await getReport("00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("validators", () => {
  it("normalizes + accepts valid issuer symbols", () => {
    expect(validateIssuerSymbol("arr")).toBe("ARR");
    expect(validateIssuerSymbol("ARR")).toBe("ARR");
  });

  it("rejects malformed issuer symbols with a 400", () => {
    for (const bad of ["", "a b", "AR-R", "TOOLONGSYMBOL", "'; DROP"]) {
      try {
        validateIssuerSymbol(bad);
        throw new Error(`expected reject for ${bad}`);
      } catch (e) {
        expect(e).toBeInstanceOf(ReitServiceError);
        expect((e as ReitServiceError).httpStatus).toBe(400);
      }
    }
  });

  it("accepts + normalizes UUID report ids and rejects others", () => {
    expect(validateReportId(REPORT_IDS.A.toUpperCase())).toBe(REPORT_IDS.A);
    for (const bad of ["", "not-a-uuid", "123", "select *"]) {
      try {
        validateReportId(bad);
        throw new Error(`expected reject for ${bad}`);
      } catch (e) {
        expect((e as ReitServiceError).httpStatus).toBe(400);
      }
    }
  });
});
