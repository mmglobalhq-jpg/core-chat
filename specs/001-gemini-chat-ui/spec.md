# Feature Specification: Gemini-Style Chat UI (Frontend Shell)

**Feature Branch**: `001-gemini-chat-ui`

**Created**: 2026-07-01

**Status**: Draft (Amended 2026-07-01 — added Message Intent Routing, FR-024…FR-029)

**Amendments**:
- **2026-07-01 — Message Intent Routing (PayloadRouter).** Added a message-intent routing
  capability that derives a structured intent payload from each submitted message.
  Decisions: routing is **mocked locally** (honors FR-022; no live AI service) with the
  interface shaped so a real model-backed implementation can replace the mock later; routing
  is **non-blocking / optimistic** (the message renders instantly, the payload attaches when
  routing resolves). Implementation specifics deliberately noted in Assumptions (service
  name/location) and deferred to the plan. This is new, not-yet-implemented scope; re-run
  `/speckit.plan` and `/speckit.tasks` for it.

**Input**: User description: "Build a responsive, pixel-perfect clone of the Gemini web UI to serve as the front-end for a personal AI assistant. The interface must be distraction-free and cleanly separate the navigation controls from the conversational feed. Three visual zones: a collapsible left sidebar (New Chat button, scrollable recent history, settings/theme toggle pinned at bottom, subtle off-color background); a top header with a minimalist borderless model-selector dropdown (Gemini 2.5 Flash, DeepSeek V4 Pro, GPT-5.5); a main chat & input area with a centered max-width feed (user messages right, AI messages left) and a floating pill-shaped input containing a '+' attachment button, an auto-expanding textarea, and a Send button that only activates when text is present. Seamless light and dark modes. Frontend only; all backend calls, AI responses, and chat history are mocked locally."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Send a message and receive a mocked reply (Priority: P1)

A person opens the assistant, types a message into the input bar, and sends it. Their
message appears immediately in the feed, aligned to the right. A mocked assistant reply
then appears, aligned to the left, giving the impression of a working conversation.

**Why this priority**: This is the core loop of the product. Without the ability to send
a message and see a threaded exchange, none of the surrounding chrome has value. It is
the smallest slice that demonstrates a usable chat surface.

**Independent Test**: Load the app, type text, press Send (or Enter), and confirm the
user message renders right-aligned and a mocked assistant message renders left-aligned
in the centered feed — without any real network dependency.

**Acceptance Scenarios**:

1. **Given** an empty input bar, **When** the user has typed no text, **Then** the Send
   control is disabled/inactive.
2. **Given** the user has typed non-whitespace text, **When** they look at the input bar,
   **Then** the Send control becomes active.
3. **Given** active text in the input, **When** the user sends the message, **Then** the
   message appears right-aligned in the feed and the input clears.
4. **Given** a message has been sent, **When** the mocked assistant responds, **Then** an
   assistant message appears left-aligned below the user message.
5. **Given** a long conversation, **When** new messages are added, **Then** the feed
   scrolls to keep the latest message visible while the header and input bar stay fixed.

---

### User Story 2 - Manage conversations from the sidebar (Priority: P2)

A person uses the left sidebar to start a fresh conversation and to switch between
previous conversations shown in a scrollable history list.

**Why this priority**: Navigation across conversations is central to an assistant that
holds more than one thread, but the app is still demonstrable (US1) without it.

**Independent Test**: With mocked history present, click a history item to load that
conversation into the feed, and click "New Chat" to clear the feed into a fresh empty
conversation.

**Acceptance Scenarios**:

1. **Given** the sidebar is open, **When** the user clicks "New Chat", **Then** the feed
   resets to an empty conversation ready for input.
2. **Given** a list of prior conversations, **When** the user selects one, **Then** its
   messages load into the feed and it is visually indicated as active.
