<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan

## Active Technologies (feature 001-gemini-chat-ui)

- **Language**: TypeScript 5.x (strict, no `any`), React 19
- **Framework**: Next.js 15 (App Router)
- **Styling**: Tailwind CSS v4 (CSS-first `@theme` tokens); no hardcoded colors
- **UI primitives**: shadcn/ui — `sheet`, `dropdown-menu`, `scroll-area`, `avatar`,
  `textarea`, `button` (generate via CLI; never hand-author an equivalent)
- **State**: Zustand (`store/useChatStore.ts`) — model + conversations + active thread
- **Chat state**: Vercel AI SDK `useChat` (`@ai-sdk/react`) with a local mock transport (no backend)
- **Theming**: `next-themes` (class strategy) + `components/theme/ThemeProvider.tsx`
- **Icons**: `lucide-react`
- **Testing**: Vitest + React Testing Library (store logic, `canSend`, `mockReply`)
- **Package manager**: pnpm

## Project Conventions

- All interactive components declare `"use client"`; `app/layout.tsx` stays a Server Component.
- `ChatInput` never mutates feed state directly — dispatch through the store / `useChat`.
- Root layout: `flex h-screen overflow-hidden`; only `ChatFeed` scrolls (use `min-h-0`).
- Floating pill `ChatInput` sits over a fading bottom gradient, detached from the edge.
- Component paths are fixed: `components/layout/*`, `components/chat/*`, `store/`, `lib/`.

<!-- SPECKIT END -->
