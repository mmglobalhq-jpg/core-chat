export type Role = "user" | "assistant";

export type ModelId = "gemini-2.5-flash" | "deepseek-v4-pro" | "gpt-5.5";

export interface ModelOption {
  id: ModelId;
  label: string;
}

/** Suggested capability tier for handling a message (finite set — FR-029). */
export type ModelTier = "flash" | "pro" | "reasoning";

/** Structured interpretation of a submitted message, derived by the PayloadRouter. */
export interface IntentPayload {
  primary_action: string;
  requires_tools: boolean;
  entities: string[];
  model_tier: ModelTier;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Attached asynchronously by attachIntent() once routing resolves (FR-026). */
  intent?: IntentPayload;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
  /**
   * True once a corresponding row exists in Supabase `chats` (persisted history).
   * A brand-new, never-sent conversation is `false` and stays hidden from the
   * sidebar history until it has messages. Client-only; not sent to the backend.
   */
  persisted?: boolean;
  /**
   * True once this conversation's messages have been hydrated from Supabase.
   * Metadata-only conversations (loaded via `listChats`) start `false` and are
   * lazily filled on first select. Client-only.
   */
  loaded?: boolean;
}

/** A `public.chats` row as selected from Supabase (metadata only, no messages). */
export interface ChatRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}
