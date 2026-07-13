/**
 * Server-ONLY Google OAuth helpers for the Calendar integration.
 *
 * The browser session lives in localStorage (not cookies), so Google's callback
 * redirect can't carry it. Instead the connect route signs the user's id into the
 * OAuth `state` (HMAC, short-lived); the callback verifies that signature to learn
 * who is connecting. Never import this from a client component — it reads secrets.
 */
import crypto from "crypto";

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_URL = "https://oauth2.googleapis.com/revoke";

// openid+email so the callback can display the connected account; calendar for
// view/edit/delete/manage. Adjust to calendar.events for a tighter scope.
export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar",
].join(" ");

const STATE_TTL_MS = 15 * 60 * 1000; // signed state is valid for 15 minutes

function clientId(): string {
  const v = process.env.GOOGLE_CLIENT_ID;
  if (!v) throw new Error("Missing GOOGLE_CLIENT_ID");
  return v;
}
function clientSecret(): string {
  const v = process.env.GOOGLE_CLIENT_SECRET;
  if (!v) throw new Error("Missing GOOGLE_CLIENT_SECRET");
  return v;
}
export function redirectUri(): string {
  const v = process.env.GOOGLE_OAUTH_REDIRECT_URI;
  if (!v) throw new Error("Missing GOOGLE_OAUTH_REDIRECT_URI");
  return v;
}

// --- signed state (CSRF-safe user binding for the callback) -----------------

function stateKey(): Buffer {
  // Derive an HMAC key from the service-role secret (server-only, strong) with a
  // label so it isn't the raw key. Avoids adding yet another secret to manage.
  const base = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  return crypto.createHash("sha256").update(base + "|google-oauth-state").digest();
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function signState(userId: string): string {
  const payload = b64url(Buffer.from(JSON.stringify({ u: userId, t: Date.now() })));
  const sig = b64url(crypto.createHmac("sha256", stateKey()).update(payload).digest());
  return `${payload}.${sig}`;
}

export function verifyState(state: string | null): string | null {
  if (!state || !state.includes(".")) return null;
  const [payload, sig] = state.split(".");
  const expected = b64url(crypto.createHmac("sha256", stateKey()).update(payload).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const { u, t } = JSON.parse(Buffer.from(payload, "base64url").toString());
    if (typeof u !== "string" || typeof t !== "number") return null;
    if (Date.now() - t > STATE_TTL_MS) return null; // expired
    return u;
  } catch {
    return null;
  }
}

// --- consent URL + token exchange -------------------------------------------

export function buildConsentUrl(userId: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES,
    access_type: "offline", // ask for a refresh token
    prompt: "consent", // force consent so a refresh token is always returned
    include_granted_scopes: "true",
    state: signState(userId),
  });
  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  id_token?: string;
}

export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new Error(`token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

/** Email of the connected Google account, decoded from the id_token payload. The
 *  id_token came straight from Google's token endpoint over TLS, so we trust it
 *  without re-verifying the signature here. */
export function emailFromIdToken(idToken: string | undefined): string | null {
  if (!idToken) return null;
  try {
    const payload = JSON.parse(Buffer.from(idToken.split(".")[1], "base64url").toString());
    return typeof payload.email === "string" ? payload.email : null;
  } catch {
    return null;
  }
}

export async function revokeToken(token: string): Promise<void> {
  try {
    await fetch(`${GOOGLE_REVOKE_URL}?token=${encodeURIComponent(token)}`, { method: "POST" });
  } catch {
    // best-effort: even if revoke fails, we still delete our stored copy
  }
}
