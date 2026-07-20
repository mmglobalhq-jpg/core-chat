import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

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

import ReitsPage from "@/app/reits/page";

// Namespaced report ids, as the reader contract / API now return them.
const ARR_A = "arr:11111111-1111-4111-8111-111111111111";
const ARR_B = "arr:22222222-2222-4222-8222-222222222222";
const ARR_C = "arr:33333333-3333-4333-8333-333333333333";
const ORC_A = "orc:aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

const ISSUERS = {
  issuers: [
    { symbol: "ARR", name: "ARMOUR Residential REIT", reportCount: 3, latestReportDate: "2026-05-31" },
    { symbol: "ORC", name: "Orchid Island Capital, Inc.", reportCount: 1, latestReportDate: "2026-04-30" },
  ],
};
const ARR_REPORTS = {
  reports: [
    { id: ARR_A, issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR May report", portfolioDate: "2026-05-31", publicationDate: "2026-06-12", version: 1 },
    { id: ARR_B, issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR April report", portfolioDate: "2026-04-30", publicationDate: "2026-05-14", version: 1 },
    { id: ARR_C, issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR March report", portfolioDate: "2026-03-31", publicationDate: "2026-04-15", version: 2 },
  ],
};
const ORC_REPORTS = {
  reports: [
    { id: ORC_A, issuerSymbol: "ORC", issuerName: "Orchid Island Capital, Inc.", title: "Orchid April report", portfolioDate: "2026-04-30", publicationDate: "2026-05-03", version: 1 },
  ],
};
const BODY_A =
  "# Big Heading\n\n- item one\n- item two\n\n[filing link](https://example.test/f)\n\n| Metric | Value |\n|---|---|\n| Total | 22198 |\n\n<script>window.__pwned = 1</script>\n";
const DETAILS: Record<string, unknown> = {
  [ARR_A]: { report: { ...ARR_REPORTS.reports[0], bodyMarkdown: BODY_A } },
  [ARR_B]: { report: { ...ARR_REPORTS.reports[1], bodyMarkdown: "# April Heading\n\nApril body text." } },
  [ORC_A]: { report: { ...ORC_REPORTS.reports[0], bodyMarkdown: "# Orchid Heading\n\nOrchid body." } },
};

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function mockFetch(issuers: unknown = ISSUERS) {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/reits/issuers")) return ok(issuers);
    const detail = url.match(/\/api\/reits\/reports\/([^?]+)$/);
    if (detail) {
      const id = decodeURIComponent(detail[1]);
      return ok(DETAILS[id] ?? DETAILS[ARR_A]);
    }
    if (url.includes("issuer=ORC")) return ok(ORC_REPORTS);
    if (url.includes("/api/reits/reports")) return ok(ARR_REPORTS);
    return ok({});
  });
}

beforeEach(() => {
  push.mockReset();
  replace.mockReset();
  currentParams = new URLSearchParams();
});
afterEach(() => vi.unstubAllGlobals());

describe("REIT Research page", () => {
  it("defaults to ARR and shows both data-driven dropdown labels", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    expect(
      await screen.findByRole("option", { name: "ARMOUR Residential REIT (ARR)" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("option", { name: "Orchid Island Capital, Inc. (ORC)" }),
    ).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("issuer=ARR"));
  });

  it("does not show ORC when the contract returns no ORC issuer", async () => {
    vi.stubGlobal("fetch", mockFetch({ issuers: [ISSUERS.issuers[0]] }));
    render(<ReitsPage />);
    await screen.findByRole("option", { name: "ARMOUR Residential REIT (ARR)" });
    expect(
      screen.queryByRole("option", { name: "Orchid Island Capital, Inc. (ORC)" }),
    ).toBeNull();
  });

  it("lists reports newest first", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    const may = await screen.findByText("ARR May report");
    const list = may.closest("ul")!;
    const titles = within(list)
      .getAllByRole("button")
      .map((b) => b.querySelector("span")?.textContent);
    expect(titles).toEqual(["ARR May report", "ARR April report", "ARR March report"]);
  });

  it("opens the report selected in the URL and renders Markdown safely", async () => {
    currentParams = new URLSearchParams({ issuer: "ARR", report: ARR_A });
    vi.stubGlobal("fetch", mockFetch());
    const { container } = render(<ReitsPage />);
    expect(await screen.findByRole("heading", { name: "Big Heading" })).toBeInTheDocument();
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "filing link" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("22198")).toBeInTheDocument();
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("clicking a report pushes the namespaced report id into the URL", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    fireEvent.click(await screen.findByText("ARR April report"));
    expect(push).toHaveBeenCalledWith(
      expect.stringContaining(`report=${encodeURIComponent(ARR_B)}`),
    );
  });

  it("switching to ORC loads its namespaced report", async () => {
    currentParams = new URLSearchParams({ issuer: "ORC" });
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    expect(await screen.findByRole("heading", { name: "Orchid Heading" })).toBeInTheDocument();
    expect(replace).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent(ORC_A)));
  });

  it("falls back to the newest report when the URL report is invalid", async () => {
    currentParams = new URLSearchParams({
      issuer: "ARR",
      report: "arr:00000000-0000-4000-8000-000000000000",
    });
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    await screen.findByText("ARR May report");
    expect(replace).toHaveBeenCalledWith(expect.stringContaining(encodeURIComponent(ARR_A)));
  });

  it("shows the empty state when there are no issuers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("/api/reits/issuers")) return ok({ issuers: [] });
        return ok({});
      }),
    );
    render(<ReitsPage />);
    expect(await screen.findByText(/No REITs are available yet/i)).toBeInTheDocument();
  });

  it("shows an error + retry when the issuer list fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 500, json: async () => ({ error: "boom" }) }) as Response),
    );
    render(<ReitsPage />);
    expect(await screen.findByText(/Couldn't load REITs/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /retry/i })).toBeInTheDocument();
  });
});
