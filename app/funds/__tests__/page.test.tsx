import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const push = vi.fn();
const replace = vi.fn();
let currentParams = new URLSearchParams();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push, replace }),
  useSearchParams: () => currentParams,
}));

vi.mock("@/lib/supabaseClient", () => ({
  supabase: { auth: { getSession: async () => ({ data: { session: { access_token: "tok" } } }) } },
}));

// next/link + theme toggle render fine in jsdom; no mock needed.

import FundsPage from "@/app/funds/page";

const OPTIONS = {
  managers: ["JP Morgan"],
  funds: [{ ticker: "JBND", fund_manager: "JP Morgan" }],
  latestDate: "2026-06-02",
};

const CHANGES = {
  changes: [
    {
      fund_manager: "JP Morgan",
      fund_ticker: "JBND",
      security_id: "ADDED1",
      description: "New Bond",
      security_type: "TREASURY NOTES",
      sector_type: "UST",
      par_amount: "300.0000000000",
      par_change: "300.0000000000",
      change_type: "Added",
      metadata_conflict: false,
      conflict_fields: [],
      conflict_reason: null,
      requested_start_date: "2026-06-01",
      requested_end_date: "2026-06-02",
      actual_start_date: "2026-06-01",
      actual_end_date: "2026-06-02",
    },
    {
      fund_manager: "JP Morgan",
      fund_ticker: "JBND",
      security_id: "CONF1",
      description: "Ambiguous",
      security_type: "TREASURY NOTES",
      sector_type: "Conflicting",
      par_amount: null,
      par_change: null,
      change_type: "Metadata Conflict",
      metadata_conflict: true,
      conflict_fields: ["sector_type"],
      conflict_reason: "Duplicate rows in the end snapshot disagree on: sector_type",
      requested_start_date: "2026-06-01",
      requested_end_date: "2026-06-02",
      actual_start_date: "2026-06-01",
      actual_end_date: "2026-06-02",
    },
  ],
  fund_status: [
    {
      fund_manager: "JP Morgan",
      fund_ticker: "JBND",
      requested_start_date: "2026-06-01",
      requested_end_date: "2026-06-02",
      actual_start_date: "2026-06-01",
      actual_end_date: "2026-06-02",
      status: "ok",
      matching_row_count: 2,
      warning_count: 1,
      reason: null,
    },
  ],
  pagination: { page: 1, page_size: 100, total_rows: 2, total_pages: 1 },
};

// A market-value-only fund: canonical position_* mirror market_value_*; par_* are null.
// The second row exercises null sector ("Unmapped") and null security type ("—").
const MV_CHANGES = {
  changes: [
    {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      security_id: "MV0001",
      description: "Corporate Note",
      security_type: "Fixed Rate",
      sector_type: "Corporate",
      comparison_basis: "MARKET_VALUE",
      position_amount: "5000000.0000000000",
      position_change: "250000.0000000000",
      par_amount: null,
      par_change: null,
      market_value_amount: "5000000.0000000000",
      market_value_change: "250000.0000000000",
      change_type: "Increased",
      metadata_conflict: false,
      conflict_fields: [],
      conflict_reason: null,
      requested_start_date: "2026-05-31",
      requested_end_date: "2026-06-30",
      actual_start_date: "2026-05-31",
      actual_end_date: "2026-06-30",
    },
    {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      security_id: "MV0002",
      description: "Unmapped Holding",
      security_type: null,
      sector_type: null,
      comparison_basis: "MARKET_VALUE",
      position_amount: "100.0000000000",
      position_change: "-40.0000000000",
      par_amount: null,
      par_change: null,
      market_value_amount: "100.0000000000",
      market_value_change: "-40.0000000000",
      change_type: "Decreased",
      metadata_conflict: false,
      conflict_fields: [],
      conflict_reason: null,
      requested_start_date: "2026-05-31",
      requested_end_date: "2026-06-30",
      actual_start_date: "2026-05-31",
      actual_end_date: "2026-06-30",
    },
  ],
  fund_status: [
    {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      comparison_basis: "MARKET_VALUE",
      requested_start_date: "2026-05-31",
      requested_end_date: "2026-06-30",
      actual_start_date: "2026-05-31",
      actual_end_date: "2026-06-30",
      status: "ok",
      matching_row_count: 2,
      warning_count: 0,
      reason: null,
    },
  ],
  pagination: { page: 1, page_size: 100, total_rows: 2, total_pages: 1 },
};

