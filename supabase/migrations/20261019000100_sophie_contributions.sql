-- Owner-applied migration: draft research only. No existing library rows change.
create table if not exists public.sophie_contributions (
 id uuid primary key default gen_random_uuid(),
 fingerprint text not null unique check (fingerprint ~ '^[0-9a-f]{64}$'),
 subject text not null check (length(subject) between 1 and 500),
 payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 1048576),
 status text not null default 'pending' check (status in ('pending','accepted','rejected')),
 created_at timestamptz not null default now(),
 reviewed_at timestamptz,
 review_note text,
 check ((status = 'pending' and reviewed_at is null and review_note is null) or (status <> 'pending' and reviewed_at is not null and length(review_note) between 1 and 2000))
);
create index if not exists sophie_contributions_status_created on public.sophie_contributions(status,created_at desc);
alter table public.sophie_contributions enable row level security;
revoke all on public.sophie_contributions from public,anon,authenticated;
grant select,insert,update on public.sophie_contributions to service_role;
-- RLS has no public policies. Only the server service role accesses drafts.

-- Bound review backlog atomically even under concurrent requests.
create or replace function public.guard_sophie_contribution_intake()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('sophie_contributions_pending_limit',0));
 if exists(select 1 from public.sophie_contributions where fingerprint = new.fingerprint) then
  return null;
 end if;
 if new.status <> 'pending' then raise exception 'New research must enter pending review'; end if;
 if (select count(*) from public.sophie_contributions where status = 'pending') >= 50 then
  raise exception 'Sophie review queue is full (50 pending); drain before submitting';
 end if;
 return new;
end;
$$;
revoke all on function public.guard_sophie_contribution_intake() from public,anon,authenticated;
grant execute on function public.guard_sophie_contribution_intake() to service_role;
drop trigger if exists sophie_contribution_intake_guard on public.sophie_contributions;
create trigger sophie_contribution_intake_guard before insert on public.sophie_contributions
 for each row execute function public.guard_sophie_contribution_intake();
