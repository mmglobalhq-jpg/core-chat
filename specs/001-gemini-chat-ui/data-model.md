# Phase 1 Data Model: Gemini-Style Chat UI

Frontend-only, in-memory model. Types live in `lib/types.ts`; the store shape lives in
`store/useChatStore.ts`. No database — mock data seeds from `lib/mock-data.ts` each session;
only the theme preference persists (via `next-themes` → localStorage).

## Types (`lib/types.ts`)

```ts
export type Role = "user" | "assistant";

export type ModelId = "gemini-2.5-flash" | "deepseek-v4-pro" | "gpt-5.5";

export interface ModelOption {
  id: ModelId;
  label: string; // "Gemini 2.5 Flash" | "DeepSeek V4 Pro" | "GPT-5.5"
}

export interface Message {
  id: string;
  role: Role;
  content: string;
  createdAt: number; // epoch ms; ordering within a conversation
}

export interface Conversation {
  id: string;
  title: string;      // shown in sidebar history
  messages: Message[];
  updatedAt: number;  // for sort order in history list
}
```

## Entities

### Conversation
- **Fields**: `id`, `title`, `messages[]`, `updatedAt`.
- **Relationships**: has many `Message` (ordered by `createdAt`).
- **Validation**: `title` non-empty (fallback: derive from first user message, else
  "New chat"). A new conversation starts with `messages: []`.
- **State**: exactly one conversation is "active" at a time (tracked by
  `activeConversationId` in the store, not on the entity).

### Message
- **Fields**: `id`, `role`, `content`, `createdAt`.
- **Validation**: `content` for a **user** message MUST be non-whitespace (enforced by
  `canSend`); assistant `content` comes from the mock generator.
- **Rendering rule**: `role === "user"` → right-aligned; `role === "assistant"` → left-aligned
  (FR-012).

### ModelOption / Model Selection
- **Fixed set** (FR-010), the only three allowed:
  - `{ id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" }`
  - `{ id: "deepseek-v4-pro",  label: "DeepSeek V4 Pro" }`
  - `{ id: "gpt-5.5",          label: "GPT-5.5" }`
- **Session state**: `selectedModelId` (default `"gemini-2.5-flash"`), persists for the
  session (FR-011). Does not alter mock replies (Assumptions).

### Theme Preference
- **Values**: `"light" | "dark" | "system"`. Owned entirely by `next-themes`; persisted to
  localStorage; not part of the Zustand store.

## Store shape (`store/useChatStore.ts`)

```ts
interface ChatStore {
  // model
  selectedModelId: ModelId;
  setSelectedModel: (id: ModelId) => void;

  // conversations (mock history)
  conversations: Conversation[];
  activeConversationId: string | null;

  // actions
  newConversation: () => void;                 // FR-007: create empty, make active
  selectConversation: (id: string) => void;    // FR-008: mark active (feed hydrates from it)
  appendMessage: (conversationId: string, message: Message) => void; // sync store on send/reply
}
```

**Notes**
- The active thread's live messages are driven by `useChat`; on `selectConversation`, the feed
  hydrates via `setMessages(conversation.messages)`. `appendMessage` keeps the store's copy in
  sync so the history list reflects the latest exchange and `updatedAt` ordering.
- `newConversation` pushes an empty `Conversation` and sets it active, clearing the feed
  (FR-007). Empty-history and empty-conversation empty states are UI concerns (Edge Cases).

## Derived / helper functions (`lib/`)

- `canSend(text: string): boolean` → `text.trim().length > 0` (FR-018, SC-005).
- `mockReply(userText: string): Message` → returns a canned assistant `Message` (FR-014).
- `MODEL_OPTIONS: ModelOption[]` → the fixed three (FR-010).
- `seedConversations(): Conversation[]` → ~5 sample threads for the sidebar (FR-023).
