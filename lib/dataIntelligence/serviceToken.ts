/**
 * Short-lived service-token minting for the gateway (server-only).
 *
 * The token is an ordinary HS256 service token — NOT an approval token. Its
 * subject is the VERIFIED chat user id (never anything from the request body).
 * The signing secret is read from server-only env and must match the gateway's
 * DIG_SERVICE_TOKEN_SECRET. The user's Supabase JWT is never forwarded.
 */

import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";

const ISSUER = "core-chat";
const AUDIENCE = "data-intelligence-gateway";
const MAX_LIFETIME_SECONDS = 120;

export type MintOptions = {
  /** Verified user id (from requireUser) — becomes the token subject. */
  subject: string;
  conversationId?: string | null;
  requestId?: string | null;
  /** Seconds; clamped to <= 120. */
  lifetimeSeconds?: number;
};

function signingKey(): Uint8Array {
  const secret = process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
  if (!secret) {
    throw new Error("DATA_INTELLIGENCE_SIGNING_SECRET is not configured");
  }
  return new TextEncoder().encode(secret);
}

/**
 * Mint a service token scoped to the funds capability. Reusable during its
 * validity window (no single-use/approval semantics). Never logged.
 */
export async function mintServiceToken(opts: MintOptions): Promise<string> {
  const lifetime = Math.min(opts.lifetimeSeconds ?? MAX_LIFETIME_SECONDS, MAX_LIFETIME_SECONDS);
  const now = Math.floor(Date.now() / 1000);

  const claims: Record<string, unknown> = {
    token_type: "service",
    roles: ["chat_user"],
    scope: "funds",
  };
  if (opts.conversationId) claims.conversation_id = opts.conversationId;
  if (opts.requestId) claims.request_id = opts.requestId;

  return new SignJWT(claims)
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setSubject(opts.subject)
    .setIssuedAt(now)
    .setJti(randomUUID())
    .setExpirationTime(now + lifetime)
    .sign(signingKey());
}