// A mixed-basis result: one PAR (JP) row + one MARKET_VALUE (Allspring) row.
const MIXED_CHANGES = {
  changes: [
    {
      fund_manager: "JP Morgan",
      fund_ticker: "JBND",
      security_id: "PAR001",
      description: "Treasury",
      security_type: "TREASURY NOTES",
      sector_type: "UST",
      comparison_basis: "PAR",
      position_amount: "300.0000000000",
      position_change: "300.0000000000",
      par_amount: "300.0000000000",
      par_change: "300.0000000000",
      market_value_amount: null,
      market_value_change: null,
      change_type: "Added",
      metadata_conflict: false,
      conflict_fields: [],
      conflict_reason: null,
      requested_start_date: "2026-06-01",
      requested_end_date: "2026-06-02",
      actual_start_date: "2026-06-01",
      actual_end_date: "2026-06-02",
    },
    {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      security_id: "MV0001",
      description: "Corporate Note",
      security_type: "Fixed Rate",
      sector_type: "Corporate",
      comparison_basis: "MARKET_VALUE",
      position_amount: "5000000.0000000000",
      position_change: "250000.0000000000",
      par_amount: null,
      par_change: null,
      market_value_amount: "5000000.0000000000",
      market_value_change: "250000.0000000000",
      change_type: "Increased",
      metadata_conflict: false,
      conflict_fields: [],
      conflict_reason: null,
      requested_start_date: "2026-05-31",
      requested_end_date: "2026-06-30",
      actual_start_date: "2026-05-31",
      actual_end_date: "2026-06-30",
    },
  ],
  fund_status: [
    {
      fund_manager: "JP Morgan",
      fund_ticker: "JBND",
      comparison_basis: "PAR",
      requested_start_date: "2026-06-01",
      requested_end_date: "2026-06-02",
      actual_start_date: "2026-06-01",
      actual_end_date: "2026-06-02",
      status: "ok",
      matching_row_count: 1,
      warning_count: 0,
      reason: null,
    },
    {
      fund_manager: "Allspring",
      fund_ticker: "AS_CORE_PLUS",
      comparison_basis: "MARKET_VALUE",
      requested_start_date: "2026-05-31",
      requested_end_date: "2026-06-30",
      actual_start_date: "2026-05-31",
      actual_end_date: "2026-06-30",
      status: "ok",
      matching_row_count: 1,
      warning_count: 0,
      reason: null,
    },
  ],
  pagination: { page: 1, page_size: 100, total_rows: 2, total_pages: 1 },
};

const ALLSPRING_OPTIONS = {
  managers: ["Allspring", "JP Morgan"],
  funds: [
    { ticker: "AS_CORE_PLUS", fund_manager: "Allspring" },
    { ticker: "JBND", fund_manager: "JP Morgan" },
  ],
  latestDate: "2026-06-30",
};

const DEFAULT_FILTER = { security_types: ["TREASURY NOTES"], sector_types: ["UST"], sector_has_null: false };

