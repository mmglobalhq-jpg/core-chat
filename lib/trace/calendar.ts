/**
 * Pure helpers for the Trace page (FINRA TRACE MBS trade history), shared by the
 * browser and the API routes: the SIFMA business-day calendar, CUSIP validation,
 * and price formatting in 32nds.
 *
 * Dates are ISO `YYYY-MM-DD` strings throughout and all arithmetic is done in UTC,
 * so nothing drifts with the viewer's time zone.
 */

/**
 * SIFMA U.S. full-close recommendations (sifma.org holiday schedule). Early closes
 * are still business days and are not listed. Saturday holidays are not observed
 * on the Friday before (SIFMA lists New Year's 2028 on Sat 1/1 with only an early
 * close on Fri 12/31/27).
 */
export const SIFMA_HOLIDAYS: ReadonlySet<string> = new Set([
  // 2025
  "2025-01-01", "2025-01-20", "2025-02-17", "2025-04-18", "2025-05-26", "2025-06-19",
  "2025-07-04", "2025-09-01", "2025-10-13", "2025-11-11", "2025-11-27", "2025-12-25",
  // 2026 (Good Friday 4/3 was an early close only, so it is a business day)
  "2026-01-01", "2026-01-19", "2026-02-16", "2026-05-25", "2026-06-19", "2026-07-03",
  "2026-09-07", "2026-10-12", "2026-11-11", "2026-11-26", "2026-12-25",
  // 2027 (published; fetched 2026-11-10)
  "2027-01-01", "2027-01-18", "2027-02-15", "2027-03-26", "2027-05-31", "2027-06-18",
  "2027-07-05", "2027-09-06", "2027-10-11", "2027-11-11", "2027-11-25", "2027-12-24",
  // 2028: PROVISIONAL. SIFMA had not published 2028 as of 2026-11-10. Projected from
  // the federal-holiday rules (which reproduce SIFMA's 2027 list exactly); Jan 1 and
  // Veterans Day fall on Saturdays. Good Friday is the most likely to change.
  "2028-01-17", "2028-02-21", "2028-04-14", "2028-05-29", "2028-06-19", "2028-07-04",
  "2028-09-04", "2028-10-09", "2028-11-23", "2028-12-25",
]);
export const CALENDAR_THROUGH = "2028-12-31";

/** Longest range one search may cover: about a year of business days. */
export const MAX_BUSINESS_DAYS = 260;
export const MAX_CUSIPS = 100;
/**
 * CUSIP-days per /api/trace/trades call: ~1 s each at 4 in flight ≈ 10 s, so no
 * call nears Cloudflare's ~100 s origin timeout. The page batches to this size.
 */
export const MAX_JOBS = 40;

export type LookupResult = {
  cusip: string;
  status: "mbs" | "invalid" | "notfound" | "other";
  symbol: string | null;
  bondType: string | null;
};

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(s: unknown): s is string {
  if (typeof s !== "string" || !ISO_RE.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function isBusinessDay(iso: string): boolean {
  const wd = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return wd !== 0 && wd !== 6 && !SIFMA_HOLIDAYS.has(iso);
}

export function prevBusinessDay(iso: string): string {
  let d = addDays(iso, -1);
  while (!isBusinessDay(d)) d = addDays(d, -1);
  return d;
}

/** Business days from start to end inclusive, oldest first. */
export function businessDays(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) if (isBusinessDay(d)) out.push(d);
  return out;
}

/** Today's date in U.S. Eastern time, which is the date TRACE reports in. */
export function easternToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** Current + previous business day; on a non-business day, the last two. */
export function defaultRange(now: Date = new Date()): { start: string; end: string } {
  const today = easternToday(now);
  const end = isBusinessDay(today) ? today : prevBusinessDay(today);
  return { start: prevBusinessDay(end), end };
}

/** The range of `n` business days ending at `end` (inclusive). */
export function rangeOfBusinessDays(end: string, n: number): { start: string; end: string } {
  let start = end;
  for (let i = 1; i < n; i++) start = prevBusinessDay(start);
  return { start, end };
}

/** Format and check digit (modulus 10, "double add double"). */
export function cusipCheckOk(c: string): boolean {
  if (!/^[0-9A-Z*@#]{9}$/.test(c)) return false;
  let total = 0;
  for (let i = 0; i < 8; i++) {
    const ch = c[i];
    let v: number;
    if (ch >= "0" && ch <= "9") v = ch.charCodeAt(0) - 48;
    else if (ch >= "A" && ch <= "Z") v = ch.charCodeAt(0) - 55;
    else v = ch === "*" ? 36 : ch === "@" ? 37 : 38;
    if (i % 2) v *= 2;
    total += Math.floor(v / 10) + (v % 10);
  }
  return String((10 - (total % 10)) % 10) === c[8];
}

/** Split pasted text into unique upper-case CUSIP candidates, in paste order. */
export function parseCusips(text: string): string[] {
  return [...new Set(text.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
}

/**
 * Price in 32nds with an eighths digit: 91.3125 -> "91-10", 91.31640625 -> "91-101",
 * a half tick uses "+" (91.328125 -> "91-10+"). Rounds to the nearest 1/256. FINRA
 * truncates prices to 6 decimals, so 74.367187 is an exact 74-116; only a price more
 * than 0.001 of a 1/256 off that grid (e.g. a marked-up customer price) gets "≈".
 */
export function fmt32(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  const raw = v * 256;
  const n = Math.round(raw);
  const pts = Math.floor(n / 256);
  const rem = n - pts * 256;
  const ticks = Math.floor(rem / 8);
  const eighths = rem % 8;
  const s = `${pts}-${String(ticks).padStart(2, "0")}${eighths === 4 ? "+" : eighths || ""}`;
  return Math.abs(raw - n) > 0.001 ? `≈${s}` : s;
}

/** FINRA's decimal price, trimmed of trailing zeros past 3 decimals. */
export function fmtDecimal(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "";
  return v.toFixed(6).replace(/0{1,3}$/, "");
}

/** Split CUSIP x day work into batches of at most MAX_JOBS CUSIP-days. */
export function planBatches(cusips: string[], days: string[]): { cusips: string[]; days: string[] }[] {
  const out: { cusips: string[]; days: string[] }[] = [];
  for (let i = 0; i < cusips.length; i += MAX_JOBS) {
    const group = cusips.slice(i, i + MAX_JOBS);
    const per = Math.max(1, Math.floor(MAX_JOBS / group.length));
    for (let j = 0; j < days.length; j += per) out.push({ cusips: group, days: days.slice(j, j + per) });
  }
  return out;
}
