-- Soft-hide for Recent Chats: "Remove from Recent" hides a chat from the sidebar
-- without deleting the conversation or its messages.
--
-- Builds on 0004 (public.chats / public.messages + RLS). The existing
-- `chats_update_own` RLS policy already lets an owner flip this flag, so no new
-- policy is required. listChats() filters `hidden = false`.

alter table public.chats
  add column if not exists hidden boolean not null default false;

-- Recency index limited to visible chats (matches the listChats query shape).
create index if not exists chats_user_visible_idx
  on public.chats (user_id, updated_at desc)
  where hidden = false;
