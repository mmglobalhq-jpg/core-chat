-- Sources a user added themselves.
--
-- Separate from public.briefing_sources, which is a global registry with no
-- owner. Bolting user_id onto that table would have made every row's ownership
-- ambiguous and every policy conditional; a user's own list is a different
-- thing from the shared catalogue and gets its own table.
--
-- WHAT IS STORED IS ALREADY VALIDATED. A row only exists because discovery
-- resolved the URL, robots.txt permitted it, and the feed parsed or the page
-- yielded headlines. The pipeline re-checks robots at fetch time regardless —
-- permission can be withdrawn after a source is added, and a stored row is not
-- a standing entitlement.
--
-- Unlike briefings, this table IS user-writable: a person owns their own reading
-- list. Insert and update are still constrained to their own rows.

create table if not exists public.briefing_user_sources (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users (id) on delete cascade,
  kind        text        not null check (kind in ('rss', 'site')),
  url         text        not null,
  name        text        not null,
  topic       text        not null default 'custom',
  is_active   boolean     not null default true,
  -- Health, written by the job. A source that starts failing should be visible
  -- in the UI rather than silently contributing nothing, which is exactly how
  -- the platform's dead Google News feed went unnoticed for a day.
  last_ok_at  timestamptz,
  last_error  text,
  created_at  timestamptz not null default now(),

  -- One entry per URL per person. Adding the same feed twice is a mistake, not
  -- a preference, and duplicates would double-weight that source in ranking.
  unique (user_id, url)
);

create index if not exists briefing_user_sources_active_idx
  on public.briefing_user_sources (user_id) where is_active;

alter table public.briefing_user_sources enable row level security;
alter table public.briefing_user_sources force  row level security;

-- Explicit, not inherited from Supabase's defaults for the public schema.
-- Without a grant, RLS is never reached — the request fails on permission first
-- — so a wrong policy would pass every test. Same reasoning as migration 0008.
revoke all on public.briefing_user_sources from anon, authenticated;
grant select, insert, update, delete on public.briefing_user_sources to authenticated;

create policy briefing_user_sources_select_own on public.briefing_user_sources
  for select using (user_id = auth.uid());
create policy briefing_user_sources_insert_own on public.briefing_user_sources
  for insert with check (user_id = auth.uid());
create policy briefing_user_sources_update_own on public.briefing_user_sources
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy briefing_user_sources_delete_own on public.briefing_user_sources
  for delete using (user_id = auth.uid());

grant all on public.briefing_user_sources to service_role;
