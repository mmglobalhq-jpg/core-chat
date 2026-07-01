---
description: "Task list for Gemini-Style Chat UI (Frontend Shell)"
---

# Tasks: Gemini-Style Chat UI (Frontend Shell)

**Input**: Design documents from `/specs/001-gemini-chat-ui/`

**Prerequisites**: plan.md (required), spec.md (required for user stories), research.md,
data-model.md, contracts/mock-chat.contract.md

**Tests**: Focused unit tests are INCLUDED for pure logic (`canSend`, `mockReply`) and the
Zustand store, per research.md §8 and the constitution's Testing guidance (test business
logic, not every UI interaction). No exhaustive UI/DOM tests.

**Organization**: Tasks are grouped by user story to enable independent implementation and
testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Include exact file paths in descriptions

## Path Conventions

Single Next.js App Router web app at repository root: `app/`, `components/`, `store/`, `lib/`,
`components/ui/` (shadcn CLI output). Paths per plan.md Project Structure.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the mandated stack (greenfield — no package.json exists yet)

- [X] T001 Scaffold Next.js 15 App Router + TypeScript + Tailwind v4 into repo root via `pnpm create next-app@latest . --typescript --tailwind --app --eslint --src-dir=false --import-alias "@/*"`; verify `tsconfig.json` has `"strict": true`
- [X] T002 Initialize shadcn/ui (`pnpm dlx shadcn@latest init`) and generate primitives into `components/ui/`: `pnpm dlx shadcn@latest add sheet dropdown-menu scroll-area avatar textarea button`
- [X] T003 [P] Add runtime dependencies: `pnpm add zustand next-themes ai @ai-sdk/react lucide-react`
- [X] T004 [P] Add dev/test dependencies and Vitest config: `pnpm add -D vitest @testing-library/react @testing-library/jest-dom jsdom`; create `vitest.config.ts` (jsdom env) and `vitest.setup.ts` at repo root
- [X] T005 [P] Verify ESLint/`tsconfig` disallow `any` (add `@typescript-eslint/no-explicit-any` error) in `.eslintrc`/eslint config

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared types, mock data, store, theming, and the layout shell that ALL user
stories depend on

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T006 [P] Define shared types (`Role`, `ModelId`, `ModelOption`, `Message`, `Conversation`) in `lib/types.ts` per data-model.md
- [X] T007 [P] Implement `canSend(text)`, `mockReply(userText)`, `MODEL_OPTIONS` (the fixed three models), and `seedConversations()` in `lib/mock-data.ts` per data-model.md and contracts/mock-chat.contract.md
- [X] T008 Create Zustand store `store/useChatStore.ts` with `selectedModelId`, `conversations`, `activeConversationId`, and actions `setSelectedModel`, `newConversation`, `selectConversation`, `appendMessage`; seed `conversations` from `seedConversations()` (depends on T006, T007)
- [X] T009 [P] Create `components/theme/ThemeProvider.tsx` (`"use client"`) wrapping `next-themes` `ThemeProvider` (`attribute="class"`, `defaultTheme="system"`, `enableSystem`)
- [X] T010 Define light/dark design tokens in `app/globals.css` (Tailwind v4 `@theme`, `:root` + `.dark`), including a subtle `--sidebar` surface token and a fading bottom-gradient utility; no hardcoded hex (depends on T001)
- [X] T011 Update `app/layout.tsx` (Server Component) to add `suppressHydrationWarning` on `<html>` and wrap `{children}` in `ThemeProvider` (depends on T009)
- [X] T012 Build the Flexbox shell in `app/page.tsx`: `flex h-screen overflow-hidden` root, right column `flex-1 flex-col min-w-0`, `main` `relative flex-1 min-h-0`; import placeholders for Sidebar, Header, ChatFeed, ChatInput so the page compiles (depends on T010, T011)

**Checkpoint**: App boots, themes toggle at token level, store + mocks ready — user stories can now begin

---

## Phase 3: User Story 1 - Send a message and receive a mocked reply (Priority: P1) 🎯 MVP

**Goal**: Type text, send it, see the user message (right) and a mocked assistant reply (left)
in a centered feed that scrolls internally behind a floating pill input.

**Independent Test**: Load app, type text, press Send/Enter → user message right-aligned, mocked
reply left-aligned; Send disabled on empty/whitespace input; only the feed scrolls.

### Tests for User Story 1

> Write these FIRST and ensure they FAIL before implementation

- [X] T013 [P] [US1] Unit test `canSend` (empty/whitespace → false, non-whitespace → true) in `lib/__tests__/mock-data.test.ts`
- [X] T014 [P] [US1] Unit test `mockReply` returns a non-empty assistant `Message` in `lib/__tests__/mock-data.test.ts`

