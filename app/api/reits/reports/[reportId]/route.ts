/**
 * GET /api/reits/reports/[reportId] — one completed current report with its full
 * Markdown body. Authenticated, read-only. The report id is validated as a namespaced
 * `arr:<uuid>` / `orc:<uuid>` id, or a transitional legacy bare ARR UUID (400 on
 * malformed input); an unknown or non-current report is 404. The report body is read
 * server-side via the reader RPC — no Storage object path or public URL is ever
 * exposed to the browser.
 */
import { requireUser } from "@/lib/reqUser";
import { getReport, validateReportId } from "@/lib/reitResearch";
import { reitErrorResponse, reitJson } from "@/lib/reitsApi";

export const dynamic = "force-dynamic";

export async function GET(request: Request, ctx: { params: Promise<{ reportId: string }> }) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  try {
    const { reportId: raw } = await ctx.params;
    const reportId = validateReportId(raw);
    const report = await getReport(reportId);
    if (!report) return reitJson({ error: "Report not found" }, 404);
    return reitJson({ report });
  } catch (err) {
    return reitErrorResponse(err);
  }
}
