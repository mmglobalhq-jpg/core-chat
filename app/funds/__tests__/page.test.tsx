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

function mockFetch(changes: unknown) {
  return vi.fn(async (url: string) => {
    if (url.startsWith("/api/funds/options")) return jsonResponse(OPTIONS);
    if (url.startsWith("/api/funds/latest-date")) return jsonResponse({ latestDate: "2026-06-02" });
    if (url.startsWith("/api/funds/filter-options"))
      return jsonResponse({ security_types: ["TREASURY NOTES"], sector_types: ["UST"] });
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
});
