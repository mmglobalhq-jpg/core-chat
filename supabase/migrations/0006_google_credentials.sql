-- Per-user Google OAuth tokens for the Calendar integration.
-- Tokens are secrets (like passwords): service-role only. RLS is enabled + forced
-- with NO anon/authenticated policies, so only the server (supabaseAdmin, which
-- bypasses RLS) can read/write them — they are never exposed to the browser.

create table if not exists public.google_credentials (
  user_id       uuid primary key references auth.users (id) on delete cascade,
  email         text,                      -- connected Google account (for display)
  access_token  text not null,
  refresh_token text not null,
  scope         text,
  expiry        timestamptz not null,      -- access_token expiry
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

revoke all on public.google_credentials from anon, authenticated;
alter table public.google_credentials enable row level security;
alter table public.google_credentials force  row level security;
