export type Role = "user" | "assistant";

export type ModelId = "gemini-2.5-flash" | "deepseek-v4-pro" | "gpt-5.5";

export interface ModelOption {
  id: ModelId;
  label: string;
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  messages: Message[];
  updatedAt: number;
}