function mockFetch(
  changes: unknown,
  opts: { options?: unknown; filterOptions?: unknown } = {},
) {
  const options = opts.options ?? OPTIONS;
  const filterOptions = opts.filterOptions ?? DEFAULT_FILTER;
  return vi.fn(async (url: string) => {
    if (url.startsWith("/api/funds/options")) return jsonResponse(options);
    if (url.startsWith("/api/funds/latest-date")) return jsonResponse({ latestDate: "2026-06-02" });
    if (url.startsWith("/api/funds/filter-options")) return jsonResponse(filterOptions);
    if (url.startsWith("/api/funds/changes")) return jsonResponse(changes);
    return jsonResponse({});
  });
}
function jsonResponse(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body, blob: async () => new Blob() } as Response;
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  currentParams = new URLSearchParams();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Fund Manager page", () => {
  it("shows the submit prompt when no comparison is in the URL", async () => {
    vi.stubGlobal("fetch", mockFetch(CHANGES));
    render(<FundsPage />);
    expect(await screen.findByText(/press Submit to compare positions/i)).toBeInTheDocument();
  });

  it("hydrates from URL params, groups by fund, and renders change indicators", async () => {
    currentParams = new URLSearchParams({ start: "2026-06-01", end: "2026-06-02", page: "1", page_size: "100" });
    vi.stubGlobal("fetch", mockFetch(CHANGES));
    render(<FundsPage />);

    // Fund group header with resolved dates (DD/MM/YY) and matching count.
    expect(await screen.findByText(/01\/06\/26 → 02\/06\/26/)).toBeInTheDocument();
    expect(screen.getByText(/of 2 rows/)).toBeInTheDocument();
    // "JBND" appears in the dropdown option, the group header, and the row cell.
    expect(screen.getAllByText("JBND").length).toBeGreaterThanOrEqual(2);

    // Change-type labels are shown as text (never colour alone).
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText("Metadata Conflict")).toBeInTheDocument();
    expect(screen.getByText("Conflicting")).toBeInTheDocument();

    // Truncated par amount + change for the Added row (both 300).
    expect(screen.getAllByText("300").length).toBeGreaterThanOrEqual(1);
  });

  it("shows the friendly zero-state (not an error) when there are no changes", async () => {
    currentParams = new URLSearchParams({ start: "2026-06-01", end: "2026-06-02" });
    const empty = {
      changes: [],
      fund_status: [
        {
          fund_manager: "JP Morgan",
          fund_ticker: "JBND",
          requested_start_date: "2026-06-01",
          requested_end_date: "2026-06-02",
          actual_start_date: "2026-06-01",
          actual_end_date: "2026-06-02",
          status: "ok",
          matching_row_count: 0,
          warning_count: 0,
          reason: null,
        },
      ],
      pagination: { page: 1, page_size: 100, total_rows: 0, total_pages: 0 },
    };
    vi.stubGlobal("fetch", mockFetch(empty));
    render(<FundsPage />);
    expect(
      await screen.findByText(/No position changes found for the resolved dates\./i),
    ).toBeInTheDocument();
  });

  it("PAR-only mode: Par labels, no Basis column, no market-value disclosure", async () => {
    currentParams = new URLSearchParams({ start: "2026-06-01", end: "2026-06-02" });
    vi.stubGlobal("fetch", mockFetch(CHANGES));
    render(<FundsPage />);
    expect(await screen.findByText("Par Amount")).toBeInTheDocument();
    expect(screen.getByText("Par Change")).toBeInTheDocument();
    expect(screen.queryByText("Basis")).not.toBeInTheDocument();
    expect(
      screen.queryByText(/do not necessarily represent purchases or sales/i),
    ).not.toBeInTheDocument();
  });

  it("MARKET_VALUE-only mode: Market Value labels, disclosure, Unmapped + em dash, no Basis column", async () => {
    currentParams = new URLSearchParams({ start: "2026-05-31", end: "2026-06-30" });
    vi.stubGlobal(
      "fetch",
      mockFetch(MV_CHANGES, {
        options: ALLSPRING_OPTIONS,
        filterOptions: { security_types: ["Fixed Rate"], sector_types: ["Corporate"], sector_has_null: true },
      }),
    );
    render(<FundsPage />);
    expect(await screen.findByText("Market Value")).toBeInTheDocument();
    expect(screen.getByText("Market Value Change")).toBeInTheDocument();
    // No Basis column for a single-basis result.
    expect(screen.queryByText("Basis")).not.toBeInTheDocument();
    // Disclosure note visible for market-value results.
    expect(
      screen.getByText(/do not necessarily represent purchases or sales/i),
    ).toBeInTheDocument();
    // Null sector renders as "Unmapped" (cell + the sector filter option); null
    // security type renders as an em dash.
    expect(screen.getAllByText("Unmapped").length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);
  });

  it("mixed mode: Position labels, a visible Basis column (Par / Market Value), and the disclosure", async () => {
    currentParams = new URLSearchParams({ start: "2026-05-31", end: "2026-06-30" });
    vi.stubGlobal("fetch", mockFetch(MIXED_CHANGES, { options: ALLSPRING_OPTIONS }));
    render(<FundsPage />);
    expect(await screen.findByText("Position Amount")).toBeInTheDocument();
    expect(screen.getByText("Position Change")).toBeInTheDocument();
    // The Basis column header and both basis labels appear only in mixed mode.
    expect(screen.getByText("Basis")).toBeInTheDocument();
    expect(screen.getByText("Par")).toBeInTheDocument();
    expect(screen.getByText("Market Value")).toBeInTheDocument();
    expect(
      screen.getByText(/do not necessarily represent purchases or sales/i),
    ).toBeInTheDocument();
  });

  it("canonicalises the Allspring fund dropdown to one friendly option with alias hints", async () => {
    vi.stubGlobal("fetch", mockFetch(CHANGES, { options: ALLSPRING_OPTIONS }));
    render(<FundsPage />);
    const option = await screen.findByRole("option", { name: /Core Plus Bond/ });
    expect(option).toBeInTheDocument();
    expect(option).toHaveTextContent("STYAX / WIPIX / WFIPX");
    // The share-class aliases are never separate fund options.
    expect(screen.queryByRole("option", { name: /^STYAX$/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: /^WIPIX$/ })).not.toBeInTheDocument();
  });
});
