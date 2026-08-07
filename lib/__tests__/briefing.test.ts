import { describe, expect, it } from "vitest";
import {
  type Briefing,
  type BriefingSection,
  deepDive,
  formatBriefingDate,
  sourceLabel,
  topSections,
} from "@/lib/briefing";

function section(overrides: Partial<BriefingSection> = {}): BriefingSection {
  return {
    kind: "top",
    rank: 1,
    headline: "Headline",
    body: "Body.",
    url: "https://www.example.com/story",
    source_name: null,
    published_at: null,
    ...overrides,
  };
}

function briefing(sections: BriefingSection[]): Briefing {
  return {
    id: "b1",
    briefing_date: "2026-08-06",
    status: "ready",
    generated_at: null,
    sections,
  };
}

describe("topSections", () => {
  it("returns top items in rank order regardless of stored order", () => {
    const b = briefing([
      section({ rank: 3, headline: "Third" }),
      section({ rank: 1, headline: "First" }),
      section({ rank: 2, headline: "Second" }),
      section({ kind: "deep_dive", rank: 1, headline: "Deep" }),
    ]);
    expect(topSections(b).map((s) => s.headline)).toEqual(["First", "Second", "Third"]);
  });

  it("excludes the deep dive", () => {
    const b = briefing([section(), section({ kind: "deep_dive", headline: "Deep" })]);
    expect(topSections(b)).toHaveLength(1);
  });
});

describe("deepDive", () => {
  it("finds the deep dive", () => {
    const b = briefing([section(), section({ kind: "deep_dive", headline: "Deep" })]);
    expect(deepDive(b)?.headline).toBe("Deep");
  });

  it("returns null when there is none rather than throwing", () => {
    // A reader looking at an old briefing should not get an error page over a
    // structural anomaly they cannot do anything about.
    expect(deepDive(briefing([section()]))).toBeNull();
  });
});

describe("sourceLabel", () => {
  it("prefers the stored outlet name", () => {
    expect(sourceLabel(section({ source_name: "NPR News" }))).toBe("NPR News");
  });

  it("falls back to the hostname without www", () => {
    expect(sourceLabel(section({ url: "https://www.bbc.co.uk/news/1" }))).toBe("bbc.co.uk");
  });

  it("does not throw on a malformed url", () => {
    expect(sourceLabel(section({ url: "not a url" }))).toBe("not a url");
  });
});

describe("formatBriefingDate", () => {
  it("formats a date string", () => {
    expect(formatBriefingDate("2026-08-06")).toContain("2026");
  });

  it("does not shift the day across a timezone boundary", () => {
    // Parsing "2026-08-06" as UTC midnight renders as the 5th anywhere west of
    // Greenwich, so the briefing would be labelled with the wrong day. Noon is
    // used to keep the date stable in every zone.
    expect(formatBriefingDate("2026-08-06")).toContain("6");
  });

  it("returns the input unchanged when it is not a date", () => {
    expect(formatBriefingDate("nonsense")).toBe("nonsense");
  });
});
