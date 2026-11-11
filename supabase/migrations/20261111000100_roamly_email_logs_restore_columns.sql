-- Roamly email logs — restore the three columns + template index that
-- never landed in production (Stage 3 truth sweep, finding F-2).
--
-- PROVENANCE: Stage 3 production truth sweep (2026-11-10), finding F-2 in
-- hidden_files/stage3-truth-sweep/SWEEP-REPORT.md. The sweep's F5-2 probe
-- read roamly_email_logs at 15 columns live against the chain's 18 — the
-- sweep's ONLY downward drift — and F5-7 read roamly_email_logs_template_idx
-- as the F5 family's one missing index.
--
-- WHAT THIS RESTORES (and nothing else): the three columns the chain's
-- 20260714_roamly_completion_email_delivery.sql added on paper but which
-- are absent in production — template, attempt_count, last_error — plus
-- that file's roamly_email_logs_template_idx. The missing three were
-- identified by elimination in the sweep report: logEmail's primary insert
-- (lib/roamly/email.ts:383) carries all four 20260714 additions
-- (idempotency_key, template, attempt_count, last_error) and its
-- column-missing fallback (lib/roamly/email.ts:391-397) deletes exactly
-- those four; idempotency_key is excluded because its index exists live
-- (F5-7), leaving exactly the three named here for the 18 - 15 gap.
--
-- WHY IT MATTERS (live effects today): (1) every email send's log write
-- fails its first insert and silently falls back, dropping the
-- template/attempt/last-error data — sends themselves are unaffected;
-- (2) the Admin Email Center log views ERROR in production because they
-- select the missing columns: app/admin/email/page.tsx:29 and
-- app/api/admin/roamly/email/logs/route.ts:11 select
-- ..., last_error, template, attempt_count, ... and
-- app/api/admin/roamly/email/retry/route.ts:28 selects template.
--
-- STATEMENTS: every statement below is 20260714's own, re-issued with its
-- idempotence guards (add column if not exists / create index if not
-- exists), so the file is safe to run against any partial state and safe
-- to re-run. Source lines in 20260714_roamly_completion_email_delivery.sql:
-- the combined add-column block (:37-54, restricted here to the three
-- missing columns — template :47, attempt_count :48, last_error :50;
-- create-table definitions agree at :27/:28/:30), the attempt_count
-- set-default action (:58, in the :56-61 block — included so a partial
-- state where attempt_count exists without its default still lands on
-- the chain's exact end state), and the template index (:124).
-- Deliberately NOT re-issued: roamly_email_logs_attempt_count_check
-- (20260714 :76-77) — the sweep's constraint layer is unprobed
-- (SWEEP-REPORT §7) and the F-2 disposition names columns + index only;
-- adding it is a separate, later decision.
--
-- READ-BACK after applying: hidden_files/stage3-truth-sweep/F2-FIX-READBACK.sql
-- (3 column rows with types/defaults, total column count = 18, the index
-- row, and a limit-0 select of the admin logs route's exact column list).
-- ROLLBACK: hidden_files/stage3-truth-sweep/F2-FIX-ROLLBACK.sql
-- (outside migrations/, same pattern as Stage 1's rollback).

alter table public.roamly_email_logs
  add column if not exists template text,
  add column if not exists attempt_count integer not null default 1,
  add column if not exists last_error text;

alter table public.roamly_email_logs
  alter column attempt_count set default 1;

create index if not exists roamly_email_logs_template_idx on public.roamly_email_logs (template);
