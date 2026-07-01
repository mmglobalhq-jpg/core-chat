# Implementation Plan: Gemini-Style Chat UI (Frontend Shell)

**Branch**: `001-gemini-chat-ui` | **Date**: 2026-07-01 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-gemini-chat-ui/spec.md`

**Note**: This template is filled in by the `/speckit-plan` command. See `.specify/templates/plan-template.md` for the execution workflow.

## Summary

Build the frontend shell of a personal AI assistant as a pixel-perfect Gemini clone with
three zones — collapsible left sidebar, model-selector header, and a centered chat feed
with a floating pill input. All backend calls, AI responses, and chat history are mocked
locally. Technical approach: a Next.js 15 App Router app styled with Tailwind v4 and
shadcn/ui primitives, client state in a single Zustand store (`useChatStore`), theming via
`next-themes`, and message state via the Vercel AI SDK `useChat` hook wired to a local mock
transport (no live network). `app/page.tsx` composes the zones with Flexbox so the page
never scrolls — only `ChatFeed` scrolls behind the floating `ChatInput`.

## Technical Context

**Language/Version**: TypeScript 5.x (strict), React 19, Node 20+

**Primary Dependencies**: Next.js 15 (App Router), Tailwind CSS v4, shadcn/ui, Zustand,
`next-themes`, Vercel AI SDK (`ai` / `@ai-sdk/react` `useChat`), `lucide-react` (icons
shipped with shadcn)

**Storage**: None (backend-free). Theme preference persists via `localStorage` (managed by
`next-themes`). Mock conversations/messages are seeded from an in-repo module each session.

**Testing**: Vitest + React Testing Library for store logic and content-gating behavior
(per global guidance: test business logic/utilities, not every UI interaction)

**Target Platform**: Modern evergreen browsers; responsive 360px (mobile) → 1440px (desktop)

**Project Type**: Web application (single Next.js app, frontend only)

**Performance Goals**: Instant local interactions (<100ms perceived) for send, model switch,
theme toggle; no layout shift on theme change; 60fps textarea auto-grow

**Constraints**: Root is `h-screen` + `overflow-hidden`; only `ChatFeed` and the sidebar
history list scroll internally. No live backend/AI dependency. No `any` types. Floating
pill input detached from the bottom over a fading gradient.

**Scale/Scope**: Single user, ~5 seeded mock conversations, one active conversation at a
time, 5 feature components + 1 store + 1 provider + root layout/page.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

Evaluated against Constitution v1.0.0.

| Principle | Gate | Status |
|-----------|------|--------|
| I. shadcn/ui Primitives First | Every zone uses shadcn primitives: `sheet` (mobile sidebar), `dropdown-menu` (model select), `scroll-area` (feed), `avatar` (bubble), `textarea` + `button` (input). No custom component where a primitive exists. | ✅ PASS |
| II. Strict TypeScript (NON-NEGOTIABLE) | `tsconfig` strict; no `any`. Store, entities, and mock data are fully typed. | ✅ PASS |
| III. Explicit Client/Server Boundaries | All interactive components (Sidebar, Header, ChatFeed, ChatInput, MessageBubble, ThemeProvider) declare `"use client"`. `layout.tsx` stays a Server Component; `page.tsx` composes and is a thin client shell only where needed. | ✅ PASS |
| IV. Decoupled Component Architecture | `ChatInput` never reads/mutates feed state directly — it dispatches through the Zustand store / `useChat`. Cross-zone state flows through `useChatStore`, not prop drilling of mutable feed state. | ✅ PASS |
| V. Pixel-Perfect Layout & Full Theming | Root `h-screen` + `overflow-hidden`; feed scrolls internally; floating pill input over bottom gradient; full light/dark via `next-themes`; no hardcoded colors (Tailwind theme tokens only). | ✅ PASS |

**Additional constraints (Technology Stack section)**: Stack matches the mandated set
exactly (Next.js 15, Tailwind v4, shadcn/ui, Zustand, `useChat`, `next-themes`). No
overlapping dependency introduced → no Complexity Tracking entry required.

**Result**: All gates pass. No violations to justify.

## Project Structure

### Documentation (this feature)

```text
specs/001-gemini-chat-ui/
├── plan.md              # This file (/speckit-plan command output)
├── spec.md              # Feature specification
├── research.md          # Phase 0 output (/speckit-plan command)
├── data-model.md        # Phase 1 output (/speckit-plan command)
├── quickstart.md        # Phase 1 output (/speckit-plan command)
├── contracts/           # Phase 1 output — mock service + store contracts
│   └── mock-chat.contract.md
├── checklists/
│   └── requirements.md  # Spec quality checklist (/speckit-specify)
└── tasks.md             # Phase 2 output (/speckit-tasks command - NOT created by /speckit-plan)
```

### Source Code (repository root)

```text
app/
├── layout.tsx           # Server Component; wraps children in ThemeProvider, sets html/body
├── page.tsx             # Composes the three zones with Flexbox; prevents whole-page scroll
└── globals.css          # Tailwind v4 entry + theme tokens (light/dark), bottom gradient util

