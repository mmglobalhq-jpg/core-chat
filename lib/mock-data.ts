import type { Conversation, Message, ModelId, ModelOption } from "@/lib/types";

/** The only three selectable models (FR-010). */
export const MODEL_OPTIONS: ModelOption[] = [
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "deepseek-v4-pro", label: "DeepSeek V4 Pro" },
  { id: "gpt-5.5", label: "GPT-5.5" },
];

export const DEFAULT_MODEL_ID: ModelId = "gemini-2.5-flash";

export function modelLabel(id: ModelId): string {
  return MODEL_OPTIONS.find((m) => m.id === id)?.label ?? id;
}

export function isModelId(value: string): value is ModelId {
  return MODEL_OPTIONS.some((m) => m.id === value);
}

/**
 * Whether the Send control should be active (FR-018, SC-005).
 * True only when the input contains non-whitespace text.
 */
export function canSend(text: string): boolean {
  return text.trim().length > 0;
}

/** Stable-ish id generator that does not rely on Date.now/Math.random at module load. */
let idCounter = 0;
export function createId(prefix = "id"): string {
  idCounter += 1;
  return `${prefix}-${idCounter}-${idCounter.toString(36)}`;
}

const MOCK_REPLIES = [
  "Here's a mocked response — the backend isn't wired up yet, so this is placeholder text standing in for a real model reply.",
  "Good question. This is a local mock, so I'm returning canned text instead of calling an AI service.",
  "I can't actually answer that yet (frontend-only build), but this bubble shows how an assistant reply will render.",
  "Pretend this is a thoughtful, well-structured answer. For now it's mock content to demonstrate the chat feed.",
];

/** Returns a canned assistant message for the given user text (FR-014). */
export function mockReply(userText: string): Message {
  const index = Math.abs(hashString(userText)) % MOCK_REPLIES.length;
  return {
    id: createId("assistant"),
    role: "assistant",
    content: MOCK_REPLIES[index],
    createdAt: 0,
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  return hash;
}

function msg(role: Message["role"], content: string, order: number): Message {
  return { id: createId(role), role, content, createdAt: order };
}

/** Seeds ~5 sample conversations for the sidebar history list (FR-023). */
export function seedConversations(): Conversation[] {
  return [
    {
      id: createId("conv"),
      title: "Weekend trip ideas",
      updatedAt: 5,
      messages: [
        msg("user", "Suggest a relaxing weekend trip within a 3-hour drive.", 1),
        msg(
          "assistant",
          "A lakeside cabin is a classic choice — quiet mornings, easy hikes, and a short enough drive to feel worth it for two nights.",
          2,
        ),
      ],
    },
    {
      id: createId("conv"),
      title: "Refactor a React hook",
      updatedAt: 4,
      messages: [
        msg("user", "How do I stop my useEffect from firing twice?", 1),
        msg(
          "assistant",
          "In development, React 19 Strict Mode intentionally double-invokes effects to surface cleanup bugs. Make the effect idempotent rather than trying to suppress it.",
          2,
        ),
      ],
    },
    {
      id: createId("conv"),
      title: "Dinner: pantry-only",
      updatedAt: 3,
      messages: [
        msg("user", "What can I cook with pasta, canned tomatoes, and garlic?", 1),
        msg(
          "assistant",
          "A quick aglio e pomodoro: bloom the garlic in oil, add the tomatoes, simmer, then toss with pasta and a splash of the starchy water.",
          2,
        ),
      ],
    },
    {
      id: createId("conv"),
      title: "Explain vector databases",
      updatedAt: 2,
      messages: [
        msg("user", "Explain vector databases like I'm five.", 1),
        msg(
          "assistant",
          "Imagine every idea gets turned into a point on a giant map. A vector database finds the points sitting closest together — that's how it finds things that 'mean' the same.",
          2,
        ),
      ],
    },
    {
      id: createId("conv"),
      title: "Draft a standup update",
      updatedAt: 1,
      messages: [
        msg("user", "Write a two-line standup update for finishing the auth flow.", 1),
        msg(
          "assistant",
          "Yesterday: shipped the login/logout flow and session handling. Today: wiring password reset and starting on tests.",
          2,
        ),
      ],
    },
  ];
}
