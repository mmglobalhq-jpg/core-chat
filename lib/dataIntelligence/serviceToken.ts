/**
 * Short-lived service-token minting for the gateway (server-only).
 *
 * The token is an ordinary HS256 service token — NOT an approval token. Its
 * subject is the VERIFIED chat user id (never anything from the request body).
 * The signing secret must match the gateway's DIG_SERVICE_TOKEN_SECRET. The
 * user's Supabase JWT is never forwarded.
 *
 * Secret sources, in precedence order (both server-only; NEVER NEXT_PUBLIC_):
 *   1. DATA_INTELLIGENCE_SIGNING_SECRET_FILE — a path to a protected file, e.g.
 *      /run/secrets/dig_service_token_secret mounted read-only. Authoritative in
 *      production: the value stays out of the process environment and out of
 *      `docker inspect`.
 *   2. DATA_INTELLIGENCE_SIGNING_SECRET — an inline value, for local
 *      development and tests only, used when the _FILE variable is unset.
 *
 * The secret is never logged, serialized, returned, or included in an error
 * message, and never reaches the browser.
 */

import { SignJWT } from "jose";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

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

/**
 * Resolve the signing secret. Read on every mint — deliberately NOT cached, so a
 * rotated secret file takes effect without a restart (the file is tiny and the
 * read is synchronous and server-side only).
 *
 * Error messages name the variable, never the value: a thrown error must be safe
 * to log.
 */
function signingKey(): Uint8Array {
  const file = process.env.DATA_INTELLIGENCE_SIGNING_SECRET_FILE;
  let secret: string | undefined;

  if (file) {
    // The file source is authoritative whenever it is configured; we do NOT
    // silently fall back to the env value, because that could mint tokens with
    // a stale secret the gateway no longer accepts.
    let contents: string;
    try {
      contents = readFileSync(file, "utf8");
    } catch {
      // Never echo the file contents or the underlying error detail.
      throw new Error(
        "DATA_INTELLIGENCE_SIGNING_SECRET_FILE is set but the file could not be read",
      );
    }
    // Strip exactly one trailing newline (common when a secret file is written
    // by a shell); any other whitespace is preserved as part of the secret.
    secret = contents.replace(/\r?\n$/, "");
    if (!secret) {
      throw new Error("DATA_INTELLIGENCE_SIGNING_SECRET_FILE points to an empty file");
    }
  } else {
    // Local development and tests only.
    secret = process.env.DATA_INTELLIGENCE_SIGNING_SECRET;
  }

  if (!secret) {
    throw new Error(
      "no signing secret configured: set DATA_INTELLIGENCE_SIGNING_SECRET_FILE " +
        "(production) or DATA_INTELLIGENCE_SIGNING_SECRET (local/dev/test)",
    );
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
