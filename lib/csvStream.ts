/**
 * Shared CSV plumbing for the /api/funds export routes: RFC 4180 cell quoting and a
 * chunked streaming response. The rows are already in memory (one RPC call returns
 * them all); the CSV text is produced a chunk of rows at a time so no single string
 * grows with the whole file.
 */
import { NextResponse } from "next/server";

// Rows serialised per stream chunk. Bounds the size of any one string, not a query.
export const CSV_CHUNK = 1000;

export function csvCell(v: string | number | boolean | null): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Stream `header` then `rows` (via `toRow`, one CSV line each) as a CSV download. */
export function csvResponse<R>(opts: {
  filename: string;
  header: string[];
  rows: R[];
  toRow: (row: R) => string;
}): NextResponse {
  const { filename, header, rows, toRow } = opts;
  const encoder = new TextEncoder();
  let offset = 0;
  let headerSent = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (!headerSent) {
        headerSent = true;
        controller.enqueue(encoder.encode(header.map(csvCell).join(",") + "\n"));
        return;
      }
      if (offset >= rows.length) {
        controller.close();
        return;
      }
      const slice = rows.slice(offset, offset + CSV_CHUNK);
      offset += slice.length;
      controller.enqueue(encoder.encode(slice.map(toRow).join("\n") + "\n"));
    },
  });

  return new NextResponse(stream, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
