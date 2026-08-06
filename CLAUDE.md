# core-chat

Next.js frontend for the assistant. Platform-wide rules and the source of truth:
`~/projects/CLAUDE.md`.

> **This file was regenerated 2026-08-06.** The previous version was SPECKIT output
> from feature 001 and had rotted into misinformation — it stated the app had "no
> backend" and used a "local mock transport", pointed at a `lib/router.ts` that no
> longer exists, and described a root layout (`h-screen`) that had been replaced.
> Every session in this directory was being told those things.
>
> **So: architecture facts do not belong here.** They belong in
> `~/projects/system-source-of-truth/`, which has a review process. Keep this file
> to conventions that stay true as the code changes. If a line here would need
> editing because of an ordinary code change, it is in the wrong file.

## Stack

TypeScript (strict, no `any`) · React 19 · Next.js 15 App Router · Tailwind v4
(CSS-first `@theme` tokens, no hardcoded colours) · shadcn/ui primitives ·
Zustand · `next-themes` · `lucide-react` · Vitest + React Testing Library · pnpm.

Generate shadcn primitives with the CLI; never hand-author an equivalent.

## Conventions

- Interactive components declare `"use client"`; `app/layout.tsx` stays a Server
  Component.
- `ChatInput` never mutates feed state directly — dispatch through the store.
- Component paths are fixed: `components/layout/*`, `components/chat/*`, `store/`,
  `lib/`.
- Only the chat feed scrolls; the shell does not. Use `min-h-0` on flex children
  that need to.

## Mobile

The app is used on an iPhone and installs to the home screen, so:

- **Never size the app shell in `vh`.** iOS Safari counts the area behind its
  toolbars, so `100vh` puts the composer off-screen with no way to scroll to it.
  Use the `app-shell` utility (driven by `visualViewport`) or `dvh`.
- **Respect `env(safe-area-inset-*)`** on anything at a screen edge. `viewportFit:
  "cover"` in `app/layout.tsx` is what makes those non-zero.
- **Enter must not send on touch devices.** An iPhone keyboard has no Shift+Enter,
  so Enter-to-send makes multi-line messages impossible and lets autocorrect fire a
  send. Gate on `(pointer: coarse)`, not a width breakpoint.
- **Touch targets ≥ 44pt** on coarse pointers.
- **Radix `Sheet` unmounts its children when it closes.** State owned by a
  component inside the mobile drawer dies when the drawer does — this is why the
  settings panel is rendered from `app/page.tsx` and its state lives in a store.

## Before you finish

```
pnpm vitest run && npx tsc --noEmit
```

Then update the relevant doc in `~/projects/system-source-of-truth/` and run
`python3 ~/projects/system-source-of-truth/scripts/check-doc-drift.py`.
