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

const ISSUERS = {
  issuers: [
    { symbol: "ARR", name: "ARMOUR Residential REIT", reportCount: 3, latestReportDate: "2026-05-31" },
    { symbol: "XYZ", name: "XYZ", reportCount: 1, latestReportDate: "2026-05-31" },
  ],
};
const REPORTS = {
  reports: [
    { id: "r-a", issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR May report", portfolioDate: "2026-05-31", publicationDate: "2026-06-12", version: 1 },
    { id: "r-b", issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR April report", portfolioDate: "2026-04-30", publicationDate: "2026-05-14", version: 1 },
    { id: "r-c", issuerSymbol: "ARR", issuerName: "ARMOUR Residential REIT", title: "ARR March report", portfolioDate: "2026-03-31", publicationDate: "2026-04-15", version: 2 },
  ],
};
const BODY_A =
  "# Big Heading\n\n- item one\n- item two\n\n[filing link](https://example.test/f)\n\n| Metric | Value |\n|---|---|\n| Total | 22198 |\n\n<script>window.__pwned = 1</script>\n";
const DETAIL_A = { report: { ...REPORTS.reports[0], bodyMarkdown: BODY_A } };
const DETAIL_B = { report: { ...REPORTS.reports[1], bodyMarkdown: "# April Heading\n\nApril body text." } };

function ok(body: unknown): Response {
  return { ok: true, status: 200, json: async () => body } as Response;
}

function mockFetch() {
  return vi.fn(async (url: string) => {
    if (url.includes("/api/reits/issuers")) return ok(ISSUERS);
    const detail = url.match(/\/api\/reits\/reports\/([^?]+)/);
    if (detail) return ok(detail[1] === "r-b" ? DETAIL_B : DETAIL_A);
    if (url.includes("/api/reits/reports")) return ok(REPORTS);
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
  it("defaults to ARR and shows the data-driven dropdown label", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    // Dropdown populated with "ARMOUR Residential REIT (ARR)".
    expect(await screen.findByRole("option", { name: "ARMOUR Residential REIT (ARR)" })).toBeInTheDocument();
    // URL normalized to issuer=ARR.
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("issuer=ARR"));
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
    currentParams = new URLSearchParams({ issuer: "ARR", report: "r-a" });
    vi.stubGlobal("fetch", mockFetch());
    const { container } = render(<ReitsPage />);
    // Heading, list, link and table all render.
    expect(await screen.findByRole("heading", { name: "Big Heading" })).toBeInTheDocument();
    expect(screen.getByText("item one")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "filing link" })).toHaveAttribute("target", "_blank");
    expect(screen.getByText("22198")).toBeInTheDocument();
    // Raw HTML/script is never turned into a live element.
    expect(container.querySelector("script")).toBeNull();
    expect((window as unknown as { __pwned?: number }).__pwned).toBeUndefined();
  });

  it("clicking a report pushes the report id into the URL", async () => {
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    fireEvent.click(await screen.findByText("ARR April report"));
    expect(push).toHaveBeenCalledWith(expect.stringContaining("report=r-b"));
  });

  it("falls back to the newest report when the URL report is invalid", async () => {
    currentParams = new URLSearchParams({ issuer: "ARR", report: "does-not-exist" });
    vi.stubGlobal("fetch", mockFetch());
    render(<ReitsPage />);
    await screen.findByText("ARR May report");
    expect(replace).toHaveBeenCalledWith(expect.stringContaining("report=r-a"));
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
