/**
 * GET /api/reits/reports/[reportId]/pdf — one report as a downloadable PDF.
 *
 * Same gate, validation and 404 semantics as the sibling JSON route; the only
 * difference is the representation. The bytes are produced SERVER-SIDE, which is
 * deliberate on two counts:
 *
 *   1. It keeps the generator out of the browser bundle. `app/reits/__tests__/
 *      bundleScan` fails the build if reader-contract or Supabase identifiers
 *      ever reach `.next/static`, and a client-side renderer would be one
 *      careless import away from dragging them there.
 *   2. The filename is decided here, next to the data it describes, rather than
 *      being reconstructed from whatever the page happens to have in state.
 *
 * `Content-Disposition: attachment` and `Cache-Control: no-store` match the
 * `/api/funds/export` contract so both downloads behave identically.
 *
 * Unlike the funds export this does NOT stream: a PDF's cross-reference table is
 * written last, so the document is only valid once complete. Streaming a partial
 * PDF would hand the user a file that opens as corrupt — worse than an error.
 * Reports are prose (single-digit pages), so buffering is not a concern.
 */
import { NextResponse } from "next/server";

import { renderReportPdf, reportPdfFilename } from "@/lib/reitPdf";
import { getReport, validateReportId } from "@/lib/reitResearch";
import { reitErrorResponse, reitJson } from "@/lib/reitsApi";
import { requireUser } from "@/lib/reqUser";

export const dynamic = "force-dynamic";
// PDFKit is a Node library (Buffers, streams, its own font metrics) — it cannot
// run on the edge runtime.
export const runtime = "nodejs";

export async function GET(request: Request, ctx: { params: Promise<{ reportId: string }> }) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  try {
    const { reportId: raw } = await ctx.params;
    const reportId = validateReportId(raw);
    const report = await getReport(reportId);
    if (!report) return reitJson({ error: "Report not found" }, 404);

    const pdf = await renderReportPdf(report);
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${reportPdfFilename(report)}"`,
        "Content-Length": String(pdf.byteLength),
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    // Errors stay JSON even though the success path is binary: the client reads
    // `error` from the body on a non-OK response, exactly as the funds export does.
    return reitErrorResponse(err);
  }
}
