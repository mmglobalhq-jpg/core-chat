/**
 * GET /api/reits/issuers — the data-driven REIT dropdown source: every issuer that
 * has at least one completed report, with its report count and latest reporting
 * date. Authenticated chat users only; the REIT service-role credentials stay
 * server-side. Read-only.
 */
import { requireUser } from "@/lib/reqUser";
import { listIssuers } from "@/lib/reitResearch";
import { reitErrorResponse, reitJson } from "@/lib/reitsApi";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  try {
    return reitJson({ issuers: await listIssuers() });
  } catch (err) {
    return reitErrorResponse(err);
  }
}
