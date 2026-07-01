# Contract: Mock Chat Service & Store Actions

This feature is frontend-only (FR-022) — there is **no REST/GraphQL endpoint**. The "contract"
is therefore the local interface between UI components and (a) the Zustand store and (b) the
`useChat` mock transport. Keeping these signatures stable is what lets a real backend drop in
later by swapping only the mock transport.

## A. `useChat` mock transport

**Shape**: `useChat` is configured with a local transport that, given the submitted user
message, resolves an assistant message without any network I/O.

```
submit(userText: string)
  → append user Message (role: "user", content: userText) to active thread
  → resolve assistant Message (role: "assistant", content: mockReply(userText).content)
     [optional simulated delay ≤ ~600ms]
```

- **Preconditions**: `canSend(userText) === true`.
- **Postconditions**: feed contains the user message (right) followed by the assistant message
  (left); input is cleared (FR-013); feed auto-scrolls to latest (FR-015).
- **No-network invariant**: no `fetch` to any origin; the transport resolves in-process.

## B. Store action contracts (`useChatStore`)

| Action | Input | Effect | Maps to |
|--------|-------|--------|---------|
| `setSelectedModel` | `ModelId` (must be one of the three) | updates `selectedModelId`; header reflects it | FR-010, FR-011 |
| `newConversation` | — | creates empty `Conversation`, sets it active, feed clears | FR-007 |
| `selectConversation` | `id: string` | sets `activeConversationId`; feed hydrates from that conversation's messages | FR-008 |
| `appendMessage` | `conversationId`, `Message` | appends message, bumps `updatedAt` | FR-013, FR-014 |

**Invariants**
- `selectedModelId` is always one of `MODEL_OPTIONS` ids (never arbitrary).
- Exactly one `activeConversationId` (or `null` only transiently before first render).
- Message order within a conversation is non-decreasing by `createdAt`.

## C. Pure helpers (unit-tested)

| Function | Signature | Contract |
|----------|-----------|----------|
| `canSend` | `(text: string) => boolean` | `true` iff `text.trim().length > 0` (FR-018, SC-005) |
| `mockReply` | `(userText: string) => Message` | returns assistant `Message`, non-empty content (FR-014) |
| `seedConversations` | `() => Conversation[]` | returns ≥1 sample conversation (FR-023) |

## D. Acceptance mapping

- **US1 / FR-013–015, SC-001, SC-005**: A + C (`canSend`, mock transport, auto-scroll).
- **US2 / FR-007–008, SC-007**: B (`newConversation`, `selectConversation`).
- **US3 / FR-010–011, SC-002**: B (`setSelectedModel`) + fixed `MODEL_OPTIONS`.
- **US4 / FR-020–021, SC-003**: handled by `next-themes` (outside store; see quickstart).
