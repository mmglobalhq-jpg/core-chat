<!--
SYNC IMPACT REPORT
==================
Version change: (template) → 1.0.0
Bump rationale: Initial ratification of the project constitution (first concrete
  version replacing the unfilled template). Semantic versioning starts at 1.0.0.

Modified principles: (none — initial definition)
Added principles:
  - I. shadcn/ui Primitives First
  - II. Strict TypeScript (NON-NEGOTIABLE)
  - III. Explicit Client/Server Boundaries
  - IV. Decoupled Component Architecture
  - V. Pixel-Perfect Layout & Full Theming
Added sections:
  - Technology Stack (Section 2)
  - Development Workflow (Section 3)
Removed sections: (none)

Templates requiring updates:
  - .specify/templates/plan-template.md ✅ compatible (generic Constitution Check
    placeholder; no hardcoded principles to reconcile)
  - .specify/templates/spec-template.md ✅ compatible (no constitution coupling)
  - .specify/templates/tasks-template.md ✅ compatible (generic phase structure)
  - .specify/templates/checklist-template.md ✅ compatible (not reviewed for
    principle-specific content; generic)

Follow-up TODOs: (none — all placeholders resolved)
-->

# Thin UI Chat Assistant Constitution

## Core Principles

### I. shadcn/ui Primitives First

UI MUST be built from shadcn/ui primitives. A custom component MUST NOT be authored
when a shadcn/ui equivalent exists — extend or compose the primitive instead. New
components are permitted only when no primitive covers the need, and MUST be composed
from existing primitives where possible.

**Rationale**: Reusing a single, audited primitive set guarantees visual and
behavioral consistency, reduces surface area for bugs, and keeps the UI aligned with
the Gemini-clone design target without bespoke drift.

### II. Strict TypeScript (NON-NEGOTIABLE)

TypeScript MUST be used everywhere. The `any` type is forbidden — use precise types,
generics, or `unknown` with narrowing. Type errors MUST NOT be suppressed with
`@ts-ignore`/`@ts-expect-error` except with an inline justification comment.

**Rationale**: End-to-end typing catches integration errors at compile time and is the
primary safety net for a thin client that leans on external hooks (Vercel AI SDK) and
shared state (Zustand). `any` erases that guarantee silently.

### III. Explicit Client/Server Boundaries

Every interactive component (Sidebar, ChatInput, Dropdowns, and any component using
hooks, state, or event handlers) MUST declare `"use client"` explicitly. Components
that do not require interactivity MUST remain Server Components. The boundary MUST be
intentional, never incidental.

**Rationale**: The App Router defaults to Server Components; leaving interactivity
implicit produces hydration errors and unintended client bundles. Explicit directives
make the render boundary auditable.

### IV. Decoupled Component Architecture

Components MUST remain decoupled. The chat input MUST NOT read or mutate chat feed
state directly; cross-component state flows through the Zustand store (or the `useChat`
hook), not through parent-to-child prop drilling of mutable feed state. Each file has
one clear purpose.

**Rationale**: Decoupling the input from the feed keeps each concern independently
testable and replaceable, and prevents render coupling that makes the "thin UI"
brittle as features (model selection, history) grow.

### V. Pixel-Perfect Layout & Full Theming

Layout MUST honor the Gemini-clone design contract:
- Root is full viewport height (`h-screen`) with `overflow-hidden`; scrolling is handled
  internally by the chat feed container, never the document body.
- The input bar MUST be a floating, pill-shaped container detached from the bottom
  edge, layered over a fading bottom gradient.
- Complete Dark and Light mode support via `next-themes` is mandatory; no hardcoded
  colors that break either theme.
- Negative space and layout MUST be treated as first-class design concerns.

**Rationale**: The product's value is a polished, on-brand chat surface. These are the
concrete, testable expressions of "pixel-perfect" and cannot be left to interpretation.

## Technology Stack

The following stack is REQUIRED and changes to it are governed amendments:

- **Framework**: Next.js 15 (App Router).
- **Styling**: Tailwind CSS v4.
- **UI Components**: shadcn/ui (see Principle I).
- **Client State**: Zustand — for model selection, chat history, and other client state.
- **AI Message State**: Vercel AI SDK `useChat` — used for message state even while the
  backend is mocked.
- **Theming**: `next-themes` (see Principle V).

Introducing a new runtime dependency that overlaps an existing stack choice (e.g., a
second state manager or component library) MUST be justified in the plan's Complexity
Tracking and approved as an amendment.

## Development Workflow

- New features, new API routes, and schema changes follow Spec-Driven Development:
  spec → approval → tests → implementation. Bug fixes and single-file edits are exempt.
- Every change MUST leave the constitution's principles satisfied. Pull requests and
  reviews MUST verify compliance with Principles I–V.
- Additive scope beyond the approved spec is not permitted; build the minimum that
  satisfies the requirement.
- The plan template's Constitution Check gate MUST be evaluated before Phase 0 research
  and re-checked after design.

## Governance

This constitution supersedes other development practices for this project. When a
practice conflicts with a principle here, this document wins.

- **Amendments**: Any change to a principle or the required stack MUST be proposed as a
  documented amendment, reviewed, and accompanied by a migration note when it affects
  existing code.
- **Versioning Policy**: Semantic versioning applies to this document.
  - MAJOR: backward-incompatible removal or redefinition of a principle or governance rule.
  - MINOR: a new principle/section is added or guidance is materially expanded.
  - PATCH: clarifications, wording, or non-semantic refinements.
- **Compliance Review**: All PRs/reviews MUST verify principle compliance. Any deviation
  MUST be recorded in the plan's Complexity Tracking with a justification and the simpler
  alternative that was rejected.

**Version**: 1.0.0 | **Ratified**: 2026-07-01 | **Last Amended**: 2026-07-01
