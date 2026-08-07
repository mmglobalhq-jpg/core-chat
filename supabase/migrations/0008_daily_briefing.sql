-- Daily Briefing: one canonical briefing per user per day.
--
-- SHAPE
-- Ingestion is shared, selection is per-user. The same news story is fetched once
-- into briefing_items regardless of how many users end up seeing it; what differs
-- per user is which items were chosen and how they were written up.
--
-- A BRIEFING IS AN IMMUTABLE SNAPSHOT. briefing_sections denormalizes the
-- headline, summary, URL and source name rather than joining to briefing_items at
-- read time. Source pages get edited, retracted and paywalled; a briefing that
-- silently rewrote itself afterwards would be a record of nothing. It also means
-- the reader-facing tables never join to the ingestion working set, so that set
-- can stay service-role only.
--
-- ONE PER DAY is the unique constraint on (user_id, briefing_date), not an
-- application check. A retried or double-fired job must be unable to produce a
-- second briefing, and the only place that can be guaranteed is here.
--
-- RLS
-- Reader-facing tables (briefings, briefing_sections, briefing_deliveries,
-- briefing_prefs) carry per-user policies in the chats/messages style: a user
-- reads their own rows and nothing else. Server-side tables (briefing_sources,
-- briefing_items) follow the pending_plans/google_credentials pattern — RLS
-- enabled AND forced with no anon/authenticated policies, so only the service
-- role reaches them.
--
-- Writes are service-role only everywhere. A user may read their briefing and
-- edit their preferences; they may not author a briefing, because the contents
-- are asserted to be sourced and a browser cannot make that assertion.


-- ---------------------------------------------------------------------------
-- Source registry (server-side)
-- ---------------------------------------------------------------------------

create table if not exists public.briefing_sources (
  id           uuid        primary key default gen_random_uuid(),
  kind         text        not null check (kind in ('rss', 'search', 'fetch')),
  name         text        not null,
  url          text,                        -- feed or seed URL; null for pure search
  topic        text        not null,
  weight       real        not null default 1.0 check (weight >= 0),
  is_active    boolean     not null default true,
  -- Set when a host asks us not to crawl it, or blocks automated access. We
  -- record the refusal and stop; we never route around it.
  blocked_at   timestamptz,
  blocked_note text,
  created_at   timestamptz not null default now(),
  unique (kind, url, topic)
);

create index if not exists briefing_sources_active_idx
  on public.briefing_sources (topic) where is_active and blocked_at is null;

revoke all on public.briefing_sources from anon, authenticated;
alter table public.briefing_sources enable row level security;
alter table public.briefing_sources force  row level security;


-- ---------------------------------------------------------------------------
-- Ingested items (server-side working set)
-- ---------------------------------------------------------------------------

create table if not exists public.briefing_items (
  id            uuid        primary key default gen_random_uuid(),
  source_id     uuid        references public.briefing_sources (id) on delete set null,
  url           text        not null,
  url_hash      text        not null,       -- sha256(normalized url); the dedup key
  title         text        not null,
  summary       text,
  body          text,                       -- extracted text, UNTRUSTED DATA
  published_at  timestamptz,
  fetched_at    timestamptz not null default now(),
  topic         text,
  -- Dedup: near-identical stories from different outlets collapse onto one
  -- cluster_id. The representative row is the one with cluster_id = id.
  cluster_id    uuid,
  embedding     jsonb,                      -- nomic-embed-text vector
  -- Non-null when ingestion refused the item: robots.txt disallow, paywall,
  -- login wall, anti-bot challenge. Kept rather than dropped so the pipeline can
  -- report what it declined to read instead of appearing to have seen everything.
  skipped_reason text,
  unique (url_hash)
);

create index if not exists briefing_items_fetched_idx  on public.briefing_items (fetched_at desc);
create index if not exists briefing_items_cluster_idx  on public.briefing_items (cluster_id);
create index if not exists briefing_items_topic_idx    on public.briefing_items (topic, published_at desc);

revoke all on public.briefing_items from anon, authenticated;
alter table public.briefing_items enable row level security;
alter table public.briefing_items force  row level security;


-- ---------------------------------------------------------------------------
-- Per-user preferences (user-readable and user-writable)
-- ---------------------------------------------------------------------------

