-- Retire the daily briefing schema (sunset Phase H).
--
-- ⚠ IRREVERSIBLE. Everything below is a DROP. Read the checklist before applying.
--
-- WHAT THIS FINISHES. The briefing was replaced by `briefing-agent` (the `brief_*` tables in
-- this same project). The cutover ran over 2026-08-24/25:
--
--   B  briefing_prefs.deliver_email = false     the duplicate email stopped
--   D  chat repointed / tools retired           nothing reads briefing_* from chat
--   E  core-briefing.timer disabled             the pipeline stopped generating
--   F  core-chat /briefing + /api/briefing gone  the reader page removed
--   G  core-heartbeat/briefing/ removed          the pipeline deleted
--   H  this migration                            the tables
--
-- So by the time this runs, NOTHING reads or writes these tables. That is the precondition,
-- and it is worth re-checking rather than assuming — see the checklist.
--
-- BEFORE APPLYING:
--   1. An export exists and has been READ, not just written:
--        ~/backups/briefing-sunset/briefing-tables-2026-08-25.json
--        18 briefings, 152 sections, 25 deliveries, 6 user sources, 1 prefs row.
--        Verified 2026-08-25: real headlines, dates 2026-08-07 .. 2026-08-25.
--   2. `grep -rn briefing_ ~/projects/core-chat ~/projects/core-heartbeat` returns nothing
--      outside comments and this file.
--   3. You accept that the archive is gone. ROADMAP Phase 12 put MIGRATING this data out of
--      scope deliberately — the old archive was to "stay readable where it is". Dropping is
--      therefore a decision taken, not a default followed.
--
-- WHY DROP AT ALL. Nothing forces it. 202 rows cost nothing sitting there, and the argument
-- for removal is that a schema nobody reads is a schema nobody maintains: it still appears in
-- every `db pull`, every drift check and every future reader's mental model of this project,
-- and RLS on a forgotten table is exactly the thing that rots unnoticed.
--
-- ORDER MATTERS. Children first, then parents, so a foreign key never blocks a drop and the
-- statement that fails is the one that names the real problem. `cascade` is deliberately NOT
-- used: if something still references these, this migration should FAIL and tell you, rather
-- than quietly removing whatever was attached.

drop table if exists public.briefing_sections;
drop table if exists public.briefing_deliveries;
drop table if exists public.briefing_items;
drop table if exists public.briefings;
drop table if exists public.briefing_user_sources;
drop table if exists public.briefing_sources;
drop table if exists public.briefing_prefs;
