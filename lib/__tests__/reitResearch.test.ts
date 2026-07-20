import { describe, it, expect, vi, beforeEach } from "vitest";
import { makeFakeReitsClient, SAMPLE, SAMPLE_NO_ORC, REPORT_IDS } from "@/lib/__tests__/reitFake";

// The real supabaseReits module throws under jsdom (browser guard); mock it so the
// data layer runs against the in-memory RPC fake instead.
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
  it("returns ARR and ORC with names + latest date", async () => {
    const issuers = await listIssuers();
    const symbols = issuers.map((i) => i.symbol);
    expect(symbols).toEqual(["ARR", "ORC"]);

    const arr = issuers.find((i) => i.symbol === "ARR")!;
    expect(arr.name).toBe("ARMOUR Residential REIT");
    expect(arr.latestReportDate).toBe("2026-05-31");
    expect(arr.reportCount).toBe(2);

    const orc = issuers.find((i) => i.symbol === "ORC")!;
    expect(orc.name).toBe("Orchid Island Capital, Inc.");
    expect(orc.reportCount).toBe(1);
  });

  it("omits ORC when it has no completed reports", async () => {
    holder.client = makeFakeReitsClient(SAMPLE_NO_ORC);
    const symbols = (await listIssuers()).map((i) => i.symbol);
    expect(symbols).toEqual(["ARR"]);
    expect(symbols).not.toContain("ORC");
  });
});

describe("listReports", () => {
  it("returns completed current reports newest first with namespaced ids", async () => {
    const reports = await listReports("ARR");
    expect(reports.map((r) => r.id)).toEqual([REPORT_IDS.ARR_A, REPORT_IDS.ARR_B]);
    expect(reports.map((r) => r.portfolioDate)).toEqual(["2026-05-31", "2026-04-30"]);
  });

  it("returns ORC reports with orc: ids", async () => {
    const reports = await listReports("ORC");
    expect(reports.map((r) => r.id)).toEqual([REPORT_IDS.ORC_A]);
    expect(reports[0].issuerName).toBe("Orchid Island Capital, Inc.");
  });

  it("excludes superseded current versions and non-completed reports", async () => {
    const ids = (await listReports("ARR")).map((r) => r.id);
    expect(ids).not.toContain(REPORT_IDS.ARR_SUP);
    expect(ids).not.toContain(REPORT_IDS.ARR_GEN);
  });

  it("uses the stored title, else a deterministic fallback", async () => {
    const byId = new Map((await listReports("ARR")).map((r) => [r.id, r]));
    expect(byId.get(REPORT_IDS.ARR_A)!.title).toBe("ARR adds $466mm to portfolio in May");
    expect(byId.get(REPORT_IDS.ARR_B)!.title).toBe(
      "ARMOUR Residential REIT — April 2026 Monthly Report",
    );
  });

  it("carries publication date + version", async () => {
    const reports = await listReports("ARR");
    const a = reports.find((r) => r.id === REPORT_IDS.ARR_A)!;
    expect(a.publicationDate).toBe("2026-06-12");
    const b = reports.find((r) => r.id === REPORT_IDS.ARR_B)!;
    expect(b.version).toBe(2);
  });

  it("returns an empty list for an issuer with no completed reports", async () => {
    expect(await listReports("QQQ")).toEqual([]);
    expect(await listReports("NOPE")).toEqual([]);
  });
});

describe("getReport", () => {
  it("returns the completed current report with its full body", async () => {
    const detail = await getReport(REPORT_IDS.ARR_A);
    expect(detail).not.toBeNull();
    expect(detail!.id).toBe(REPORT_IDS.ARR_A);
    expect(detail!.issuerSymbol).toBe("ARR");
    expect(detail!.bodyMarkdown).toContain("# Executive summary");
  });

  it("resolves orc: and arr: for a colliding UUID without ambiguity", async () => {
    const arr = await getReport(REPORT_IDS.ARR_A);
    const orc = await getReport(REPORT_IDS.ORC_A);
    expect(arr!.issuerSymbol).toBe("ARR");
    expect(arr!.bodyMarkdown).toContain("# Executive summary");
    expect(orc!.issuerSymbol).toBe("ORC");
    expect(orc!.bodyMarkdown).toBe("# ORC body");
  });

  it("treats a bare UUID as legacy ARR only (never ORC)", async () => {
    const detail = await getReport(REPORT_IDS.UUID_A);
    expect(detail!.issuerSymbol).toBe("ARR");
    expect(detail!.bodyMarkdown).toContain("# Executive summary");
  });

  it("returns null for superseded, non-current, and unknown ids", async () => {
    expect(await getReport(REPORT_IDS.ARR_SUP)).toBeNull();
    expect(await getReport(REPORT_IDS.ARR_GEN)).toBeNull();
    expect(await getReport("arr:00000000-0000-4000-8000-000000000000")).toBeNull();
  });
});

describe("validators", () => {
  it("normalizes + accepts valid issuer symbols", () => {
    expect(validateIssuerSymbol("arr")).toBe("ARR");
    expect(validateIssuerSymbol("orc")).toBe("ORC");
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

  it("accepts namespaced + legacy report ids and normalizes them", () => {
    expect(validateReportId(REPORT_IDS.ARR_A.toUpperCase())).toBe(REPORT_IDS.ARR_A);
    expect(validateReportId(REPORT_IDS.ORC_A)).toBe(REPORT_IDS.ORC_A);
    expect(validateReportId(REPORT_IDS.UUID_A.toUpperCase())).toBe(REPORT_IDS.UUID_A);
  });

  it("rejects malformed report ids with a 400", () => {
    for (const bad of ["", "not-a-uuid", "123", "xyz:" + REPORT_IDS.UUID_A, "arr:nope", "select *"]) {
      try {
        validateReportId(bad);
        throw new Error(`expected reject for ${bad}`);
      } catch (e) {
        expect((e as ReitServiceError).httpStatus).toBe(400);
      }
    }
  });
});
