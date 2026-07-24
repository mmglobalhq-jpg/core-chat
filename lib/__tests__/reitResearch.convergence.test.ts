/**
 * Regression: after the backend report-determinism convergence, the REIT data layer must
 * resolve the CURRENT version of each report and never surface a superseded revision.
 *
 * Verified production state this locks in:
 *   - ORC latest 2026-06-30 resolves as version 3 (completed).
 *   - ARR latest 2026-05-31 resolves as version 1 (completed).
 *   - Superseded ORC v1/v2 are never presented as current.
 *   - Report lists are ordered newest portfolio-date first.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeFakeReitsClient, SAMPLE_CONVERGED, CONVERGED_IDS } from "@/lib/__tests__/reitFake";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabaseReits", () => ({ getSupabaseReits: () => holder.client }));

import { listIssuers, listReports, getReport } from "@/lib/reitResearch";

beforeEach(() => {
  holder.client = makeFakeReitsClient(SAMPLE_CONVERGED);
});

describe("post-convergence current-version resolution", () => {
  it("resolves ORC 2026-06-30 as version 3 (newest, current)", async () => {
    const reports = await listReports("ORC");
    expect(reports[0].portfolioDate).toBe("2026-06-30");
    expect(reports[0].version).toBe(3);
    const detail = await getReport(CONVERGED_IDS.ORC_JUN_V3);
    expect(detail).not.toBeNull();
    expect(detail!.version).toBe(3);
    expect(detail!.bodyMarkdown).toBe("# ORC June 2026 — v3 canonical body");
  });

  it("resolves ARR 2026-05-31 as version 1 (current)", async () => {
    const reports = await listReports("ARR");
    expect(reports[0].portfolioDate).toBe("2026-05-31");
    expect(reports[0].version).toBe(1);
    const detail = await getReport(CONVERGED_IDS.ARR_MAY_V1);
    expect(detail!.version).toBe(1);
  });

  it("never presents superseded ORC v1/v2 as current", async () => {
    const orc = await listReports("ORC");
    // No listed ORC report is at a superseded version, and the 2026-06-30 period appears once.
    expect(orc.every((r) => r.version === 3)).toBe(true);
    expect(orc.filter((r) => r.portfolioDate === "2026-06-30")).toHaveLength(1);
    // The superseded revisions resolve to nothing through the detail path.
    expect(await getReport(CONVERGED_IDS.ORC_JUN_V2)).toBeNull();
    expect(await getReport(CONVERGED_IDS.ORC_JUN_V1)).toBeNull();
  });

  it("orders reports newest portfolio-date first", async () => {
    const orc = await listReports("ORC");
    expect(orc.map((r) => r.portfolioDate)).toEqual(["2026-06-30", "2026-05-31"]);
  });

  it("reports the converged issuer catalog (ORC latest 2026-06-30, ARR latest 2026-05-31)", async () => {
    const issuers = await listIssuers();
    const orc = issuers.find((i) => i.symbol === "ORC")!;
    const arr = issuers.find((i) => i.symbol === "ARR")!;
    expect(orc.latestReportDate).toBe("2026-06-30");
    expect(arr.latestReportDate).toBe("2026-05-31");
  });
});
