import { describe, it, expect } from "vitest";
import {
  validateChangesQuery,
  validateExportQuery,
  parseIsoDate,
  parseChangeTypes,
  truncateDecimalTowardZero,
  ALLOWED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
} from "@/lib/fundManager";

function sp(obj: Record<string, string | string[]>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) v.forEach((x) => p.append(k, x));
    else p.set(k, v);
  }
  return p;
}

describe("parseIsoDate", () => {
  it("accepts a real calendar date", () => {
    expect(parseIsoDate("2026-07-17")).toBe("2026-07-17");
  });
  it("accepts future dates", () => {
    expect(parseIsoDate("2099-01-01")).toBe("2099-01-01");
  });
  it("rejects malformed or impossible dates", () => {
    expect(parseIsoDate("2026-13-01")).toBeNull();
    expect(parseIsoDate("2026-02-30")).toBeNull();
    expect(parseIsoDate("17/07/2026")).toBeNull();
    expect(parseIsoDate("")).toBeNull();
    expect(parseIsoDate(null)).toBeNull();
  });
});

describe("validateChangesQuery", () => {
  const base = { start: "2026-06-01", end: "2026-06-02" };

  it("defaults page/size/sort and treats missing manager/fund as NULL (all)", () => {
    const r = validateChangesQuery(sp(base));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.p_manager).toBeNull();
    expect(r.value.p_fund).toBeNull();
    expect(r.value.p_page).toBe(1);
    expect(r.value.p_page_size).toBe(DEFAULT_PAGE_SIZE);
    expect(r.value.p_sort_column).toBe("par_change");
    expect(r.value.p_sort_direction).toBe("desc");
    expect(r.value.p_change_types).toBeNull();
  });

  it("maps the literal 'all' and blanks to NULL scope", () => {
    const r = validateChangesQuery(sp({ ...base, manager: "all", fund: "" }));
    expect(r.ok && r.value.p_manager).toBeNull();
    expect(r.ok && r.value.p_fund).toBeNull();
  });

  it("rejects an invalid page size", () => {
    const r = validateChangesQuery(sp({ ...base, page_size: "75" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid_page_size");
  });

  it("accepts every allowed page size", () => {
    for (const s of ALLOWED_PAGE_SIZES) {
      expect(validateChangesQuery(sp({ ...base, page_size: String(s) })).ok).toBe(true);
    }
  });

  it("rejects a non-whitelisted sort column (SQL-injection attempt)", () => {
    const r = validateChangesQuery(sp({ ...base, sort: "par_amount; DROP TABLE funds" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid_sort_column");
  });

  it("rejects an invalid sort direction", () => {
    const r = validateChangesQuery(sp({ ...base, dir: "sideways" }));
    expect(r.ok).toBe(false);
  });

  it("rejects a reversed date range", () => {
    const r = validateChangesQuery(sp({ start: "2026-06-02", end: "2026-06-01" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("invalid_date_range");
  });

  it("rejects missing/invalid dates", () => {
    expect(validateChangesQuery(sp({ start: "2026-06-01" })).ok).toBe(false);
    expect(validateChangesQuery(sp({ start: "bad", end: "2026-06-02" })).ok).toBe(false);
  });

  it("passes text and dropdown filters through", () => {
    const r = validateChangesQuery(
      sp({
        ...base,
        q_security: "abc",
        q_description: "bond",
        f_security_type: "TREASURY NOTES",
        f_sector_type: "UST",
        change_type: "Added,Metadata Conflict",
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.p_security_id_search).toBe("abc");
    expect(r.value.p_description_search).toBe("bond");
    expect(r.value.p_security_type).toBe("TREASURY NOTES");
    expect(r.value.p_sector_type).toBe("UST");
    expect(r.value.p_change_types).toEqual(["Added", "Metadata Conflict"]);
  });

  it("rejects an unknown change_type", () => {
    const r = validateChangesQuery(sp({ ...base, change_type: "Frobnicated" }));
    expect(r.ok).toBe(false);
  });
});

describe("parseChangeTypes", () => {
  it("handles repeated params and comma-joined values", () => {
    expect(parseChangeTypes(["Added", "Removed"], null)).toEqual(["Added", "Removed"]);
    expect(parseChangeTypes([], "Added,Increased")).toEqual(["Added", "Increased"]);
    expect(parseChangeTypes([], null)).toBeNull();
    expect(parseChangeTypes([], "")).toBeNull();
  });
});

describe("validateExportQuery", () => {
  it("drops pagination/sort and adds the row cap", () => {
    const r = validateExportQuery(sp({ start: "2026-06-01", end: "2026-06-02", page: "3" }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("p_page" in r.value).toBe(false);
    expect("p_sort_column" in r.value).toBe(false);
    expect(r.value.p_max_rows).toBeGreaterThan(0);
  });

  it("still rejects invalid params", () => {
    expect(validateExportQuery(sp({ start: "2026-06-02", end: "2026-06-01" })).ok).toBe(false);
  });
});

describe("truncateDecimalTowardZero", () => {
  it("truncates toward zero and adds thousands separators", () => {
    expect(truncateDecimalTowardZero("1250000.9000000000")).toBe("1,250,000");
    expect(truncateDecimalTowardZero("-375000.9000000000")).toBe("-375,000");
    expect(truncateDecimalTowardZero("0.0000000000")).toBe("0");
    expect(truncateDecimalTowardZero("999.9")).toBe("999");
    expect(truncateDecimalTowardZero(null)).toBe("");
  });

  it("preserves very large integer magnitudes (no float rounding)", () => {
    expect(truncateDecimalTowardZero("1234567890123456789012345679.1234567890")).toBe(
      "1,234,567,890,123,456,789,012,345,679",
    );
  });
});
