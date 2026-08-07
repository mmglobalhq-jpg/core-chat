/**
 * Client-side types and fetchers for the daily briefing.
 *
 * READ-ONLY BY DESIGN. There is no client path that writes a briefing: every
 * claim in one is asserted to be sourced, and a browser cannot make that
 * assertion. The database backs this up — `briefings` grants `authenticated`
 * SELECT only, and carries no insert policy. Preferences are the one thing a
 * user owns and may change.
 */

export type BriefingSectionKind = "top" | "deep_dive";

export interface BriefingSection {
  kind: BriefingSectionKind;
  rank: number;
  headline: string;
  body: string;
  url: string;
  source_name: string | null;
  published_at: string | null;
}

export interface Briefing {
  id: string;
  briefing_date: string;
  status: "pending" | "generating" | "ready" | "failed";
  generated_at: string | null;
  sections: BriefingSection[];
}

export interface BriefingPrefs {
  enabled: boolean;
  topics: string[];
  deliver_at: string;
  timezone: string;
  deliver_email: boolean;
  email_to: string | null;
}

export const DEFAULT_PREFS: BriefingPrefs = {
  enabled: false,
  topics: [],
  deliver_at: "06:30",
  timezone: "America/Chicago",
  deliver_email: false,
  email_to: null,
};

/** Top items in rank order. */
export function topSections(briefing: Briefing): BriefingSection[] {
  return briefing.sections
    .filter((s) => s.kind === "top")
    .sort((a, b) => a.rank - b.rank);
}

/**
 * The single deep dive, or null.
 *
 * The database allows at most one; this returns the first rather than throwing,
 * because a reader looking at yesterday's briefing should not get an error page
 * over a structural anomaly they cannot act on.
 */
export function deepDive(briefing: Briefing): BriefingSection | null {
  return briefing.sections.find((s) => s.kind === "deep_dive") ?? null;
}

/** Host shown under a headline. Falls back to the raw string on a bad URL. */
export function sourceLabel(section: BriefingSection): string {
  if (section.source_name) return section.source_name;
  try {
    return new URL(section.url).hostname.replace(/^www\./, "");
  } catch {
    return section.url;
  }
}

export function formatBriefingDate(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return date;
  return parsed.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}
