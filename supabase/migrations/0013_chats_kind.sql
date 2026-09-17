-- Two chats, two histories (2026-09-17).
--
-- The knowledge base moved out of the main assistant into its own Knowledge chat
-- (/knowledge). Each page lists only its own conversations, so a chat row records
-- which one it belongs to. Every existing row is a main-chat conversation, which is
-- exactly what the default says.
--
-- Additive and safe to apply before the app that reads it: the previous frontend never
-- names the column, and its inserts take the default.
--
-- A Knowledge-chat assistant message stores the passages it cited in the existing
-- messages.intent jsonb as {"sources": [...]}, so a reopened conversation shows its
-- citations and follow-up questions can be resolved to the same documents. No schema
-- change is needed for that.

alter table public.chats
  add column if not exists kind text not null default 'main';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'chats_kind_check' and conrelid = 'public.chats'::regclass
  ) then
    alter table public.chats add constraint chats_kind_check check (kind in ('main', 'knowledge'));
  end if;
end $$;

create index if not exists chats_user_kind_updated_idx
  on public.chats (user_id, kind, updated_at desc);
