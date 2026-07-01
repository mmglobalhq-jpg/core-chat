# Quickstart: Gemini-Style Chat UI

Greenfield project — no app scaffolded yet. These steps bootstrap the mandated stack and wire
the components. Package manager: **pnpm** (per user global config).

## 1. Scaffold Next.js 15 + Tailwind v4

```bash
pnpm create next-app@latest . \
  --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*"
```

Confirm `tsconfig.json` has `"strict": true` (constitution Principle II — no `any`).

## 2. Initialize shadcn/ui and generate the six primitives

```bash
pnpm dlx shadcn@latest init
pnpm dlx shadcn@latest add sheet dropdown-menu scroll-area avatar textarea button
```

These land in `components/ui/`. Do not hand-author equivalents (Principle I).

## 3. Add remaining dependencies

```bash
pnpm add zustand next-themes ai @ai-sdk/react
# lucide-react is installed by shadcn init; add explicitly if missing:
pnpm add lucide-react
```

## 4. Theming

- Create `components/theme/ThemeProvider.tsx` (`"use client"`) wrapping `next-themes`'
  `ThemeProvider` with `attribute="class"`, `defaultTheme="system"`, `enableSystem`.
- In `app/layout.tsx` (Server Component): add `suppressHydrationWarning` to `<html>` and wrap
  `{children}` in `<ThemeProvider>`.
- Define light/dark color tokens (including a subtle `--sidebar` surface, FR-005) in
  `app/globals.css` under `:root` and `.dark`. No hardcoded hex in components.

## 5. State

- Create `store/useChatStore.ts` (Zustand) per data-model.md: `selectedModelId`,
  `conversations`, `activeConversationId`, and actions.
- Create `lib/types.ts`, `lib/mock-data.ts` (`MODEL_OPTIONS`, `seedConversations`, `mockReply`,
  `canSend`).

## 6. Components (exact paths)

- `components/layout/Sidebar.tsx` — `"use client"`; `aside` ≥ md, shadcn `Sheet` < md;
  New Chat (top), scrollable history (`scroll-area`), theme toggle (bottom).
- `components/layout/Header.tsx` — `"use client"`; borderless shadcn `DropdownMenu` model
  selector at top-left.
- `components/chat/ChatFeed.tsx` — `"use client"`; shadcn `ScrollArea`; centered max-width;
  auto-scroll to latest.
- `components/chat/MessageBubble.tsx` — `"use client"`; shadcn `Avatar`; left/right by role.
- `components/chat/ChatInput.tsx` — `"use client"`; floating pill; `+` placeholder + auto-grow
  `Textarea` + gated `Button`.

## 7. Compose (`app/page.tsx`)

Flexbox shell that prevents whole-page scroll:

```
<div class="flex h-screen overflow-hidden">
  <Sidebar />
  <div class="flex flex-1 flex-col min-w-0">
    <Header />
    <main class="relative flex-1 min-h-0">
      <ChatFeed />        // scrolls internally
      <ChatInput />       // floating, over a fading bottom gradient
    </main>
  </div>
</div>
```

## 8. Run & verify

```bash
pnpm dev   # http://localhost:3000
```

**Manual verification (maps to Success Criteria):**
- Send a message → user right, mocked reply left, input clears (SC-001).
- Type only spaces → Send stays disabled; type text → Send enables (SC-005).
- Open model dropdown → three options; select one → header updates (SC-002).
- Toggle theme → every zone recolors, sidebar stays a subtle off-color; reload → theme
  persists (SC-003).
- Add many messages → only the feed scrolls; header + input fixed (SC-004).
- Resize 360px→1440px → no horizontal scroll; sidebar collapses to `Sheet` on mobile (SC-006).
- Click a history item → that thread loads; New Chat → empty feed (SC-007).

## 9. Tests

```bash
pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom
pnpm vitest run
```

Cover `canSend`, `mockReply`, and store actions (per research.md §8).

---

## 10. Amendment — Message Intent Routing (PayloadRouter)

No new dependencies; no network; no UI surface. Steps:

1. **Types** (`lib/types.ts`): add `ModelTier` and `IntentPayload`; add optional `intent?:
   IntentPayload` to `Message`.
2. **Router** (`lib/router.ts`): implement
   `export async function routeMessage(text: string): Promise<IntentPayload>` — deterministic
   local heuristic returning a complete payload (see plan §Design details). No `fetch`.
3. **Store** (`store/useChatStore.ts`): add
   `attachIntent(conversationId, messageId, payload)` — sets `intent` on the message; no-op on
   unknown ids.
4. **Wire** (`app/page.tsx handleSend`): after the optimistic append + existing reply flow,
   `routeMessage(text).then(p => attachIntent(convId, userMsg.id, p)).catch(() => {})` —
   **not awaited** (non-blocking).
5. **Tests**: `lib/__tests__/router.test.ts` (complete payload, types, `model_tier` in set,
   determinism, `requires_tools` keyword toggle) and a store test for `attachIntent`.

**Verify (maps to SC-008/SC-009):**
- Send a message → it appears instantly (routing never blocks); after resolve, the stored
  message carries a complete `intent` payload with a valid `model_tier`.
- Force `routeMessage` to reject → message + reply still work, no error surfaced (FR-028).

> **Deferred:** real Gemini 2.5 Flash call lands later behind `routeMessage` via a Next.js
> **server route** (API key server-side) — a separate governed change.
