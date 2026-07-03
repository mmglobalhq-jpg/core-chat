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

/** Which supervisor model was requested and which node(s) actually executed. */
export interface RouteMeta {
  /** Human label of the model selected in the dropdown at send time. */
  model: string;
  /** Backend orchestration `nodes_executed` (e.g. ["local_llm"]). */
  nodes: string[];
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
  /** Attached asynchronously by attachIntent() once routing resolves (FR-026). */
  intent?: IntentPayload;
  /** Routing path shown as a badge on assistant replies from the gateway. */
  route?: RouteMeta;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
