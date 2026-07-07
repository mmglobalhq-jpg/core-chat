-- Chat history (the "Recent Chats" feature): per-user conversations + messages.
--
-- BACKFILL NOTE: these objects were originally applied to the project directly via
-- the Supabase MCP and not committed as a migration. This file records that schema
-- so the migrations folder reflects the deployed state. Written idempotently
-- (if-not-exists / drop-policy-if-exists) so it is safe to run against a database
-- that already has these objects.

-- chats: one row per conversation, owned by a user.
create table if not exists public.chats (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  title       text not null default 'New chat',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists chats_user_updated_idx
  on public.chats (user_id, updated_at desc);

-- messages: ordered turns within a chat.
create table if not exists public.messages (
  id          uuid primary key default gen_random_uuid(),
  chat_id     uuid not null references public.chats(id) on delete cascade,
  role        text not null check (role in ('user','assistant')),
  content     text not null default '',
  intent      jsonb,
  created_at  timestamptz not null default now()
);
create index if not exists messages_chat_created_idx
  on public.messages (chat_id, created_at);

alter table public.chats    enable row level security;
alter table public.messages enable row level security;

-- chats: owner-only CRUD.
drop policy if exists chats_select_own on public.chats;
create policy chats_select_own on public.chats for select using (user_id = auth.uid());
drop policy if exists chats_insert_own on public.chats;
create policy chats_insert_own on public.chats for insert with check (user_id = auth.uid());
drop policy if exists chats_update_own on public.chats;
create policy chats_update_own on public.chats for update using (user_id = auth.uid());
drop policy if exists chats_delete_own on public.chats;
create policy chats_delete_own on public.chats for delete using (user_id = auth.uid());

-- messages: reachable only through a chat the caller owns.
drop policy if exists messages_select_own on public.messages;
create policy messages_select_own on public.messages for select
  using (exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid()));
drop policy if exists messages_insert_own on public.messages;
create policy messages_insert_own on public.messages for insert
  with check (exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid()));
drop policy if exists messages_delete_own on public.messages;
create policy messages_delete_own on public.messages for delete
  using (exists (select 1 from public.chats c where c.id = chat_id and c.user_id = auth.uid()));