3. **Given** more conversations than fit vertically, **When** the user scrolls the
   history list, **Then** the list scrolls independently while "New Chat" (top) and the
   settings/theme area (bottom) remain pinned.
4. **Given** the sidebar is open, **When** the user collapses it, **Then** the main chat
   area expands to reclaim the space; **When** expanded again, the sidebar returns.

---

### User Story 3 - Switch AI model from the header (Priority: P2)

A person opens the borderless model selector in the top header and chooses among
"Gemini 2.5 Flash", "DeepSeek V4 Pro", and "GPT-5.5". The selection persists visibly as
the active model.

**Why this priority**: Model choice is a defining feature of the assistant surface, but
the chat loop (US1) works with a sensible default without it.

**Independent Test**: Open the header dropdown, confirm all three options appear, select
one, and confirm the header reflects the chosen model as active.

**Acceptance Scenarios**:

1. **Given** the header, **When** the user opens the model selector, **Then** exactly the
   three named options are listed.
2. **Given** the selector is open, **When** the user picks an option, **Then** the header
   displays that option as the active model and the menu closes.
3. **Given** a selected model, **When** the user sends a message, **Then** the currently
   selected model remains the active selection.

---

### User Story 4 - Toggle light and dark modes (Priority: P3)

A person toggles between light and dark appearance from the settings/theme area at the
bottom of the sidebar, and the entire interface updates seamlessly.

**Why this priority**: Theming is a polish and comfort feature; the app is fully usable
in a single default theme.

**Independent Test**: Activate the theme toggle and confirm every zone (sidebar, header,
feed, input bar) re-colors consistently with no unreadable or unstyled elements.

**Acceptance Scenarios**:

1. **Given** light mode, **When** the user toggles the theme, **Then** all three zones
   switch to dark mode with legible contrast.
2. **Given** a chosen theme, **When** the user reloads the app, **Then** the previously
   chosen theme is restored.
3. **Given** either theme, **When** the user views the sidebar, **Then** its background
   remains a subtle off-color distinct from the main chat area.

---

### Edge Cases

- **Whitespace-only input**: Send remains inactive when the input contains only spaces or
  newlines; such content cannot be submitted.
- **Very long single message**: A long message wraps within its aligned bubble and does
  not overflow the centered container or push the layout horizontally.
- **Growing textarea**: The input textarea auto-expands as the user types multiple lines,
  up to a bounded maximum height after which it scrolls internally, keeping the pill shape
  and the floating position intact.
- **Empty history**: With no prior conversations, the sidebar history area shows an empty
  state rather than a broken or misaligned list.
- **Empty conversation**: A brand-new chat with no messages presents a clean, centered
  empty feed without stray scrollbars.
- **Narrow viewport**: On small screens the sidebar collapses (or overlays) so the chat
  area and floating input remain fully usable without horizontal scrolling.
- **Rapid sends**: Sending several messages quickly preserves correct ordering and
  alignment for each user/assistant pair.

## Requirements *(mandatory)*

### Functional Requirements

**Layout & Structure**

- **FR-001**: The interface MUST present three clearly separated zones: a left sidebar,
  a top header above the chat area, and a main chat-and-input area.
- **FR-002**: The interface MUST occupy the full viewport height with the page itself not
  scrolling; only the chat feed and the sidebar history list scroll internally.
- **FR-003**: The message feed MUST render inside a centered, width-constrained container.

**Sidebar (US2)**

- **FR-004**: The sidebar MUST contain a "New Chat" action pinned at the top, a scrollable
  recent-conversation history list in the middle, and a settings/theme area pinned at the
  bottom.
- **FR-005**: The sidebar background MUST be a subtle off-color that visually distinguishes
  it from the main chat area in both light and dark modes.
- **FR-006**: The sidebar MUST be collapsible and expandable; collapsing it MUST let the
  main chat area reclaim the freed space.
- **FR-007**: Selecting "New Chat" MUST clear the feed to a fresh, empty conversation.
- **FR-008**: Selecting a history item MUST load that conversation into the feed and mark
  it as the active conversation.

