/**
 * POST /api/trace/lookup — classify pasted CUSIPs before fetching trades: invalid
 * (format/check digit), not found on FINRA, not an MBS, or MBS (with its symbol).
 * Approved users only; read-only; calls FINRA's public data service server-side.
 */
import { requireUser } from "@/lib/reqUser";
import { MAX_CUSIPS, cusipCheckOk, type LookupResult } from "@/lib/trace/calendar";
import { lookupBonds } from "@/lib/trace/finra";
import { readJson, traceError, traceJson } from "@/lib/trace/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const body = await readJson(request);
  const raw = body?.cusips;
  if (!Array.isArray(raw) || raw.length === 0 || !raw.every((c) => typeof c === "string")) {
    return traceJson({ error: "Enter at least one CUSIP." }, 400);
  }
  const cusips = [...new Set((raw as string[]).map((c) => c.trim().toUpperCase()))];
  if (cusips.length > MAX_CUSIPS) {
    return traceJson({ error: `Max ${MAX_CUSIPS} CUSIPs per search.` }, 400);
  }

  const valid = cusips.filter(cusipCheckOk);
  try {
    const infos = await lookupBonds(valid);
    const byCusip = new Map(valid.map((c, i) => [c, infos[i]]));
    const results: LookupResult[] = cusips.map((c) => {
      if (!cusipCheckOk(c)) return { cusip: c, status: "invalid", symbol: null, bondType: null };
      const info = byCusip.get(c);
      if (!info) return { cusip: c, status: "notfound", symbol: null, bondType: null };
      return {
        cusip: c,
        status: info.bondType === "MBS" ? "mbs" : "other",
        symbol: info.symbol,
        bondType: info.bondType,
      };
    });
    return traceJson({ results });
  } catch (err) {
    return traceError(err);
  }
}
