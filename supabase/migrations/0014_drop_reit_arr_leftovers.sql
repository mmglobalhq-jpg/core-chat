-- 0014: drop the empty reit_arr_* leftovers from the Core project.
--
-- Why: ARR's alembic run once created its schema here, before ARR settled on the separate
-- research project, which holds the live REIT data. On Core, the 18 data tables have
-- always been empty, and reit_arr_alembic_version holds only alembic's version marker.
-- No view, FK, publication or function outside the set depends on them (checked 2026-11-25).
-- Nothing on Core reads them: ARR's DATABASE_URL and core-heartbeat's REITS_SUPABASE_URL both
-- point at the research project. The only remaining mention is briefing-agent/types/database.ts (generated types).
--
-- Rollback: restore the tables' DDL from the 2026-11-25 nightly Core dump
-- (pg_restore -t <table>); see system-source-of-truth doc 07, D-07.
--
-- Guard: refuse to run if any data table has acquired rows.

do $$
declare
  t text;
  n bigint;
begin
  for t in
    select c.relname from pg_class c join pg_namespace s on s.oid = c.relnamespace
    where s.nspname = 'public' and c.relkind = 'r' and c.relname like 'reit\_arr\_%'
      and c.relname <> 'reit_arr_alembic_version'
  loop
    execute format('select count(*) from public.%I', t) into n;
    if n > 0 then
      raise exception 'refusing to drop: public.% has % rows', t, n;
    end if;
  end loop;
end $$;

drop table if exists
  public.reit_arr_report_claims,
  public.reit_arr_report_dependencies,
  public.reit_arr_report_versions,
  public.reit_arr_reports,
  public.reit_arr_validation_results,
  public.reit_arr_metric_values,
  public.reit_arr_dividend_metrics,
  public.reit_arr_hedge_positions,
  public.reit_arr_portfolio_positions,
  public.reit_arr_repo_positions,
  public.reit_arr_swap_buckets,
  public.reit_arr_macro_observations,
  public.reit_arr_snapshots,
  public.reit_arr_source_documents,
  public.reit_arr_pipeline_runs,
  public.reit_arr_feed_checks,
  public.reit_arr_scheduler_state,
  public.reit_arr_webhook_outbox,
  public.reit_arr_alembic_version
  restrict;

-- Fail loudly if anything named reit_arr_* survived, e.g. a table added after this was written.
do $$
begin
  if exists (select 1 from pg_class c join pg_namespace s on s.oid = c.relnamespace
             where s.nspname = 'public' and c.relname like 'reit\_arr\_%') then
    raise exception 'reit_arr_* objects remain after drop';
  end if;
end $$;
