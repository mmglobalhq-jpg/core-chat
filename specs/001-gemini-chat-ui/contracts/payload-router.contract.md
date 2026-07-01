# Contract: PayloadRouter (Message Intent Routing)

Amendment 2026-07-01. Frontend-only, mocked (FR-022/FR-027) — **no REST/GraphQL endpoint**.
The contract is the local async interface between the submit handler, the router module, and
the store. Keeping it stable lets a real Gemini-backed implementation (behind a server route)
replace the mock without changing callers.

## A. Router — `lib/router.ts`

```ts
routeMessage(text: string): Promise<IntentPayload>
```

- **Precondition**: `text` is the raw submitted message (already passed `canSend`).
- **Postcondition**: resolves to a **complete** `IntentPayload` — all four fields present and
  correctly typed, `model_tier ∈ {"flash","pro","reasoning"}` (FR-025, FR-029, SC-009).
- **Never throws for normal input**; async by contract even though the mock is local.
- **No-network invariant**: no `fetch` to any origin (FR-022/FR-027). The deferred real impl
  will call Gemini via a **server route**, still behind this same signature.

## B. Store action — `attachIntent`

| Action | Input | Effect | Maps to |
|--------|-------|--------|---------|
| `attachIntent` | `conversationId`, `messageId`, `IntentPayload` | sets `intent` on that message | FR-024, FR-026 |

**Invariants**
- No-op if the conversation or message is absent (FR-028 — never throws, never blocks).
- Does not change message order, `updatedAt`, or the assistant-reply flow.

## C. Submit-handler behavior — `app/page.tsx handleSend`

```
on submit(text):
  append user message (optimistic, store + useChat)   # instant — FR-013
  start mocked assistant reply flow                    # unchanged
  routeMessage(text)                                   # NOT awaited — FR-026 / SC-008
    .then(p => attachIntent(convId, userMsgId, p))
    .catch(() => {})                                   # graceful — FR-028
```

- **Non-blocking invariant**: message rendering and reply flow never wait on routing; a
  routing failure/timeout leaves the conversation fully functional (SC-008 = 0% blocked/dropped).

## D. Acceptance mapping

- **FR-024/FR-025 / SC-009**: A (`routeMessage` returns complete typed payload).
- **FR-026 / SC-008**: C (fire-and-forget, message instant).
- **FR-027 / FR-022**: A (no network; async seam for real impl).
- **FR-028**: B + C (`attachIntent` no-op + swallowed catch).
- **FR-029**: A (`model_tier` from the finite `ModelTier` set).

## E. Test hooks (unit)

| Function | Contract under test |
|----------|---------------------|
| `routeMessage` | complete payload; correct types; `model_tier` in set; deterministic for same input; `requires_tools` toggles on keyword text |
| `attachIntent` | attaches payload to the right message; no-op on unknown ids |
