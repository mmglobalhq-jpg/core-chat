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
  // Redirect target: the configured OAuth origin (chat.mmglobal.us) — url.origin is
  // unreliable behind the Cloudflare tunnel (it resolved to localhost:3000).
  let site = process.env.NEXT_PUBLIC_SITE_URL || url.origin;
  try {
    if (process.env.GOOGLE_OAUTH_REDIRECT_URI) {
      site = new URL(process.env.GOOGLE_OAUTH_REDIRECT_URI).origin;
    }
  } catch {
    /* keep fallback */
  }
  const back = (status: string, reason?: string) =>
    NextResponse.redirect(`${site}/?google=${status}${reason ? `&reason=${reason}` : ""}`);

  const gErr = url.searchParams.get("error");
  if (gErr) {
    console.error("[google-callback] provider error:", gErr);
    return back("denied", gErr);
  }

  const code = url.searchParams.get("code");
  const userId = verifyState(url.searchParams.get("state")); // null if forged/expired
  if (!code) {
    console.error("[google-callback] no code param");
    return back("error", "nocode");
  }
  if (!userId) {
    console.error("[google-callback] state verification failed");
    return back("error", "state");
  }

  try {
    const tokens = await exchangeCodeForTokens(code);
    if (!tokens.refresh_token) {
      console.error("[google-callback] no refresh_token in exchange response");
      return back("error", "norefresh");
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
    if (error) {
      console.error("[google-callback] upsert failed:", error.message);
      return back("error", "store");
    }
    console.error("[google-callback] connected user", userId);
    return back("connected");
  } catch (e) {
    console.error("[google-callback] exchange threw:", e instanceof Error ? e.message : String(e));
    return back("error", "exchange");
  }
}
