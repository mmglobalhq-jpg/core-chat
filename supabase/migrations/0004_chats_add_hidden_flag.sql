-- Soft-hide for Recent Chats: "Remove from Recent" hides a chat from the sidebar
-- without deleting the conversation or its messages.
--
-- NOTE: the base `public.chats` / `public.messages` tables + RLS (the chat-history
-- feature) were applied to the project directly via the Supabase MCP and were never
-- committed as migration files, so this ALTER assumes those objects already exist.
-- Backfilling those base migrations into this folder is tracked separately.
--
-- The existing `chats_update_own` RLS policy already lets an owner flip this flag,
-- so no new policy is required. listChats() filters `hidden = false`.

alter table public.chats
  add column if not exists hidden boolean not null default false;

-- Recency index limited to visible chats (matches the listChats query shape).
create index if not exists chats_user_visible_idx
  on public.chats (user_id, updated_at desc)
  where hidden = false;
