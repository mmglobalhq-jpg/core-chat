import { NextResponse } from "next/server";
import { requireAdmin } from "@/lib/adminAuth";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

type EnrichRow = {
  cusip: string;
  security_des: string | null;
  cpn: number | null;
  wam: number | null;
  wala: number | null;
  gen_ticker: string | null;
  cohort: string | null;
  sec_type: string | null;
};

/**
 * ADMIN-ONLY: upsert CUSIP enrichment from an imported CSV. The client parses +
 * maps the CSV and POSTs { rows: EnrichRow[] }; we dedupe by CUSIP (last wins,
 * since a single upsert can't touch the same key twice) and upsert in batches.
 * Merge semantics: existing CUSIPs not in the file are left untouched.
 */
export async function POST(request: Request) {
  const gate = await requireAdmin(request);
  if ("error" in gate) return gate.error;

  let body: { rows?: EnrichRow[] };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid JSON body" }, { status: 400 });
  }

  const byCusip = new Map<string, EnrichRow>();
  for (const r of body.rows ?? []) {
    const cusip = String(r?.cusip ?? "").trim();
    if (cusip) byCusip.set(cusip, r);
  }
  if (byCusip.size === 0) {
    return NextResponse.json({ error: "no rows with a cusip" }, { status: 400 });
  }

  const now = new Date().toISOString();
  const payload = [...byCusip.entries()].map(([cusip, r]) => ({
    cusip,
    security_des: r.security_des ?? null,
    cpn: r.cpn ?? null,
    wam: r.wam ?? null,
    wala: r.wala ?? null,
    gen_ticker: r.gen_ticker ?? null,
    cohort: r.cohort ?? null,
    sec_type: r.sec_type ?? null,
    updated_at: now,
  }));

  const db = getSupabaseAdmin();
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await db
      .from("cusip_enrichment")
      .upsert(payload.slice(i, i + 500), { onConflict: "cusip" });
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ imported: payload.length });
}