**Header & Model Selection (US3)**

- **FR-009**: A minimalist, borderless dropdown MUST appear at the top-left of the header
  for selecting the active AI model.
- **FR-010**: The model dropdown MUST offer exactly these options: "Gemini 2.5 Flash",
  "DeepSeek V4 Pro", and "GPT-5.5".
- **FR-011**: The header MUST display the currently selected model, and the selection MUST
  persist for the session.

**Chat Feed (US1)**

- **FR-012**: User messages MUST align to the right and assistant messages MUST align to
  the left within the centered feed.
- **FR-013**: Sending a message MUST immediately append it to the feed and clear the input.
- **FR-014**: After a user message is sent, a mocked assistant reply MUST be appended to
  the feed (locally generated, no real backend).
- **FR-015**: The feed MUST keep the most recent message in view as new messages arrive.

**Input Bar (US1)**

- **FR-016**: The input area MUST be a floating, pill-shaped container positioned just
  above the bottom edge of the screen (detached from the very bottom).
- **FR-017**: The input bar MUST contain, left to right: a "+" attachment button
  (placeholder, non-functional), an auto-expanding text input, and a Send button.
- **FR-018**: The Send control MUST be inactive when the input is empty or whitespace-only
  and MUST activate only when non-whitespace text is present.
- **FR-019**: The text input MUST auto-expand vertically as content grows, up to a bounded
  maximum height, after which it scrolls internally.

**Theming (US4)**

- **FR-020**: The interface MUST support light and dark modes, toggled from the sidebar
  settings/theme area, applying consistently across all zones.
- **FR-021**: The chosen theme MUST persist across reloads.

**Mocking & Scope**

- **FR-022**: All backend calls, AI responses, and chat history MUST be mocked locally;
  the feature MUST NOT depend on any live backend or external AI service.
- **FR-023**: The mocked chat history MUST populate the sidebar with a set of sample
  conversations so history browsing can be demonstrated.

**Message Intent Routing (Amendment 2026-07-01)**

- **FR-024**: When a user submits a message, the system MUST route the raw text through a
  dedicated intent-routing service (the "PayloadRouter") that derives a structured intent
  payload for that message.
- **FR-025**: The intent payload MUST contain exactly these fields: `primary_action`
  (string), `requires_tools` (boolean), `entities` (array of strings), and `model_tier`
  (string).
- **FR-026**: Intent routing MUST be non-blocking and optimistic: the user's message MUST
  appear in the feed immediately on submit, and the assistant reply flow MUST NOT be delayed
  waiting for routing. The intent payload MUST attach to the message once routing resolves.
- **FR-027**: Intent routing MUST be mocked locally and MUST NOT depend on any live AI
  service or backend (consistent with FR-022). The routing interface MUST be defined so a
  real model-backed implementation can replace the mock without changing its callers.
- **FR-028**: If routing fails, times out, or returns nothing, the message MUST still be
  delivered and the conversation MUST continue unaffected (graceful degradation); the absent
  payload MUST NOT block or error the send flow.
- **FR-029**: `model_tier` MUST be drawn from a defined, finite set of tier values (so it is
  testable and unambiguous), and the routing MUST always return a complete payload with all
  four fields populated (no partial payloads).

### Key Entities *(include if feature involves data)*

- **Conversation**: A single chat thread. Has a title/label (shown in sidebar history),
  an ordered list of messages, and an active/inactive state. One conversation is active
  at a time.
- **Message**: A single entry in a conversation. Has a role (user or assistant),
  text content, and an implicit order within its conversation. Role determines left/right
  alignment.
- **Model Selection**: The currently active AI model for the session, chosen from a fixed
  set of three named options.
- **Theme Preference**: The active appearance mode (light or dark), persisted across
  sessions.
