import { describe, it, expect } from "vitest";
import {
  validateHoldingsQuery,
  validateHoldingsExportQuery,
  formatLastChange,
  HOLDINGS_SORT_COLUMNS,
  DEFAULT_HOLDINGS_SORT,
} from "@/lib/fundHoldings";
import { UNMAPPED_TOKEN, exportMaxRows } from "@/lib/fundManager";

function sp(obj: Record<string, string>): URLSearchParams {
  return new URLSearchParams(obj);
}

describe("validateHoldingsQuery", () => {
  it("applies defaults", () => {
    const r = validateHoldingsQuery(sp({}));
    expect(r).toEqual({
      ok: true,
      value: {
        p_manager: null,
        p_fund: null,
        p_page: 1,
        p_page_size: 100,
        p_sort_column: "last_change",
        p_sort_direction: "desc",
        p_security_id_search: null,
        p_description_search: null,
        p_security_type: null,
        p_sector_type: null,
        p_changed_within: null,
      },
    });
    expect(DEFAULT_HOLDINGS_SORT).toBe("last_change");
  });

  it("treats manager=all as null", () => {
    const r = validateHoldingsQuery(sp({ manager: "all", fund: "JBND" }));
    expect(r.ok && r.value.p_manager).toBeNull();
    expect(r.ok && r.value.p_fund).toBe("JBND");
  });

  it("accepts every whitelisted sort column and rejects position_change", () => {
    for (const c of HOLDINGS_SORT_COLUMNS) {
      expect(validateHoldingsQuery(sp({ h_sort: c })).ok).toBe(true);
    }
    const r = validateHoldingsQuery(sp({ h_sort: "position_change" }));
    expect(r).toEqual({ ok: false, error: "invalid_sort_column: position_change" });
  });

  it("rejects a bad direction", () => {
    const r = validateHoldingsQuery(sp({ h_dir: "sideways" }));
    expect(r.ok).toBe(false);
  });

  it("maps changed presets to snapshot counts", () => {
    const v = (c: string) => {
      const r = validateHoldingsQuery(sp({ changed: c }));
      return r.ok ? r.value.p_changed_within : "error";
    };
    expect(v("1D")).toBe(1);
    expect(v("7D")).toBe(5);
    expect(v("30D")).toBe(21);
  });

  it("rejects unknown changed values, including the 1Y range preset", () => {
    for (const c of ["2D", "1Y", "x"]) {
      const r = validateHoldingsQuery(sp({ changed: c }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/^invalid_changed: /);
    }
  });

  it("rejects page sizes outside the whitelist", () => {
    const r = validateHoldingsQuery(sp({ h_page_size: "75" }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/^invalid_page_size/);
    expect(validateHoldingsQuery(sp({ h_page_size: "250" })).ok).toBe(true);
  });

  it("clamps bad page numbers to 1", () => {
    const r = validateHoldingsQuery(sp({ h_page: "-3" }));
    expect(r.ok && r.value.p_page).toBe(1);
    const r2 = validateHoldingsQuery(sp({ h_page: "4" }));
    expect(r2.ok && r2.value.p_page).toBe(4);
  });

  it("passes search/filter params through and keeps the unmapped token", () => {
    const r = validateHoldingsQuery(
      sp({
        h_q_security: " 912828 ",
        h_q_description: "bill",
        h_f_security_type: "UST",
        h_f_sector_type: UNMAPPED_TOKEN,
      }),
    );
    expect(r.ok && r.value).toMatchObject({
      p_security_id_search: "912828",
      p_description_search: "bill",
      p_security_type: "UST",
      p_sector_type: UNMAPPED_TOKEN,
    });
  });
});

describe("validateHoldingsExportQuery", () => {
  it("drops page/sort and adds p_max_rows", () => {
    const r = validateHoldingsExportQuery(sp({ changed: "7D", h_sort: "fund_ticker" }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.p_changed_within).toBe(5);
      expect(r.value.p_max_rows).toBe(exportMaxRows());
      for (const k of ["p_page", "p_page_size", "p_sort_column", "p_sort_direction"]) {
        expect(k in r.value).toBe(false);
      }
    }
  });

  it("propagates validation errors", () => {
    expect(validateHoldingsExportQuery(sp({ changed: "2D" })).ok).toBe(false);
  });
});

describe("formatLastChange", () => {
  const base = { comparison_basis: "PAR" as const, since_first: false };

  it("tags an addition", () => {
    expect(
      formatLastChange({ ...base, last_change_date: "2026-07-15", last_change_kind: "added" }),
    ).toEqual({ date: "15/07/26", tag: "Added", muted: false, text: "Added 15/07/26" });
  });

  it("tags par increases and decreases", () => {
    expect(
      formatLastChange({ ...base, last_change_date: "2026-07-15", last_change_kind: "par_increased" }),
    ).toMatchObject({ tag: "Par ↑", muted: false, date: "15/07/26" });
    expect(
      formatLastChange({ ...base, last_change_date: "2026-07-15", last_change_kind: "par_decreased" }),
    ).toMatchObject({ tag: "Par ↓", muted: false });
  });

  it("renders since_first as muted text per basis", () => {
    expect(
      formatLastChange({
        comparison_basis: "PAR",
        since_first: true,
        last_change_date: "2026-07-15",
        last_change_kind: null,
      }),
    ).toEqual({ date: "15/07/26", tag: null, muted: true, text: "unchanged since 15/07/26" });
    expect(
      formatLastChange({
        comparison_basis: "MARKET_VALUE",
        since_first: true,
        last_change_date: "2026-06-30",
        last_change_kind: null,
      }),
    ).toEqual({ date: "30/06/26", tag: null, muted: true, text: "held since 30/06/26" });
  });

  it("handles a row with missing derived data", () => {
    expect(
      formatLastChange({ ...base, last_change_date: null, last_change_kind: null }),
    ).toEqual({ date: "", tag: null, muted: true, text: "—" });
  });
});