### Implementation for User Story 1

- [X] T015 [P] [US1] Create `components/chat/MessageBubble.tsx` (`"use client"`) using shadcn `Avatar`; right-align + user styling when `role==="user"`, left-align + assistant styling otherwise (depends on T006)
- [X] T016 [US1] Create `components/chat/ChatFeed.tsx` (`"use client"`) using shadcn `ScrollArea`; centered max-width container; render `MessageBubble` list from `useChat` messages; auto-scroll to latest on new message (depends on T015)
- [X] T017 [US1] Create `components/chat/ChatInput.tsx` (`"use client"`) as a floating pill over the bottom gradient: `+` placeholder button (left), auto-grow shadcn `Textarea` (reset+`scrollHeight` capped, internal scroll past max), gated shadcn `Button` disabled unless `canSend(value)`; Enter submits, Shift+Enter newline (depends on T007)
- [X] T018 [US1] Wire `useChat` with a local mock transport (no network) that appends the user message then resolves `mockReply(userText)` as the assistant message; connect `ChatInput` submit and `ChatFeed` rendering; call `appendMessage` to keep the store in sync (depends on T008, T016, T017)
- [X] T019 [US1] Mount `ChatFeed` and `ChatInput` in `app/page.tsx` `main`; verify page body never scrolls and only the feed scrolls (depends on T012, T018)

**Checkpoint**: US1 fully functional — the core chat loop works standalone (MVP)

---

## Phase 4: User Story 2 - Manage conversations from the sidebar (Priority: P2)

**Goal**: Start a new chat and switch between seeded conversations from a collapsible sidebar.

**Independent Test**: Click a history item → its thread loads into the feed and is marked active;
click New Chat → feed clears; collapse sidebar → chat area reclaims space; on mobile the sidebar
opens as a Sheet.

### Tests for User Story 2

- [X] T020 [P] [US2] Unit test store actions `newConversation` (adds empty active conversation) and `selectConversation` (sets active id) in `store/__tests__/useChatStore.test.ts` (depends on T008)

### Implementation for User Story 2

- [X] T021 [US2] Create `components/layout/Sidebar.tsx` (`"use client"`): `<aside>` at `md:`+ and shadcn `Sheet` below `md`; subtle off-color background via `--sidebar` token; New Chat button pinned top, scrollable history list (shadcn `ScrollArea`) in middle, settings/theme area pinned bottom (depends on T008, T010)
- [X] T022 [US2] Wire New Chat button → `newConversation()` (clears feed via `useChat` `setMessages([])`) and history items → `selectConversation(id)` (hydrates feed via `setMessages(conversation.messages)`), marking the active item; render empty-state when history is empty (depends on T018, T021)
- [X] T023 [US2] Add sidebar collapse/expand + mobile Sheet trigger (hamburger); collapsing lets `app/page.tsx` chat column reclaim space; mount `Sidebar` in `app/page.tsx` (depends on T012, T021)

**Checkpoint**: US1 + US2 work independently — chat loop plus conversation navigation

---

## Phase 5: User Story 3 - Switch AI model from the header (Priority: P2)

**Goal**: Select the active model from a borderless header dropdown (three fixed options).

**Independent Test**: Open the top-left dropdown → exactly Gemini 2.5 Flash, DeepSeek V4 Pro,
GPT-5.5; select one → header shows it active and it persists for the session.

### Tests for User Story 3

- [X] T024 [P] [US3] Unit test store `setSelectedModel` updates `selectedModelId` and rejects non-`MODEL_OPTIONS` ids in `store/__tests__/useChatStore.test.ts` (depends on T008)

### Implementation for User Story 3

- [X] T025 [US3] Create `components/layout/Header.tsx` (`"use client"`) with a minimalist borderless shadcn `DropdownMenu` at top-left listing `MODEL_OPTIONS`; display `selectedModelId` label; on select call `setSelectedModel` and close menu (depends on T007, T008)
- [X] T026 [US3] Mount `Header` above `ChatFeed` in the `app/page.tsx` right column (fixed height, does not scroll); include the mobile sidebar Sheet trigger in the header (depends on T012, T025)

**Checkpoint**: US1 + US2 + US3 independently functional

---

## Phase 6: User Story 4 - Toggle light and dark modes (Priority: P3)

**Goal**: Toggle theme from the sidebar bottom area; every zone recolors seamlessly and the
choice persists across reloads.

