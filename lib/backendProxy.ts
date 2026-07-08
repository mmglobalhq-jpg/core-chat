/**
 * Shared helpers for the server-side proxy routes that forward to the
 * core-heartbeat FastAPI gateway. Both `app/api/intent` and `app/api/title`
 * resolve the backend URL, build the forwarded auth/CF-Access headers, and
 * sanitize `{role, content}[]` turns the same way — this is the single source.
 */

export const BACKEND_URL =
  process.env.CORE_API_URL ??
  process.env.NEXT_PUBLIC_API_URL ??
  process.env.API_BASE_URL ??
  "https://api.mmglobal.us";

/** Absolute backend URL for a gateway path (e.g. `backendUrl("/title")`). */
export const backendUrl = (path: string): string => `${BACKEND_URL}${path}`;

export type Turn = { role: "user" | "assistant"; content: string };

const MAX_TURNS = 40;
const MAX_CONTENT = 8000;

/**
 * Coerce arbitrary input to the strict {role, content} turn contract: drop
 * malformed entries, cap each content's length, and keep only the most recent
 * MAX_TURNS (bounds the payload on the wire; the backend caps again to its own N).
 */
export function toTurns(raw: unknown): Turn[] {
  if (!Array.isArray(raw)) return [];
  const turns: Turn[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const role = (item as { role?: unknown }).role;
    const content = (item as { content?: unknown }).content;
    if ((role === "user" || role === "assistant") && typeof content === "string") {
      turns.push({ role, content: content.slice(0, MAX_CONTENT) });
    }
  }
  return turns.slice(-MAX_TURNS);
}

/**
 * Headers forwarded to the gateway: the caller's Supabase Bearer JWT (identity)
 * plus, when the target is the Cloudflare-protected edge, the Access service-token
 * headers from server-only env so the request clears Zero Trust.
 */
export function backendHeaders(
  request: Request,
  extra?: Record<string, string>,
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...extra,
  };
  const authHeader = request.headers.get("authorization");
  if (authHeader) headers.Authorization = authHeader;
  const cfClientId = process.env.CF_ACCESS_CLIENT_ID;
  const cfClientSecret = process.env.CF_ACCESS_CLIENT_SECRET;
  if (cfClientId && cfClientSecret) {
    headers["CF-Access-Client-Id"] = cfClientId;
    headers["CF-Access-Client-Secret"] = cfClientSecret;
  }
  return headers;
}
