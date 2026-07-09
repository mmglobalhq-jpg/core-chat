import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type CusipRow = { cusip: string; description: string | null; security_type: string | null };

/** Wrap a CSV field in quotes iff it needs it, escaping embedded quotes. */
function csv(value: string | null): string {
  const s = value ?? "";
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * ADMIN-ONLY: download every distinct CUSIP in the database (with its most recent
 * description + security type) as a CSV. Gated by requireAdmin — a non-admin
 * token gets 401/403 even though the UI hides the button.
 */
export async function GET(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  // PostgREST caps a response at 1000 rows, so page through the full set.
  const db = getSupabaseAdmin();
  const CHUNK = 1000;
  const rows: CusipRow[] = [];
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await db.rpc("export_cusips").range(from, from + CHUNK - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    const batch = (data ?? []) as CusipRow[];
    rows.push(...batch);
    if (batch.length < CHUNK) break;
  }
  const lines = ["cusip,description,security_type"];
  for (const r of rows) {
    lines.push([csv(r.cusip), csv(r.description), csv(r.security_type)].join(","));
  }
  // Prepend a BOM so Excel opens UTF-8 correctly.
  const body = "﻿" + lines.join("\r\n") + "\r\n";

  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'attachment; filename="cusips.csv"',
      "Cache-Control": "no-store",
    },
  });
}
