/**
 * GET /api/funds/options — initial dropdown data for the Fund Manager page:
 * the list of managers, all funds (with their manager), and the latest available
 * accepted as_of_date. Authenticated chat users only; the poller credentials stay
 * server-side. Read-only.
 */
import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { callRpc } from "@/lib/fundsRpc";

export const dynamic = "force-dynamic";

type Fund = { ticker: string; fund_manager: string };

export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;

  const managers = await callRpc<{ manager: string }[]>("get_fund_managers", {});
  if (managers.error) return managers.error;
  const funds = await callRpc<Fund[]>("get_funds", { p_manager: null });
  if (funds.error) return funds.error;
  const latest = await callRpc<string | null>("get_fund_latest_as_of_date", {
    p_manager: null,
    p_fund: null,
  });
  if (latest.error) return latest.error;

  return NextResponse.json({
    managers: managers.data.map((m) => m.manager),
    funds: funds.data,
    latestDate: latest.data,
  });
}
