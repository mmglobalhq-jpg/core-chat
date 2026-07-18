import { describe, it, expect } from "vitest";
import {
  validateChangesQuery,
  validateExportQuery,
  parseIsoDate,
  parseChangeTypes,
  truncateDecimalTowardZero,
  ALLOWED_PAGE_SIZES,
  DEFAULT_PAGE_SIZE,
  getComparisonMode,
  getAmountLabels,
  getBasisLabel,
  formatSector,
  formatSecurityType,
  normalizePositionChangeRow,
  fundDisplayLabel,
  UNMAPPED_TOKEN,
  UNMAPPED_LABEL,
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
    expect(r.value.p_sort_column).toBe("position_change"); // basis-aware default
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

describe("validateChangesQuery — basis-aware sort whitelist", () => {
  const base = { start: "2026-06-01", end: "2026-06-02" };

  it("accepts position_amount / position_change / market_value_* sort columns", () => {
    for (const col of [
      "position_amount",
      "position_change",
      "market_value_amount",
      "market_value_change",
      "par_amount",
      "par_change",
    ]) {
      const r = validateChangesQuery(sp({ ...base, sort: col }));
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.p_sort_column).toBe(col);
    }
  });

  it("rejects an arbitrary UI label as a sort column", () => {
    expect(validateChangesQuery(sp({ ...base, sort: "Par Change" })).ok).toBe(false);
    expect(validateChangesQuery(sp({ ...base, sort: "market value" })).ok).toBe(false);
  });

  it("passes the __UNMAPPED__ null-sector token through untouched", () => {
    const r = validateChangesQuery(sp({ ...base, f_sector_type: UNMAPPED_TOKEN }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.p_sector_type).toBe(UNMAPPED_TOKEN);
  });
});

describe("getComparisonMode", () => {
  const parRow = { comparison_basis: "PAR" } as never;
  const mvRow = { comparison_basis: "MARKET_VALUE" } as never;

  it("returns 'par' for PAR-only rows", () => {
    expect(getComparisonMode([parRow, parRow])).toBe("par");
  });
  it("returns 'market_value' for MARKET_VALUE-only rows", () => {
    expect(getComparisonMode([mvRow, mvRow])).toBe("market_value");
  });
  it("returns 'mixed' when both bases appear", () => {
    expect(getComparisonMode([parRow, mvRow])).toBe("mixed");
  });
  it("falls back to fund_status when there are no rows", () => {
    expect(getComparisonMode([], [{ comparison_basis: "MARKET_VALUE" } as never])).toBe("market_value");
    expect(
      getComparisonMode(
        [],
        [{ comparison_basis: "PAR" } as never, { comparison_basis: "MARKET_VALUE" } as never],
      ),
    ).toBe("mixed");
  });
  it("defaults to 'par' with no rows and no status", () => {
    expect(getComparisonMode([], [])).toBe("par");
  });
});

describe("getAmountLabels", () => {
  it("labels PAR mode as Par Amount / Par Change", () => {
    expect(getAmountLabels("par")).toEqual({ amount: "Par Amount", change: "Par Change" });
  });
  it("labels MARKET_VALUE mode as Market Value / Market Value Change", () => {
    expect(getAmountLabels("market_value")).toEqual({
      amount: "Market Value",
      change: "Market Value Change",
    });
  });
  it("labels mixed mode as Position Amount / Position Change", () => {
    expect(getAmountLabels("mixed")).toEqual({ amount: "Position Amount", change: "Position Change" });
  });
});

describe("getBasisLabel", () => {
  it("maps MARKET_VALUE -> Market Value, everything else -> Par", () => {
    expect(getBasisLabel("MARKET_VALUE")).toBe("Market Value");
    expect(getBasisLabel("PAR")).toBe("Par");
  });
});

describe("formatSector / formatSecurityType", () => {
  it("renders null sector as Unmapped, otherwise the value", () => {
    expect(formatSector(null)).toBe(UNMAPPED_LABEL);
    expect(formatSector("Corporate")).toBe("Corporate");
  });
  it("renders null security type as an em dash, otherwise the value", () => {
    expect(formatSecurityType(null)).toBe("—");
    expect(formatSecurityType("Fixed Rate")).toBe("Fixed Rate");
  });
});

describe("normalizePositionChangeRow", () => {
  it("preserves new basis-aware fields verbatim (exact decimal strings)", () => {
    const raw = {
      comparison_basis: "MARKET_VALUE",
      position_amount: "1234567890123456789.1234567890",
      position_change: "-98765432109876543.9876543210",
      par_amount: null,
      par_change: null,
      market_value_amount: "1234567890123456789.1234567890",
      market_value_change: "-98765432109876543.9876543210",
    };
    const r = normalizePositionChangeRow(raw as Record<string, unknown>);
    expect(r.comparison_basis).toBe("MARKET_VALUE");
    expect(r.position_amount).toBe("1234567890123456789.1234567890");
    expect(r.position_change).toBe("-98765432109876543.9876543210");
    expect(r.par_amount).toBeNull();
    expect(r.market_value_amount).toBe("1234567890123456789.1234567890");
  });

  it("falls back to par_* with basis PAR for a legacy row lacking position_* keys", () => {
    const legacy = { par_amount: "5000000.0000000000", par_change: "250000.0000000000" };
    const r = normalizePositionChangeRow(legacy as Record<string, unknown>);
    expect(r.comparison_basis).toBe("PAR");
    expect(r.position_amount).toBe("5000000.0000000000");
    expect(r.position_change).toBe("250000.0000000000");
    expect(r.market_value_amount).toBeNull();
    expect(r.market_value_change).toBeNull();
  });

  it("does not let the legacy fallback override valid new fields", () => {
    const raw = {
      comparison_basis: "MARKET_VALUE",
      position_amount: "42.0000000000",
      position_change: "1.0000000000",
      par_amount: "999.0000000000", // stale/ignored when position_* present
      par_change: "9.0000000000",
      market_value_amount: "42.0000000000",
      market_value_change: "1.0000000000",
    };
    const r = normalizePositionChangeRow(raw as Record<string, unknown>);
    expect(r.comparison_basis).toBe("MARKET_VALUE");
    expect(r.position_amount).toBe("42.0000000000");
    expect(r.position_change).toBe("1.0000000000");
  });
});

describe("fundDisplayLabel", () => {
  it("maps canonical Allspring tickers to a friendly name + aliases", () => {
    expect(fundDisplayLabel("AS_CORE_PLUS")).toEqual({
      label: "Core Plus Bond",
      aliases: ["STYAX", "WIPIX", "WFIPX"],
    });
  });
  it("returns the ticker unchanged (no aliases) for JP Morgan / unknown funds", () => {
    expect(fundDisplayLabel("JCPUX")).toEqual({ label: "JCPUX", aliases: [] });
  });
});
