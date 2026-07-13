import { NextResponse } from "next/server";
import { requireUser } from "@/lib/reqUser";
import { buildConsentUrl } from "@/lib/googleOAuth";

export const runtime = "nodejs";

// Returns the Google consent URL for the signed-in user. The client redirects the
// browser to it (the session lives in localStorage, so we can't do a server 302
// off a bare navigation). The user id is signed into the OAuth `state`.
export async function GET(request: Request) {
  const gate = await requireUser(request);
  if ("error" in gate) return gate.error;
  try {
    return NextResponse.json({ url: buildConsentUrl(gate.user.id) });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Google OAuth not configured" },
      { status: 500 },
    );
  }
}
