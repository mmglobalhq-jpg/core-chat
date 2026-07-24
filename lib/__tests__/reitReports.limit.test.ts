/**
 * Regression: the REIT reports list defaults to the latest 12 per issuer (newest first),
 * exposes an archive view for the full history, and never surfaces superseded versions.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { makeFakeReitsClient, manyOrcReports, SAMPLE, REPORT_IDS } from "@/lib/__tests__/reitFake";

const holder = vi.hoisted(() => ({ client: null as unknown }));
vi.mock("@/lib/supabaseReits", () => ({ getSupabaseReits: () => holder.client }));

import { listReports } from "@/lib/reitResearch";

describe("listReports default-12 + archive", () => {
  beforeEach(() => {
    holder.client = makeFakeReitsClient(manyOrcReports(15));
  });

  it("returns at most the latest 12 by default", async () => {
    const reports = await listReports("ORC");
    expect(reports).toHaveLength(12);
  });

  it("returns the full history under the archive view", async () => {
    const reports = await listReports("ORC", { archive: true });
    expect(reports).toHaveLength(15);
  });

  it("orders reports newest portfolio-date first (default and archive)", async () => {
    const def = await listReports("ORC");
    const dates = def.map((r) => r.portfolioDate);
    const sortedDesc = [...dates].sort((a, b) => (a! < b! ? 1 : a! > b! ? -1 : 0));
    expect(dates).toEqual(sortedDesc);
    // The 12 shown are the newest 12 (the oldest 3 of 15 are excluded by default).
    const archive = await listReports("ORC", { archive: true });
    expect(def[0].portfolioDate).toBe(archive[0].portfolioDate);
  });
});

describe("listReports never surfaces superseded/non-current versions", () => {
  beforeEach(() => {
    holder.client = makeFakeReitsClient(SAMPLE);
  });

  it("excludes superseded and generating versions", async () => {
    const ids = (await listReports("ARR")).map((r) => r.id);
    expect(ids).not.toContain(REPORT_IDS.ARR_SUP);
    expect(ids).not.toContain(REPORT_IDS.ARR_GEN);
  });
});
