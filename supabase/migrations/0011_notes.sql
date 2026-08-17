-- Notes: short documents a person writes, edits and deletes themselves.
--
-- WHY THE CORE PROJECT (DB-02) AND NOT RESEARCH (DB-01).
-- A note is personal data belonging to one authenticated user, which is exactly
-- what DB-02 holds (profiles, chats, messages, documents). DB-01 holds fund and
-- REIT data, which has no owner column and a different sensitivity class
-- entirely. Putting user content there would also mean the browser needed
-- DB-01 credentials, which no client currently has and which doc 07 (D-05)
-- explicitly relies on not existing.
--
-- UNLIKE `briefings`, THIS TABLE IS FULLY USER-WRITABLE. A briefing is asserted
-- to be sourced and so a browser may not create one; a note is the user's own
-- words and there is nothing to assert. All four verbs are therefore granted,
-- each constrained to the caller's own rows.
--
-- `updated_at` IS MAINTAINED BY THE WRITER, not a trigger. That is the
-- convention already set by `chats` in 0004, and the notes list is ordered by
-- it, so the API route sets it on every edit. A trigger here would be a second
-- mechanism doing what one already does elsewhere.

create table if not exists public.notes (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,

  -- Both default to empty rather than being required. A note starts as a blank
  -- page and is saved as the user types; refusing to store an untitled draft
  -- would mean the first keystroke has nowhere to go.
  title       text        not null default '',
  body        text        not null default '',

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  -- Bounded in the database as well as the API. The route checks these too, but
  -- the route is not the only thing that could ever write here, and an
  -- unbounded text column is a way to fill a shared database from a browser.
  constraint notes_title_len check (char_length(title) <= 200),
  constraint notes_body_len  check (char_length(body)  <= 100000)
);

-- The list query is "my notes, most recently edited first" — this serves it
-- exactly and is the same shape as chats_user_updated_idx from 0004.
create index if not exists notes_user_updated_idx
  on public.notes (user_id, updated_at desc);

alter table public.notes enable row level security;
alter table public.notes force  row level security;

-- Explicit, not inherited from Supabase's `grant all on all tables` default for
-- the public schema. Without a grant, RLS is never reached — permission fails
-- first — so a wrong policy would pass every test. Same reasoning as 0008/0009.
revoke all on public.notes from anon, authenticated;
grant select, insert, update, delete on public.notes to authenticated;

create policy notes_select_own on public.notes
  for select using (user_id = auth.uid());
create policy notes_insert_own on public.notes
  for insert with check (user_id = auth.uid());
create policy notes_update_own on public.notes
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notes_delete_own on public.notes
  for delete using (user_id = auth.uid());

grant all on public.notes to service_role;

comment on table public.notes is
  'User-authored notes. Owner-scoped: every policy keys on auth.uid(). The API '
  'routes additionally filter on the token-derived user_id and never trust a '
  'user_id from the request body.';