create table if not exists public.briefing_prefs (
  user_id       uuid        primary key references auth.users (id) on delete cascade,
  enabled       boolean     not null default false,
  topics        text[]      not null default '{}',
  -- Local wall-clock time the briefing is FOR, plus the zone that defines "day".
  -- America/Chicago matches the platform default set on 2026-08-05.
  deliver_at    time        not null default '06:30',
  timezone      text        not null default 'America/Chicago',
  deliver_email boolean     not null default false,
  email_to      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

alter table public.briefing_prefs enable row level security;
alter table public.briefing_prefs force  row level security;

-- Grant explicitly rather than leaning on Supabase's default privileges for the
-- public schema. Without a grant, RLS is never reached — the request fails on
-- permission first — so a policy could be wrong for months and every test would
-- still pass. Explicit grants make RLS the thing actually under test.
revoke all on public.briefing_prefs from anon;
grant select, insert, update on public.briefing_prefs to authenticated;

create policy briefing_prefs_select_own on public.briefing_prefs
  for select using (user_id = auth.uid());
create policy briefing_prefs_insert_own on public.briefing_prefs
  for insert with check (user_id = auth.uid());
create policy briefing_prefs_update_own on public.briefing_prefs
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- The canonical briefing
-- ---------------------------------------------------------------------------

create table if not exists public.briefings (
  id            uuid        primary key default gen_random_uuid(),
  user_id       uuid        not null references auth.users (id) on delete cascade,
  briefing_date date        not null,
  status        text        not null default 'pending'
                            check (status in ('pending', 'generating', 'ready', 'failed')),
  timezone      text        not null default 'America/Chicago',
  generated_at  timestamptz,
  -- Provenance for the run itself: which models were used, how many escalations,
  -- how many sources were read and how many were declined.
  run_meta      jsonb       not null default '{}'::jsonb,
  error         text,
  created_at    timestamptz not null default now(),

  -- THE canonical-briefing invariant. Not an app-level check.
  unique (user_id, briefing_date)
);

create index if not exists briefings_user_date_idx
  on public.briefings (user_id, briefing_date desc);

alter table public.briefings enable row level security;
alter table public.briefings force  row level security;

-- Read-only for the owner. No insert/update/delete policy AND no write grant:
-- briefings are written by the service role, because every claim in one is
-- asserted to be sourced and a browser cannot make that assertion.
revoke all on public.briefings from anon, authenticated;
grant select on public.briefings to authenticated;

create policy briefings_select_own on public.briefings
  for select using (user_id = auth.uid());


-- ---------------------------------------------------------------------------
-- Briefing contents — Top 5 + exactly one Deep Dive
-- ---------------------------------------------------------------------------

create table if not exists public.briefing_sections (
  id           uuid        primary key default gen_random_uuid(),
  briefing_id  uuid        not null references public.briefings (id) on delete cascade,
  kind         text        not null check (kind in ('top', 'deep_dive')),
  rank         smallint    not null check (rank between 1 and 5),
  -- Denormalized snapshot. See the header note: the briefing must not change
  -- when the source does.
  headline     text        not null,
  body         text        not null,
  url          text        not null,
  source_name  text,
  published_at timestamptz,
  -- Every rendered claim traces back to a fetched item. Nullable only because a
  -- source row may later be pruned; the URL above is the durable provenance.
  item_id      uuid        references public.briefing_items (id) on delete set null,
  created_at   timestamptz not null default now()
);

-- At most one deep dive per briefing, enforced by the database.
create unique index if not exists briefing_sections_one_deep_dive
  on public.briefing_sections (briefing_id) where kind = 'deep_dive';

-- No two top items share a rank.
create unique index if not exists briefing_sections_top_rank
  on public.briefing_sections (briefing_id, rank) where kind = 'top';

create index if not exists briefing_sections_briefing_idx
  on public.briefing_sections (briefing_id, kind, rank);

alter table public.briefing_sections enable row level security;
alter table public.briefing_sections force  row level security;

revoke all on public.briefing_sections from anon, authenticated;
grant select on public.briefing_sections to authenticated;

create policy briefing_sections_select_own on public.briefing_sections
  for select using (exists (
    select 1 from public.briefings b
    where b.id = briefing_id and b.user_id = auth.uid()
  ));

-- NOTE ON CARDINALITY
-- "At most one deep dive" and "no duplicate ranks" are enforced above. "Exactly
-- five top items and exactly one deep dive" is a cardinality constraint, which
-- Postgres cannot express without a deferred constraint trigger. It is enforced
-- in the composition code and asserted in the test suite instead. Stated here so
-- the gap is visible rather than assumed covered.


-- ---------------------------------------------------------------------------
-- Delivery attempts
-- ---------------------------------------------------------------------------

create table if not exists public.briefing_deliveries (
  id           uuid        primary key default gen_random_uuid(),
  briefing_id  uuid        not null references public.briefings (id) on delete cascade,
  channel      text        not null check (channel in ('email', 'file', 'app')),
  status       text        not null check (status in ('pending', 'sent', 'failed', 'skipped')),
  provider     text,                        -- 'resend', 'file', ...
  detail       text,                        -- provider message id, or the failure
  attempted_at timestamptz not null default now()
);

create index if not exists briefing_deliveries_briefing_idx
  on public.briefing_deliveries (briefing_id, attempted_at desc);

alter table public.briefing_deliveries enable row level security;
alter table public.briefing_deliveries force  row level security;

revoke all on public.briefing_deliveries from anon, authenticated;
grant select on public.briefing_deliveries to authenticated;

create policy briefing_deliveries_select_own on public.briefing_deliveries
  for select using (exists (
    select 1 from public.briefings b
    where b.id = briefing_id and b.user_id = auth.uid()
  ));


-- ---------------------------------------------------------------------------
-- Service-role grants
-- ---------------------------------------------------------------------------
-- The generator writes all six tables as the service role. Supabase grants this
-- by default, but stating it makes the migration portable to the isolated test
-- database and makes the privilege model readable in one place.

grant all on
  public.briefing_sources,
  public.briefing_items,
  public.briefings,
  public.briefing_sections,
  public.briefing_deliveries,
  public.briefing_prefs
to service_role;
