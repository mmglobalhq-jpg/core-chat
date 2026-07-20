/**
 * GET /api/reits/reports?issuer=ARR — completed current reports for one issuer,
 * newest first (metadata only, no report body). Authenticated, read-only. Invalid
 * issuer symbols are rejected with 400 before any query runs.
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
    return reitJson({ issuer, reports: await listReports(issuer) });
  } catch (err) {
    return reitErrorResponse(err);
  }
}
