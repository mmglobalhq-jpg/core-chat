/**
 * Server-side feature flags for the optional data-intelligence gateway tool.
 *
 * Both default to FALSE. When disabled, no tool is exposed to the chat model and
 * existing Core Chat behavior is unchanged. This is the rollback switch: flip
 * either flag back to `false` (or unset) to fully disable the integration.
 *
 * These are read from server-only env (never prefixed NEXT_PUBLIC), so the
 * browser never learns the gateway URL, signing secret, or even that the tool
 * exists.
 */

function truthy(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** Master switch for the data-intelligence integration. */
export function isDataIntelligenceEnabled(): boolean {
  return truthy(process.env.DATA_INTELLIGENCE_ENABLED);
}

/** Funds mode specifically (requires the master switch too). */
export function isFundsModeEnabled(): boolean {
  return isDataIntelligenceEnabled() && truthy(process.env.DATA_INTELLIGENCE_FUNDS_ENABLED);
}

/** The only mode exposed to the chat model in this milestone. */
export function enabledModes(): Array<"funds"> {
  return isFundsModeEnabled() ? ["funds"] : [];
}