- **Intent Payload**: A structured interpretation of a submitted message, derived by the
  routing service. Fields: `primary_action` (the main thing the user wants), `requires_tools`
  (whether fulfilling it would need external tools/actions), `entities` (salient names/things
  extracted from the text), `model_tier` (a suggested capability tier for handling it).
  Associated with the `Message` it was derived from; attaches after the message is displayed.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time user can send a message and see both their message and a mocked
  reply appear, correctly aligned, within 5 seconds of loading the app.
- **SC-002**: 100% of the three named model options are selectable, and the header
  reflects the chosen model immediately after selection.
- **SC-003**: Toggling the theme re-colors every visible zone with legible contrast in
  under 1 second, with no element left in the prior theme's colors.
- **SC-004**: The page body never scrolls; in a conversation exceeding one screen height,
  only the feed scrolls while header and input bar remain fixed — verified at both desktop
  and mobile widths.
- **SC-005**: The Send control is provably gated on content: it is inactive for empty and
  whitespace-only input in 100% of attempts and active for any non-whitespace text.
- **SC-006**: The layout remains usable with no horizontal scrolling across viewport widths
  from 360px (mobile) to 1440px (desktop), with the sidebar collapsing appropriately on
  narrow screens.
- **SC-007**: A user can switch conversations from the sidebar and see the correct thread
  load, and can start a new empty chat, in 100% of attempts.
- **SC-008**: Message send remains instant: the user's message appears in the feed on submit
  regardless of routing state, and a routing failure never prevents message delivery (0%
  blocked or dropped sends across success, failure, and timeout cases).
- **SC-009**: Every routed message yields a complete intent payload — all four fields present
  and correctly typed, with `model_tier` from the defined tier set — in 100% of attempts.

## Assumptions

- **Pixel-perfect target**: "Pixel-perfect Gemini clone" is interpreted as faithfully
  matching Gemini's layout, spacing, and visual language rather than being byte-identical;
  exact brand assets/logos are out of scope and generic placeholders are acceptable.
- **Mocked replies**: Assistant responses are canned/placeholder text generated locally;
  there is no streaming from a real model. A short simulated delay before the reply is
  acceptable but not required.
- **Attachment button**: The "+" button is a visual placeholder only; attaching files is
  out of scope for this feature.
- **Model behavior**: Changing the selected model does not change the mocked responses;
  the selector affects only the displayed active model for this frontend-only phase.
- **Persistence scope**: Only the theme preference is required to persist across reloads.
  Conversations and messages are seeded from local mock data each session; authoring new
  persisted history is out of scope.
- **Theme default**: The app opens in a sensible default theme (following system
  preference where available) and can be toggled from there.
- **Single user**: No authentication, accounts, or multi-user concerns are in scope; this
  is a personal single-user assistant shell.
- **Responsiveness**: On narrow viewports the sidebar collapses or overlays rather than
  permanently occupying horizontal space.
- **PayloadRouter (directed technical detail)**: Per the amendment request, the routing
  service is named **PayloadRouter** and lives at **`/lib/router.ts`**, invoked from the
  `ChatInput` submission path. For this frontend-only phase it MUST derive the intent payload
  **locally/mocked** (e.g., lightweight heuristics over the text) rather than calling a live
  model. The originally requested "call the Gemini 2.5 Flash API" is **deferred**: the mock
  MUST expose the same async interface so a real Gemini-backed call (behind a server route to
  keep the API key server-side) can drop in later without changing callers. Going live with a
  real API is a separate, governed change (it would require amending the constitution's
  frontend-only / fully-mocked mandate).
- **`model_tier` value set**: Assumed to be one of `"flash" | "pro" | "reasoning"` (a small,
  finite set) for this phase; exact tier names can be refined in the plan without changing the
  payload contract.
- **Intent payload persistence**: The payload is in-memory only for this phase and is not
  persisted or shown in the UI; it is available to downstream logic. Surfacing it in the UI is
  out of scope for this amendment.