**Independent Test**: Toggle theme → sidebar/header/feed/input all recolor with legible contrast,
sidebar stays a subtle off-color; reload → theme persists.

### Implementation for User Story 4

- [X] T027 [P] [US4] Create `components/theme/ThemeToggle.tsx` (`"use client"`) using shadcn `Button` + `lucide-react` sun/moon; call `useTheme().setTheme` to switch light/dark; guard against hydration mismatch (mounted check) (depends on T009)
- [X] T028 [US4] Render `ThemeToggle` in the Sidebar settings/theme area; verify all zones recolor via tokens and persistence works (`next-themes` localStorage) (depends on T021, T027)

**Checkpoint**: All four user stories independently functional

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Responsiveness, accessibility, and final verification across all stories

- [X] T029 [P] Responsive pass: verify no horizontal scroll 360px→1440px; sidebar collapses to Sheet on mobile; long messages wrap; textarea max-height scroll works (SC-006, edge cases)
- [X] T030 [P] Accessibility pass: keyboard focus for dropdown/sheet/send, aria labels on `+`/Send/toggle/hamburger, visible focus rings in both themes
- [X] T031 [P] Seed `lib/mock-data.ts` with ~5 realistic sample conversations for a convincing history list (FR-023)
- [X] T032 Run `pnpm vitest run` (all unit tests green) and `pnpm lint` / `pnpm tsc --noEmit` (no `any`, no type errors)
- [X] T033 Execute quickstart.md manual verification checklist against SC-001…SC-007 and record results

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories
- **User Stories (Phase 3–6)**: All depend on Foundational completion
  - US1 (P1) has no dependency on other stories (MVP)
  - US2, US3, US4 depend only on Foundational; US2/US4 touch the Sidebar (natural sequence)
- **Polish (Phase 7)**: Depends on all targeted user stories being complete

### User Story Dependencies

- **US1 (P1)**: Foundational only — independently testable (the chat loop)
- **US2 (P2)**: Foundational + reuses US1's `useChat` wiring for feed hydration/clear
- **US3 (P2)**: Foundational only — independent of US1/US2 (header + model store)
- **US4 (P3)**: Foundational + renders inside US2's Sidebar (toggle placement)

### Within Each User Story

- Tests (where present) written and failing before implementation
- Types/helpers (Foundational) before components
- Components before page mounting/wiring
- Store wiring before UI behavior that depends on it

### Parallel Opportunities

- Setup: T003, T004, T005 in parallel after T001/T002
- Foundational: T006, T007, T009 in parallel; T008 after T006+T007
- US1: T013, T014, T015 in parallel; T016 after T015
- US3 is largely parallel to US2 (different files: Header vs Sidebar) once Foundational is done
- Polish: T029, T030, T031 in parallel

---

## Parallel Example: Foundational Phase

```bash
# After Setup completes, launch independent foundational tasks together:
Task: "Define shared types in lib/types.ts"                 # T006
Task: "Implement canSend/mockReply/MODEL_OPTIONS/seed in lib/mock-data.ts"  # T007
Task: "Create ThemeProvider in components/theme/ThemeProvider.tsx"          # T009
# Then T008 (store) once T006 + T007 are done.
```

## Parallel Example: User Story 1

```bash
# Launch US1 tests and the leaf component together:
Task: "Unit test canSend in lib/__tests__/mock-data.test.ts"    # T013
Task: "Unit test mockReply in lib/__tests__/mock-data.test.ts"  # T014
Task: "Create MessageBubble in components/chat/MessageBubble.tsx" # T015
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup
2. Complete Phase 2: Foundational (CRITICAL — blocks all stories)
3. Complete Phase 3: User Story 1
4. **STOP and VALIDATE**: send a message, see mocked reply, feed-only scroll, gated Send
5. Demo the working chat loop

### Incremental Delivery

1. Setup + Foundational → foundation ready
2. US1 → validate → demo (MVP: the chat loop)
3. US2 → validate → demo (sidebar navigation)
4. US3 → validate → demo (model selector)
5. US4 → validate → demo (theming)
6. Polish → responsive/a11y/verification

### Parallel Team Strategy

After Foundational, US1 and US3 can proceed in parallel (chat components vs. header), while
US2 (sidebar) sequences ahead of US4 (theme toggle lives in the sidebar).

---

## Notes

- [P] = different files, no dependencies on incomplete tasks
- [Story] label maps each task to its user story for traceability
- All interactive components declare `"use client"`; `app/layout.tsx` stays a Server Component
- `ChatInput` never mutates feed state directly — it dispatches through `useChat`/the store
- Commit after each task or logical group; stop at any checkpoint to validate independently
