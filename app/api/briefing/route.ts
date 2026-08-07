/**
 * Read the caller's briefing for a given day.
 *
 * The caller is resolved from their bearer token and the query is filtered by
 * THAT id — never by an id supplied in the request. RLS is the backstop, not the
 * control: this route uses the service-role client (like every other route
 * here), which bypasses RLS, so the filter below is what actually enforces
 * isolation. Getting this wrong would expose every user's briefing to every
 * other user, and no database policy would catch it.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The shape this route selects.
 *
 * Declared by hand because there are no generated Supabase types for the
 * briefing tables, so the client infers the embedded `briefing_sections` select
 * as an error union. Kept in step with the select string below and with
 * migration 0008.
 */
interface BriefingRow {
  id: string;
  briefing_date: string;
  status: string;
  generated_at: string | null;
  briefing_sections: Array<{
    kind: string;
    rank: number;
    headline: string;
    body: string;
    url: string;
    source_name: string | null;
    published_at: string | null;
  }> | null;
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const url = new URL(request.url);
  const date = url.searchParams.get("date") ?? "";
  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "date must be YYYY-MM-DD" }, { status: 400 });
  }

  let query = getSupabaseAdmin()
    .from("briefings")
    .select(
      "id, briefing_date, status, generated_at, " +
        "briefing_sections(kind, rank, headline, body, url, source_name, published_at)",
    )
    // The caller's own id, from the verified token. Not from the request.
    .eq("user_id", gate.user.id);

  query = date
    ? query.eq("briefing_date", date)
    : query.order("briefing_date", { ascending: false }).limit(1);

  const { data, error } = await query;
  if (error) {
    console.error("briefing fetch failed", error.message);
    return NextResponse.json({ error: "Could not load briefing" }, { status: 500 });
  }

  const row = (data as unknown as BriefingRow[] | null)?.[0];
  if (!row) {
    // Absence is a normal state — no briefing has been generated yet — so it is
    // not an error, and the UI renders an empty state rather than a failure.
    return NextResponse.json({ briefing: null }, { status: 200 });
  }

  return NextResponse.json({
    briefing: {
      id: row.id,
      briefing_date: row.briefing_date,
      status: row.status,
      generated_at: row.generated_at,
      sections: row.briefing_sections ?? [],
    },
  });
}
