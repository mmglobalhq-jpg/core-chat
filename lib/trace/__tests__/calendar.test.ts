import { describe, expect, it } from "vitest";
import {
  MAX_JOBS,
  businessDays,
  cusipCheckOk,
  defaultRange,
  fmt32,
  isBusinessDay,
  isIsoDate,
  parseCusips,
  planBatches,
  prevBusinessDay,
  rangeOfBusinessDays,
} from "@/lib/trace/calendar";

describe("fmt32", () => {
  it.each([
    [91.3125, "91-10"],
    [91.31640625, "91-101"],
    [91.33984375, "91-107"],
    [91.328125, "91-10+"],
    [91.015625, "91-00+"],
    [91, "91-00"],
    [91.03125, "91-01"],
    [100, "100-00"],
    [99.99609375, "99-317"],
  ])("%s -> %s", (v, s) => expect(fmt32(v)).toBe(s));

  it("treats FINRA's 6-decimal truncation as exact", () => {
    expect(fmt32(74.367187)).toBe("74-116"); // 74.3671875
    expect(fmt32(76.824218)).toBe("76-263"); // 76.82421875 = 26.375 ticks
  });

  it("marks genuinely off-grid prices and rounds to the nearest eighth", () => {
    expect(fmt32(73.904)).toBe("≈73-287");
    expect(fmt32(99.998)).toBe("≈99-317");
    expect(fmt32(91.37640625)).toBe("≈91-12");
  });

  it("rounds up across a point boundary", () => {
    expect(fmt32(99.9995)).toBe("≈100-00");
  });

  it("is blank for missing prices", () => {
    expect(fmt32(null)).toBe("");
    expect(fmt32(undefined)).toBe("");
  });
});

describe("SIFMA calendar", () => {
  it("skips weekends and full-close holidays", () => {
    expect(isBusinessDay("2026-11-11")).toBe(false); // Veterans Day
    expect(isBusinessDay("2026-11-14")).toBe(false); // Saturday
    expect(isBusinessDay("2026-04-03")).toBe(true); // 2026 Good Friday: early close only
    expect(isBusinessDay("2027-03-26")).toBe(false); // 2027 Good Friday: full close
    expect(isBusinessDay("2027-12-31")).toBe(true); // early close only
  });

  it("walks back over holidays", () => {
    expect(prevBusinessDay("2026-11-12")).toBe("2026-11-10");
    expect(prevBusinessDay("2027-11-26")).toBe("2027-11-24");
  });

  it("counts business days inclusively", () => {
    expect(businessDays("2026-11-09", "2026-11-13")).toEqual([
      "2026-11-09", "2026-11-10", "2026-11-12", "2026-11-13",
    ]);
  });

  it("defaults to the current and previous business day in Eastern time", () => {
    // 2026-11-10 23:30 Eastern = 2026-11-11 04:30 UTC: still the 10th in New York.
    expect(defaultRange(new Date("2026-11-11T04:30:00Z"))).toEqual({ start: "2026-11-09", end: "2026-11-10" });
    // Veterans Day (holiday) -> the last two business days.
    expect(defaultRange(new Date("2026-11-11T15:00:00Z"))).toEqual({ start: "2026-11-09", end: "2026-11-10" });
  });

  it("builds preset ranges of N business days", () => {
    expect(rangeOfBusinessDays("2026-11-13", 5)).toEqual({ start: "2026-11-06", end: "2026-11-13" });
  });

  it("validates ISO dates strictly", () => {
    expect(isIsoDate("2026-11-10")).toBe(true);
    expect(isIsoDate("2026-02-30")).toBe(false);
    expect(isIsoDate("11/10/2026")).toBe(false);
    expect(isIsoDate(20261110)).toBe(false);
  });
});

describe("CUSIPs", () => {
  it("checks the check digit", () => {
    expect(cusipCheckOk("31418EBR0")).toBe(true);
    expect(cusipCheckOk("31418EBR1")).toBe(false);
    expect(cusipCheckOk("3140QNNM0")).toBe(true);
    expect(cusipCheckOk("037833100")).toBe(true);
    expect(cusipCheckOk("short")).toBe(false);
  });

  it("parses pasted lists, de-duplicated and upper-cased", () => {
    expect(parseCusips(" 31418ebr0, 3140QNNM0;\n31418EBR0\t")).toEqual(["31418EBR0", "3140QNNM0"]);
  });
});

describe("planBatches", () => {
  const days = Array.from({ length: 63 }, (_, i) => `d${i}`);
  it("keeps every batch within MAX_JOBS and covers every CUSIP-day exactly once", () => {
    for (const n of [1, 3, 39, 41, 100]) {
      const cusips = Array.from({ length: n }, (_, i) => `c${i}`);
      const batches = planBatches(cusips, days);
      const seen = new Set<string>();
      for (const b of batches) {
        expect(b.cusips.length * b.days.length).toBeLessThanOrEqual(MAX_JOBS);
        for (const c of b.cusips) for (const d of b.days) seen.add(`${c}|${d}`);
      }
      expect(seen.size).toBe(n * days.length);
    }
  });
  it("is empty when there is nothing to fetch", () => {
    expect(planBatches([], days)).toEqual([]);
  });
});
