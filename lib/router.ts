import type { IntentPayload, ModelTier } from "@/lib/types";

/**
 * PayloadRouter — derives a structured intent payload from raw message text.
 *
 * This phase is fully mocked and local (no network, no live AI — FR-022/FR-027).
 * The signature is async on purpose: a real Gemini-backed implementation (behind a
 * server route so the API key stays server-side) can replace the body later without
 * changing any caller. The mock is deterministic (a pure function of `text`) so it
 * is unit-testable without stubbing time or randomness.
 */
export async function routeMessage(text: string): Promise<IntentPayload> {
  return {
    primary_action: derivePrimaryAction(text),
    requires_tools: deriveRequiresTools(text),
    entities: deriveEntities(text),
    model_tier: deriveModelTier(text),
  };
}

// Leading imperative verbs we recognize as the primary action.
const IMPERATIVE_VERBS = [
  "write",
  "create",
  "build",
  "make",
  "summarize",
  "translate",
  "explain",
  "draft",
  "generate",
  "fix",
  "review",
  "plan",
];

// Keywords implying an external tool/action is needed.
const TOOL_KEYWORDS = [
  "search",
  "browse",
  "calculate",
  "weather",
  "email",
  "translate",
  "run",
  "code",
  "fetch",
  "download",
  "schedule",
  "book",
];

function derivePrimaryAction(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "chat";
  if (trimmed.endsWith("?")) return "question";

  const firstWord = trimmed.split(/\s+/)[0]?.toLowerCase().replace(/[^a-z]/g, "");
  if (firstWord && IMPERATIVE_VERBS.includes(firstWord)) return firstWord;

  return "chat";
}

function deriveRequiresTools(text: string): boolean {
  const lower = text.toLowerCase();
  return TOOL_KEYWORDS.some((kw) => new RegExp(`\\b${kw}\\b`).test(lower));
}

function deriveEntities(text: string): string[] {
  const words = text.split(/\s+/);
  const entities: string[] = [];
  for (let i = 0; i < words.length; i += 1) {
    const raw = words[i].replace(/[^A-Za-z0-9'-]/g, "");
    if (raw.length < 2) continue;
    // Capitalized token that is not the first word of the sentence.
    if (i > 0 && /^[A-Z][a-z0-9'-]+$/.test(raw) && !entities.includes(raw)) {
      entities.push(raw);
    }
  }
  return entities;
}

function deriveModelTier(text: string): ModelTier {
  const wordCount = text.trim().split(/\s+/).filter(Boolean).length;
  if (wordCount > 60) return "reasoning";
  if (deriveRequiresTools(text) || wordCount > 25) return "pro";
  return "flash";
}

/** Normalized reply the chat feed renders, produced by the /api/intent proxy. */
export interface GatewayReply {
  ok: boolean;
  text: string;
  outcome?: string | null;
  status?: string | null;
}

/**
 * Submit a message to the live gateway via the same-origin server proxy
 * (`app/api/intent/route.ts`). The proxy avoids CORS and maps the backend's
 * IntentPayload/orchestration envelope to { ok, text, ... }. A network failure
 * is returned as a graceful non-ok reply rather than thrown.
 */
export async function submitIntent(args: {
  intent: string;
  rawInput: string;
  modelPreference: string;
  entities?: string[];
}): Promise<GatewayReply> {
  try {
    const res = await fetch("/api/intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
    return (await res.json()) as GatewayReply;
  } catch (err) {
    return {
      ok: false,
      text: `⚠️ Network error contacting the app server: ${(err as Error).message}`,
    };
  }
}
