import { NextResponse } from "next/server";
import { getSupabaseAdmin } from "@/lib/supabaseAdmin";
import { verifyState, exchangeCodeForTokens, emailFromIdToken } from "@/lib/googleOAuth";

export const runtime = "nodejs";

// Google redirects here after consent. There is no session on this request, so the
// user is identified from the SIGNED `state` (see googleOAuth.verifyState). We
// exchange the code for tokens and store them (service role), then bounce back to
// the app with a status flag.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const site = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  const back = (status: string) => NextResponse.redirect(`${site}/?google=${status}`);

  if (url.searchParams.get("error")) return back("denied");

  const code = url.searchParams.get("code");
  const userId = verifyState(url.searchParams.get("state")); // null if forged/expired
  if (!code || !userId) return back("error");

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      // Should not happen with prompt=consent; without it we can't refresh later.
      return back("error");
    }
    const expiry = new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000).toISOString();
    const { error } = await getSupabaseAdmin().from("google_credentials").upsert({
      user_id: userId,
      email: emailFromIdToken(tokens.id_token),
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      scope: tokens.scope ?? null,
      expiry,
      updated_at: new Date().toISOString(),
    });
    if (error) return back("error");
    return back("connected");
  } catch {
    return back("error");
  }
}
