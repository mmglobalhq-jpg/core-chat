/**
 * GET /api/funds/list?manager= — the funds available for a nullable manager
 * selection (fund choices depend on the selected manager). NULL manager = all.
 * Authenticated, read-only.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";

export const dynamic = "force-dynamic";

type Fund = { ticker: string; fund_manager: string };

function opt(v: string | null): string | null {
  if (!v) return null;
  const t = v.trim();
  return t === "" || t.toLowerCase() === "all" ? null : t;
}

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const sp = new URL(request.url).searchParams;
  const res = await callRpc<Fund[]>("get_funds", { p_manager: opt(sp.get("manager")) });
  if (res.error) return res.error;
  return NextResponse.json({ funds: res.data });
}
