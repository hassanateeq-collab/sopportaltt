-- Store the per-question answers a staff member selected on an attempt, so a
-- test report can show each question with the correct option and the one they
-- picked. Older attempts (before this column) simply have NULL and the report
-- notes the breakdown is unavailable for them.
--
-- Run once in the SQL Editor after 0002. Safe to re-run.

alter table public.attempts add column if not exists answers jsonb;
