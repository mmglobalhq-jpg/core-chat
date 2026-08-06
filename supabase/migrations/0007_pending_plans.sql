-- Write actions proposed to the user and awaiting their "yes".
--
-- The confirmation handshake spans two HTTP requests: one turn proposes a batch of
-- calendar writes, the next turn releases it. That plan was held in the gateway's
-- process memory, which meant a restart between the two lost it, and — because the
-- payload carried no chat id — two conversations by the same user shared one slot,
-- so approving in one could have released the other's writes.
--
-- Keyed by (user_id, chat_id) so a plan belongs to the conversation that proposed
-- it. Server-only, like google_credentials: RLS enabled and forced with no
-- anon/authenticated policies, so only the service role reaches it. The rows
-- describe pending WRITES to a user's calendar, so a browser must never be able to
-- read or forge one.

create table if not exists public.pending_plans (
  user_id    uuid        not null references auth.users (id) on delete cascade,
  chat_id    text        not null,
  calls      jsonb       not null,        -- [{"name": ..., "args": {...}}, ...]
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (user_id, chat_id)
);

-- The gateway sweeps expired rows opportunistically, but a plan is only ever read
-- by its own (user_id, chat_id), so this index serves the cleanup, not the read.
create index if not exists pending_plans_expires_at_idx
  on public.pending_plans (expires_at);

revoke all on public.pending_plans from anon, authenticated;
alter table public.pending_plans enable row level security;
alter table public.pending_plans force  row level security;