components/
├── layout/
│   ├── Sidebar.tsx      # shadcn `sheet` (mobile) + `aside` (desktop); New Chat, history, theme area
│   └── Header.tsx       # shadcn `dropdown-menu` borderless model selector (top-left)
├── chat/
│   ├── ChatFeed.tsx     # shadcn `scroll-area`; centered max-width; auto-scroll to latest
│   ├── MessageBubble.tsx# shadcn `avatar`; left/right alignment by role
│   └── ChatInput.tsx    # Floating pill; shadcn `textarea` (auto-grow) + `button` (gated Send) + "+" placeholder
├── theme/
│   ├── ThemeProvider.tsx# "use client" wrapper around next-themes provider
│   └── ThemeToggle.tsx  # Light/dark toggle rendered in Sidebar bottom area
└── ui/                  # shadcn primitives (generated via CLI): sheet, dropdown-menu,
                         #   scroll-area, avatar, textarea, button

store/
└── useChatStore.ts      # Zustand: selected model + conversations + active conversation + actions

lib/
├── mock-data.ts         # Seeded conversations/messages + mock assistant reply generator
└── types.ts             # Conversation, Message, ModelId types (shared)
```

**Structure Decision**: Single Next.js App Router web app (no separate backend). Component
tree matches the user-specified `/components` layout exactly, with two additive folders:
`components/theme/` (ThemeProvider + toggle) and `components/ui/` (shadcn CLI output). Shared
types and mock data live in `lib/` to keep components and the store decoupled (Principle IV).

## Complexity Tracking

> No Constitution Check violations. This section is intentionally empty.

---

# Amendment: Message Intent Routing (PayloadRouter) — 2026-07-01

Covers spec FR-024…FR-029, SC-008/SC-009, and the `Intent Payload` entity. Additive to the
plan above; nothing prior changes.

## Summary

On message submit, derive a structured **intent payload** for the raw text via a
`PayloadRouter` service at `lib/router.ts`. For this phase the router is **mocked locally**
(heuristics over the text, no live AI — honors FR-022) behind an **async** interface so a
real Gemini-backed implementation (via a server route) can replace it later without touching
callers. Routing is **non-blocking / optimistic**: the user message renders instantly and the
mocked assistant reply flow is unchanged; the payload attaches to the stored message when
routing resolves. Failure is swallowed gracefully (FR-028).

## Technical Context (additions)

- **New module**: `lib/router.ts` — pure TS module exporting
  `routeMessage(text: string): Promise<IntentPayload>` and the `IntentPayload` / `ModelTier`
  types. Not a component; no `"use client"` needed.
- **Type additions**: `IntentPayload`, `ModelTier` in `lib/types.ts`; `Message` gains an
  optional `intent?: IntentPayload`.
- **Store**: new action `attachIntent(conversationId, messageId, payload)` in
  `store/useChatStore.ts`.
- **Wiring**: invoked from the **submit handler in `app/page.tsx`** (`handleSend`), not from
  inside `ChatInput.tsx` — see Constitution re-check IV.
- **Testing**: Vitest unit tests for `routeMessage` (complete payload, correct types,
  `model_tier` ∈ tier set, deterministic) and the `attachIntent` store action.
- **No new dependencies.** No network. No UI surface (payload is in-memory, advisory).

## Constitution Re-Check (Amendment)

| Principle | Assessment | Status |
|-----------|------------|--------|
| I. shadcn Primitives First | No new UI. | ✅ N/A |
| II. Strict TS (no `any`) | `IntentPayload`/`ModelTier` fully typed; router returns a typed payload. | ✅ PASS |
| III. Client/Server Boundaries | `lib/router.ts` is a plain async module (no component). Deferred real Gemini would live behind a **server route** to keep the key server-side — never called from the client directly. | ✅ PASS |
| IV. Decoupled Architecture | Routing is invoked in the **submit handler (`page.tsx handleSend`)**, not inside `ChatInput`. `ChatInput` stays a dumb input calling `onSend`. Payload flows to the message via the store action, not prop-drilled feed state. | ✅ PASS |
| V. Layout & Theming | Unaffected. | ✅ N/A |
| FR-022 (fully mocked) | Router derives payload locally; no live service. | ✅ PASS |

**Interpretation note (IV):** the request says "invoked by the ChatInput submission logic."
The submission logic lives in `page.tsx`'s `handleSend` (ChatInput only calls `onSend`).
Invoking there — not inside `ChatInput.tsx` — is what preserves the decoupling the
constitution mandates. Behavior is identical from the user's view.

**Result**: All gates pass. No violations, no Complexity Tracking entry.

## Structure (additions)

```text
lib/
├── router.ts                 # PayloadRouter: routeMessage() + IntentPayload/ModelTier types (mock)
├── types.ts                  # + IntentPayload, ModelTier; Message.intent?
└── __tests__/router.test.ts  # routeMessage unit tests
store/
├── useChatStore.ts           # + attachIntent action
└── __tests__/useChatStore.test.ts  # + attachIntent test
app/
└── page.tsx                  # handleSend fires routeMessage() non-blocking, then attachIntent()
```

## Design details

- **`ModelTier`** = `"flash" | "pro" | "reasoning"` (finite, per FR-029 / SC-009).
- **`IntentPayload`** = `{ primary_action: string; requires_tools: boolean; entities: string[];
  model_tier: ModelTier }` — always fully populated.
- **Mock heuristic (`routeMessage`)** — deterministic for testability:
  - `primary_action`: classify from text (e.g. trailing `?` → `"question"`; leading
    imperative verb like write/create/build/summarize → that verb; else `"chat"`).
  - `requires_tools`: `true` if text matches a small keyword set (search, browse, calculate,
    weather, email, translate, run, code); else `false`.
  - `entities`: naive extraction (capitalized tokens / quoted spans), de-duplicated.
  - `model_tier`: `requires_tools` or long/complex text → `"pro"`; very long/multi-step →
    `"reasoning"`; else `"flash"`.
  - Returns via a resolved Promise (optionally a tiny simulated delay) — async shape only, no
    network.
- **Non-blocking wiring** (`page.tsx handleSend`): after the optimistic user append +
  existing mock-reply flow, call `routeMessage(text)`, and on resolve call
  `attachIntent(conversationId, userMessage.id, payload)`. Wrap in `.catch(() => {})` so a
  failure is inert (FR-028). Nothing awaits routing before rendering (FR-026 / SC-008).
- **`attachIntent`**: updates the matching message's `intent` field in the store; no-op if the
  message/conversation is gone.

## Deferred (explicitly out of scope this phase)

- Real Gemini 2.5 Flash call — lands later behind `routeMessage`'s interface via a Next.js
  **server route** (key server-side). That is a governed change (touches the constitution's
  frontend-only mandate) and gets its own amendment.
- Surfacing the payload in the UI. In-memory + advisory only for now.
