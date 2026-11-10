/**
 * POST /api/trace/trades — every TRACE trade for some MBS CUSIPs on some business
 * days. The page calls this in small batches (see MAX_JOBS) and stitches the results
 * together, so no single request outlives Cloudflare's ~100 s origin timeout and the
 * page can show progress. Approved users only; read-only.
 */
import { requireUser } from "@/lib/reqUser";
import { MAX_JOBS, cusipCheckOk, isIsoDate } from "@/lib/trace/calendar";
import { tradesFor } from "@/lib/trace/finra";
import { readJson, traceError, traceJson } from "@/lib/trace/api";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const body = await readJson(request);
  const cusips = body?.cusips;
  const days = body?.days;
  if (
    !Array.isArray(cusips) || cusips.length === 0 ||
    !cusips.every((c) => typeof c === "string" && cusipCheckOk(c))
  ) {
    return traceJson({ error: "cusips must be a non-empty list of valid CUSIPs." }, 400);
  }
  if (!Array.isArray(days) || days.length === 0 || !days.every(isIsoDate)) {
    return traceJson({ error: "days must be a non-empty list of YYYY-MM-DD dates." }, 400);
  }
  if (cusips.length * days.length > MAX_JOBS) {
    return traceJson({ error: `At most ${MAX_JOBS} CUSIP-days per request.` }, 400);
  }

  try {
    return traceJson({ trades: await tradesFor(cusips as string[], days as string[]) });
  } catch (err) {
    return traceError(err);
  }
}
