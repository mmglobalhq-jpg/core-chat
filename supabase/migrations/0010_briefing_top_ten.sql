-- 0010 — Briefing: Top 10, no Deep Dive, and a data section
--
-- Three changes to the briefing's shape, all additive or widening. Nothing is
-- dropped and no existing row becomes invalid: briefings already stored as
-- "5 top + 1 deep dive" stay exactly as they are and still satisfy every
-- constraint here.
--
-- 1. rank may now run to 20 rather than 5.
--
--    The list is going to 10. The ceiling is set at 20 rather than 10 so that a
--    future change to BRIEFING_TOP_COUNT does not require a migration to take
--    effect — the check exists to catch a corrupt rank, not to encode the
--    editorial length, which lives in config.TOP_COUNT and is enforced by
--    compose.validate_structure.
--
-- 2. A deep dive is no longer expected.
--
--    The partial unique index is KEPT, deliberately. It says "at most one deep
--    dive", which remains true and is now trivially satisfied by there being
--    none. Dropping it would remove a guard that costs nothing and would have to
--    be recreated if the section ever returns. Historical rows with kind =
--    'deep_dive' remain readable, so old briefings render unchanged.
--
-- 3. Market data and report links are stored on the briefing, not as sections.
--
--    They are not editorial content: they have no headline, no body and no
--    single source URL, so forcing them into briefing_sections would mean
--    relaxing three NOT NULLs that exist to keep a section traceable. A jsonb
--    column on the parent row keeps those guarantees intact and keeps the
--    rendering data with the briefing it belongs to.

-- 1 ---------------------------------------------------------------------------

alter table public.briefing_sections
  drop constraint if exists briefing_sections_rank_check;

alter table public.briefing_sections
  add constraint briefing_sections_rank_check
  check (rank between 1 and 20);

-- 3 ---------------------------------------------------------------------------

-- Market snapshot: index closes and Treasury yields as rendered that morning.
-- Denormalized on purpose, for the same reason section bodies are: the briefing
-- must not change when the upstream data is revised. FRED restates H.15 series,
-- and a briefing that silently rewrote yesterday's numbers would be worse than
-- one that is plainly a snapshot.
alter table public.briefings
  add column if not exists market_data jsonb;

-- Research reports published since the previous briefing: title, issuer, link.
alter table public.briefings
  add column if not exists report_links jsonb;

comment on column public.briefings.market_data is
  'Snapshot of index closes, Treasury yields and spreads as rendered. Denormalized: '
  'the briefing must not change when FRED restates a series.';

comment on column public.briefings.report_links is
  'REIT research reports published since the previous briefing, as rendered.';

-- NOTE ON CARDINALITY (updated from 0008)
-- "At most one deep dive" and "no duplicate ranks" remain enforced above.
-- "Exactly N top items" is still a cardinality constraint Postgres cannot
-- express without a deferred trigger, and still lives in
-- compose.validate_structure plus the test suite. What changed in 0010 is that
-- N is now 10 and the deep dive is no longer required — the code enforces both,
-- and this file is where the gap stays visible rather than assumed covered.
