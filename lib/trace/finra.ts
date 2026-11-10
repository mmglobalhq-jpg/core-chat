/**
 * Server-side client for FINRA's public fixed-income data service — the backend
 * finra.org's own bond pages call. It is NOT a documented API (found in FINRA's
 * app-dynamic-reporting.js), so it can change without notice; if it breaks, re-read
 * that script for dataset/field names before assuming a block.
 *
 * - A session is an XSRF cookie from a lookup endpoint, echoed as X-XSRF-TOKEN.
 * - BondSearch gives bondType (MBS/CA/TS/...); MBS trades are in
 *   StructuredProductTradeHistory, and `fields` must be listed explicitly.
 * - A multi-year date range hung for 90s; one-day ranges answer in ~1s, so trades
 *   are fetched one business day at a time, a few at once.
 * - Plain Node fetch works (verified 2026-11-10); no TLS impersonation needed.
 */

const BASE = "https://services-dynarep.ddwa.finra.org/public/reporting/v2";
const TOKEN_URL = `${BASE}/group/Firm/name/ActiveIndividual/dynamiclookup/examCode`;
const SEARCH_URL = `${BASE}/data/group/FixedIncomeMarket/name/BondSearch`;
const HISTORY_URL = `${BASE}/data/group/FixedIncomeMarket/name/StructuredProductTradeHistory`;
const PAGE = 5000; // FINRA's per-request record cap
const CONCURRENCY = 4; // simultaneous FINRA requests per API call — stay polite
const TIMEOUT_MS = 30_000;

const FIELDS = [
  "tradeExecutionDate",
  "tradeExecutionTime",
  "tradeSettlementDate",
  "reportedTradeVolume",
  "lastSalePrice",
  "reportingPartySideCode",
  "reportingPartyTypeCode",
  "contraPartyTypeCode",
] as const;

export type TraceTrade = {
  cusip: string;
  tradeExecutionDate: string;
  tradeExecutionTime: string;
  tradeSettlementDate: string | null;
  reportedTradeVolume: number | null;
  lastSalePrice: number | null;
  reportingPartySideCode: string | null;
  reportingPartyTypeCode: string | null;
  contraPartyTypeCode: string | null;
};

export class FinraError extends Error {}

let token: string | null = null;
let tokenPromise: Promise<string> | null = null;

async function fetchToken(): Promise<string> {
  const res = await fetch(TOKEN_URL, {
    headers: { Referer: "https://www.finra.org/" },
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  const cookie = res.headers.getSetCookie().find((c) => c.startsWith("XSRF-TOKEN="));
  const value = cookie?.split(";")[0].slice("XSRF-TOKEN=".length);
  if (!value) throw new FinraError(`FINRA session could not be started (HTTP ${res.status})`);
  return value;
}

/** One shared token; concurrent callers wait on the same fetch. */
async function getToken(refresh: boolean): Promise<string> {
  if (token && !refresh) return token;
  if (!tokenPromise) {
    tokenPromise = fetchToken()
      .then((t) => (token = t))
      .finally(() => (tokenPromise = null));
  }
  return tokenPromise;
}

type FinraEnvelope = {
  status?: string;
  statusMessage?: string;
  returnBody?: { data?: string | null; headers?: { "Record-Total"?: string[] } };
};

async function finraPost<T>(url: string, body: unknown): Promise<{ rows: T[]; total: number }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const tok = await getToken(attempt === 1);
    const res = await fetch(url, {
      method: "POST",
      cache: "no-store",
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-XSRF-TOKEN": tok,
        Cookie: `XSRF-TOKEN=${tok}`,
        Origin: "https://www.finra.org",
        Referer: "https://www.finra.org/",
      },
      body: JSON.stringify(body),
    });
    if ((res.status === 401 || res.status === 403) && attempt === 0) continue;
    let j: FinraEnvelope;
    try {
      j = (await res.json()) as FinraEnvelope;
    } catch {
      throw new FinraError(`FINRA returned an unreadable response (HTTP ${res.status})`);
    }
    if (j.status !== "success") {
      throw new FinraError(j.statusMessage || `FINRA request failed (HTTP ${res.status})`);
    }
    const rb = j.returnBody ?? {};
    const total = Number(rb.headers?.["Record-Total"]?.[0] ?? "0") || 0;
    return { rows: JSON.parse(rb.data || "[]") as T[], total };
  }
  throw new FinraError("FINRA rejected the session token");
}

/** Run `fn` over `items` with at most `limit` in flight; results keep input order. */
export async function mapLimit<I, O>(items: I[], limit: number, fn: (i: I) => Promise<O>): Promise<O[]> {
  const out = new Array<O>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type BondInfo = { cusip: string; symbol: string | null; bondType: string | null };

/** Exact-CUSIP lookup; null when FINRA has no such bond. */
export async function lookupBond(cusip: string): Promise<BondInfo | null> {
  const { rows } = await finraPost<{ cusip?: string; issueSymbolIdentifier?: string; bondType?: string }>(
    SEARCH_URL,
    {
      fields: ["cusip", "issueSymbolIdentifier", "bondType"],
      multiFieldMatchFilters: [
        { searchValue: cusip, fuzzy: false, synonym: true, fields: [{ name: "cusip", boost: 1 }] },
      ],
      limit: 5,
      offset: 0,
    },
  );
  const hit = rows.find((r) => r.cusip === cusip);
  return hit ? { cusip, symbol: hit.issueSymbolIdentifier ?? null, bondType: hit.bondType ?? null } : null;
}

export function lookupBonds(cusips: string[]): Promise<(BondInfo | null)[]> {
  return mapLimit(cusips, CONCURRENCY, lookupBond);
}

/**
 * Every trade in one CUSIP on one day. Filters on the exact CUSIP — finra.org's own
 * bond page filters on a reference-data ID that several pools can share, so it can
 * show MORE trades than this. The owner chose exact CUSIP (2026-11-04).
 */
async function tradesForDay(cusip: string, day: string): Promise<TraceTrade[]> {
  const out: TraceTrade[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { rows, total } = await finraPost<Omit<TraceTrade, "cusip">>(HISTORY_URL, {
      fields: FIELDS,
      compareFilters: [{ fieldName: "cusip", fieldValue: cusip, compareType: "EQUAL" }],
      dateRangeFilters: [{ fieldName: "tradeExecutionDate", startDate: day, endDate: day }],
      limit: PAGE,
      offset,
    });
    for (const r of rows) out.push({ ...r, cusip });
    if (rows.length === 0 || offset + PAGE >= total) return out;
  }
}

export async function tradesFor(cusips: string[], days: string[]): Promise<TraceTrade[]> {
  const jobs = cusips.flatMap((c) => days.map((d) => [c, d] as const));
  const results = await mapLimit(jobs, CONCURRENCY, ([c, d]) => tradesForDay(c, d));
  return results.flat();
}
