# Phase 0 Research: Gemini-Style Chat UI

All Technical Context items resolved. No open `NEEDS CLARIFICATION` markers. Decisions
below lock the mandated stack (constitution + user plan input) to concrete patterns.

## 1. Mocking the chat loop with Vercel AI SDK `useChat`

- **Decision**: Use `useChat` for message state, backed by a **local mock transport** rather
  than a live `/api/chat` route. Configure `useChat` with a custom transport/fetch that
  resolves a canned assistant reply locally (optionally after a small simulated delay), so
  no network call leaves the browser.
- **Rationale**: Satisfies FR-022 (fully mocked, no backend) while keeping the exact API the
  real backend will later expose — swapping the mock transport for a real endpoint is a
  one-line change. Constitution mandates `useChat` "even while the backend is mocked."
- **Alternatives considered**:
  - *Hand-rolled `useState` message list* — rejected: violates constitution's `useChat`
    mandate and throws away streaming-ready plumbing.
  - *Real Next.js route handler returning static text* — rejected: adds a backend surface the
    spec explicitly excludes for this phase.

## 2. Zustand store vs. `useChat` responsibilities (Principle IV)

- **Decision**: `useChatStore` owns **cross-zone, app-level** state: selected model,
  the list of conversations (mock history), and which conversation is active. The **per-thread
  message exchange** for the active conversation is driven by `useChat`. `ChatInput` submits
  through `useChat`'s handler and never touches feed state directly.
- **Rationale**: Clean separation keeps the input decoupled from the feed (Principle IV) and
  matches the two natural lifetimes: session-level navigation (store) vs. active-thread
  messages (hook). Selecting a history item hydrates `useChat` with that conversation's
  messages via `setMessages`.
- **Alternatives considered**: Putting all messages in Zustand and ignoring `useChat` — rejected
  (constitution). Putting model/history in `useChat` — rejected (wrong scope; `useChat` is
  per-conversation).

## 3. Responsive sidebar: `sheet` (mobile) + `aside` (desktop)

- **Decision**: Render a persistent `<aside>` on `md:` and up; below `md`, render the same
  sidebar content inside a shadcn `Sheet` triggered by a hamburger button in the Header.
  A single `isSidebarOpen`/collapse concept drives both.
- **Rationale**: Meets FR-006 (collapsible, chat area reclaims space) and SC-006 (no horizontal
  scroll 360→1440). Matches the user's explicit component instruction.
- **Alternatives considered**: CSS-only off-canvas transform — rejected: shadcn `sheet` gives
  focus trapping/overlay/a11y for free (Principle I: primitive-first).

## 4. Full-height, no-page-scroll layout (Principle V)

- **Decision**: `body`/root container = `h-screen overflow-hidden flex`. Sidebar is a flex
  child (fixed width or collapsed); the right column is `flex-1 flex flex-col min-w-0`
  containing Header (fixed height), then `ChatFeed` (`flex-1 min-h-0`, internal scroll via
  shadcn `scroll-area`). `ChatInput` is absolutely/fixed-positioned floating over the feed's
  bottom with a fading gradient behind it. `min-h-0`/`min-w-0` prevent flex children from
  forcing page overflow.
- **Rationale**: Directly implements FR-002, SC-004, and the constitution's layout contract.
  The `min-h-0` guard is the standard fix for "flex child won't scroll internally."
- **Alternatives considered**: CSS grid rows — viable, but Flexbox was explicitly requested and
  composes more simply with the collapsing sidebar.

## 5. Theming with `next-themes` + shadcn `ThemeProvider` (Principle V, FR-020/021)

- **Decision**: `class`-strategy `next-themes` provider in a `"use client"` `ThemeProvider`
  wrapping the app in `layout.tsx`; `suppressHydrationWarning` on `<html>`. Colors come only
  from Tailwind v4 theme tokens (CSS variables) defined for `:root` and `.dark` — no hardcoded
  hex. Toggle lives in the Sidebar bottom area. Sidebar uses a distinct token (e.g. a
  `--sidebar`/muted surface) so it stays a subtle off-color in both themes (FR-005).
- **Rationale**: `next-themes` handles persistence (localStorage) and system preference,
  satisfying FR-021/SC-003 with no flash-of-wrong-theme.
- **Alternatives considered**: Manual `data-theme` + context — rejected: reinvents `next-themes`,
  which the constitution mandates.

## 6. Auto-expanding textarea with gated Send (FR-017/018/019)

- **Decision**: shadcn `Textarea` with `rows={1}`; on input, reset `height='auto'` then set to
  `scrollHeight` capped at a max (e.g. ~200px) after which `overflow-y-auto` kicks in. Send
  `Button` is `disabled` unless `value.trim().length > 0`. Enter submits, Shift+Enter newlines.
- **Rationale**: Meets auto-grow + bounded height + whitespace gating (SC-005) using primitives
  (Principle I). Pure-function `canSend(text)` is unit-testable.
- **Alternatives considered**: `react-textarea-autosize` dependency — rejected: avoid a new dep
  when a ~10-line effect on the shadcn primitive suffices.

## 7. Tailwind v4 + shadcn/ui setup

- **Decision**: Tailwind v4 CSS-first config (`@import "tailwindcss"` + `@theme` tokens in
  `globals.css`); initialize shadcn via CLI and generate exactly the six primitives used:
  `sheet`, `dropdown-menu`, `scroll-area`, `avatar`, `textarea`, `button`. `lucide-react`
  provides icons (New Chat +, send, theme sun/moon, hamburger).
- **Rationale**: v4 is the mandated styling layer; generating only-needed primitives keeps the
  bundle and `components/ui` surface minimal.
- **Alternatives considered**: Tailwind v3 config file — rejected (constitution mandates v4).

## 8. Testing scope

- **Decision**: Vitest + RTL. Unit-test: `canSend`/whitespace gating, mock reply generator,
  and store reducers (select model, new chat, select conversation). Skip exhaustive UI
  interaction tests per global guidance ("test business logic, not every UI interaction").
- **Rationale**: Maximizes signal on the logic that FR/SC actually gate, minimizes brittle
  DOM tests.

## Resolved unknowns summary

| Item | Resolution |
|------|------------|
| Backend for `useChat` | Local mock transport, no network |
| State split | Store = model/history/active; `useChat` = active-thread messages |
| Sidebar responsiveness | `sheet` < md, `aside` ≥ md |
| No-page-scroll | Flex + `h-screen overflow-hidden` + `min-h-0` internal scroll |
| Theme persistence | `next-themes` class strategy, token-based colors |
| Textarea/Send | shadcn primitive + `scrollHeight` autosize + `trim()` gate |
| Tailwind/shadcn | v4 CSS-first; generate 6 primitives via CLI |
| Tests | Vitest/RTL on store + gating + mock generator |
