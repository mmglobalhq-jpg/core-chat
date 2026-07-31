/**
 * Server-only HTTP client for the data-intelligence gateway.
 *
 * - The gateway URL is read from server-only env (never exposed to the browser).
 * - Bounded retry on NETWORK/timeout errors only; HTTP status responses
 *   (abstention/clarification are 200; 4xx/5xx are surfaced) are never retried.
 * - The Authorization header / token is never logged.
 */

export class GatewayNetworkError extends Error {}

export type GatewayCallResult = { status: number; body: unknown };

export function gatewayUrl(): string {
  const url = process.env.DATA_INTELLIGENCE_GATEWAY_URL;
  if (!url) throw new Error("DATA_INTELLIGENCE_GATEWAY_URL is not configured");
  return url.replace(/\/+$/, "");
}

export async function postQuery(
  body: unknown,
  opts: {
    token: string;
    correlationId: string;
    timeoutMs?: number;
    maxNetworkRetries?: number;
    fetchImpl?: typeof fetch;
  },
): Promise<GatewayCallResult> {
  const url = `${gatewayUrl()}/v1/query`;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  const maxRetries = opts.maxNetworkRetries ?? 1;
  const doFetch = opts.fetchImpl ?? fetch;

  let attempt = 0;
  for (;;) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const resp = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${opts.token}`,
          "X-Correlation-ID": opts.correlationId,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const json = (await resp.json().catch(() => null)) as unknown;
      return { status: resp.status, body: json };
    } catch {
      // Network failure or timeout (AbortError). Retry within bounds, then fail
      // with a safe error that carries no internal detail or token.
      if (attempt < maxRetries) {
        attempt += 1;
        continue;
      }
      throw new GatewayNetworkError("gateway unreachable");
    } finally {
      clearTimeout(timer);
    }
  }
}
