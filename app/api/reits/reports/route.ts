/**
 * GET /api/reits/reports?issuer=ARR[&archive=1] — completed current reports for one issuer,
 * newest first (metadata only, no report body). Defaults to the latest 12; ``archive=1``
 * returns the full current history. Authenticated, read-only. Invalid issuer symbols are
 * rejected with 400 before any query runs.
 */
import { requireUser } from "@/lib/reqUser";
import { listReports, validateIssuerSymbol } from "@/lib/reitResearch";
import { reitErrorResponse, reitJson } from "@/lib/reitsApi";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  try {
    const sp = new URL(request.url).searchParams;
    const issuer = validateIssuerSymbol(sp.get("issuer"));
    const archive = sp.get("archive") === "1";
    return reitJson({ issuer, archive, reports: await listReports(issuer, { archive }) });
  } catch (err) {
    return reitErrorResponse(err);
  }
}
