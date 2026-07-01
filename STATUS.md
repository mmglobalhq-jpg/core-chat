# Project Status — Thin UI Chat Assistant (Core Chat)

**As of:** 2026-07-01
**Feature:** `001-gemini-chat-ui` — Gemini-style chat UI (frontend shell, fully mocked)
**Overall:** ✅ Feature 1 implemented and verified (unit + build + real-browser). Running locally.

---

## 1. Where we are

Spec-Driven Development completed end to end for the first feature:

| Phase | Artifact | State |
|-------|----------|-------|
| Constitution | `.specify/memory/constitution.md` | ✅ v1.0.0 ratified |
| Specify | `specs/001-gemini-chat-ui/spec.md` | ✅ Approved (checklist 16/16) |
| Plan | `specs/001-gemini-chat-ui/plan.md` (+ research, data-model, contracts, quickstart) | ✅ Complete |
| Tasks | `specs/001-gemini-chat-ui/tasks.md` | ✅ 33/33 done |
| Implement | app source (see §4) | ✅ Complete |
| Verify | build + lint + typecheck + tests + browser drive | ✅ PASS |

The app is a working, distraction-free Gemini clone: collapsible sidebar, model-selector
header, centered chat feed, floating pill input, light/dark theming — with **all backend,
AI responses, and history mocked locally**.

---

## 2. Stack (as built)

- **Next.js 15.5.19** (App Router) — pinned to 15 per constitution (see Decision D1)
- **React 19.2.4**, **TypeScript 5** (strict, no `any`)
- **Tailwind CSS v4** (CSS-first tokens in `app/globals.css`)
- **shadcn/ui** primitives: `sheet, dropdown-menu, scroll-area, avatar, textarea, button`
- **Zustand 5** — `store/useChatStore.ts` (model + conversations + active thread)
- **Vercel AI SDK `useChat`** (`@ai-sdk/react` 1.2.12 / `ai` 4.3.19) — driven by a local
  mock (no network); replies come from `mockReply()`
- **next-themes** — class strategy, system default, persisted
- **Vitest + Testing Library** — unit tests
- **Package manager:** pnpm

---

## 3. Verification evidence

- `pnpm test` → **16/16 pass** (`canSend`, `mockReply`, model guard, all store actions,
  blank-on-load initial state)
- `pnpm exec tsc --noEmit` → clean (no `any`)
- `pnpm lint` → clean (`@typescript-eslint/no-explicit-any` enforced)
- `pnpm build` → production build succeeds, 5/5 pages
- **Real-browser drive (Playwright/Chromium)**, desktop light+dark + mobile 375px:
  - Send gating: disabled on empty AND whitespace, enabled on text ✅
  - Send → user-right / assistant-left (verified via computed `justify-content`), input clears ✅
  - Model dropdown = exactly the 3 models; selection persists across theme toggle + thread switch ✅
  - Theme toggle recolors all zones; sidebar stays off-color ✅
  - History load + New Chat (empty state) ✅
  - Page body never scrolls (html overflow 0 px); only feed scrolls ✅
  - Mobile: `aside` hidden, no horizontal scroll, hamburger opens Sheet ✅
  - No console/page errors ✅

---

## 4. Source layout

```
app/
  layout.tsx        # Server Component; ThemeProvider + fonts; html overflow-hidden
  page.tsx          # "use client"; Flexbox shell; owns useChat + wires zones
  globals.css       # Tailwind v4 tokens (light/dark), --sidebar surface, bottom-fade util
components/
  layout/Sidebar.tsx    # aside (md+) + Sheet (mobile); New Chat / history / theme+settings
  layout/Header.tsx     # borderless model dropdown + menu/collapse triggers
  chat/ChatFeed.tsx     # ScrollArea, centered, auto-scroll, empty state
  chat/MessageBubble.tsx# Avatar; role-based left/right alignment
  chat/ChatInput.tsx    # floating pill; +, auto-grow textarea, gated Send
  theme/ThemeProvider.tsx, theme/ThemeToggle.tsx
  ui/                   # shadcn primitives (6)
store/useChatStore.ts   # Zustand store (+ __tests__)
lib/types.ts, lib/mock-data.ts, lib/utils.ts  # types, mocks/helpers, cn (+ __tests__)
```

Design/spec artifacts live in `specs/001-gemini-chat-ui/`.

---

## 5. How to run

```bash
pnpm install       # exits 0 (native-build approval configured in pnpm-workspace.yaml)
pnpm dev           # http://localhost:3000
pnpm test          # unit tests
pnpm build         # production build
```

> A dev server is currently running in the background at **http://localhost:3000**.

---

## 6. Open decisions / follow-ups

- **D1 — Next.js 15 vs 16 → RESOLVED: stay on 15.** Pinned to **15.5.19** per the
  constitution. No upgrade to 16.
- **D2 — Blank-on-load → RESOLVED: opens blank.** First paint now shows the empty-state
  hero ("How can I help you today?"). The store seeds a fresh blank active conversation;
  prior mock conversations remain browsable in the sidebar and are hidden from the list
  until they have messages. Verified in a real browser (blank hero, send-gating intact,
  sent chat then appears in history, New Chat returns to blank).
- **No version control yet.** This is **not a git repository**. Recommend `git init` +
  initial commit to lock in this baseline before Feature 2.
- **Not yet done (out of current scope):** real backend/streaming, attachments (the `+`
  is a placeholder), auth, persisted conversations (only theme persists).

---

## 7. Suggested next steps

1. Decide D1 (Next 15 vs 16) and D2 (seeded vs blank open).
2. `git init` and commit the baseline.
3. Optional polish: responsive/a11y sweep already covered at implementation level; a human
   design pass for pixel-parity against real Gemini is the main remaining "feel" item.
4. Start Feature 2 via `/speckit.specify` when ready.
