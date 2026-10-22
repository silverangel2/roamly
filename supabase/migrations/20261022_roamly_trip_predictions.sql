-- Roamly production wiring, Phase 5 (M8): PREDICT records + LEARN grades.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule). NOT executed by the Phase 5 build;
-- it lands with the Phase 5 release, in order, with read-back verification.
--
-- Design: DESIGN-PRODUCTION.md §2.3 + §6 (M8), contradiction C1 — the
-- dedicated table wins over MAP's metadata-JSONB convenience because LEARN
-- grading is a cross-trip query workload, and a prediction buried in trip
-- metadata cannot be graded across trips without scanning every trip.
--
--   roamly_trip_predictions — ONE immutable record per generated trip,
--   written at plan lock by whichever generation path produced the plan
--   (the zero-engine writes generation_version 'zero-engine-v1'). The
--   PREDICT half (highlights / risks / budget_posture / pace_load /
--   learn_contract) is frozen at write time: a database trigger refuses
--   any UPDATE that touches anything but the grades column, so a recorded
--   prediction can never be quietly revised after outcomes are known —
--   LEARN may only APPEND its grades (item outcomes + graded_at) into the
--   grades column, exactly the Phase 1 PredictionRecordDTO lifecycle.
--
-- prediction_id is the Phase 1 content ID (ids.predictionId: trip +
-- pack version), unique — a second write for the same trip+pack is a
-- duplicate-key no-op at the application layer, which is what makes the
-- write idempotent under driver retries.
--
-- FK discipline (Phase 0 FK audit): trip_id references roamly_trips with
-- ON DELETE CASCADE — predictions are children of the trip aggregate, and
-- the Phase 11 purge design archives (never hard-deletes) the purchased
-- trip row, so the cascade cannot fire on the archive path; if a traveler
-- deletes their own trip, its predictions go with it, by design.
-- No FK points AT this table; nothing here can block a trip delete.
--
-- RLS: enabled, service-role-only policies, explicit Data API grants
-- appended in-file per DATA-INFRA §8 (post-Oct-30-2026 grant rules).

create table if not exists public.roamly_trip_predictions (
  id uuid primary key default gen_random_uuid(),
  prediction_id text not null unique,
  trip_id uuid not null references public.roamly_trips (id) on delete cascade,
  user_id uuid not null,
  pack_version_id text,
  generation_version text not null default 'zero-engine-v1',
  recorded_at timestamptz not null,
  highlights jsonb not null default '[]'::jsonb,
  risks jsonb not null default '[]'::jsonb,
  budget_posture jsonb not null default '{}'::jsonb,
  pace_load jsonb not null default '[]'::jsonb,
  learn_contract text,
  grades jsonb,
  created_at timestamptz not null default now()
);

create index if not exists roamly_trip_predictions_trip_idx
  on public.roamly_trip_predictions (trip_id);
create index if not exists roamly_trip_predictions_user_idx
  on public.roamly_trip_predictions (user_id, recorded_at desc);
create index if not exists roamly_trip_predictions_ungraded_idx
  on public.roamly_trip_predictions (recorded_at)
  where grades is null;

-- Immutability guard: the PREDICT record is write-once. The only UPDATE
-- ever permitted replaces the grades column (LEARN appends outcomes);
-- every other column must remain byte-identical to the inserted row.
create or replace function public.roamly_guard_prediction_immutability()
returns trigger
language plpgsql
as $$
begin
  if new.prediction_id is distinct from old.prediction_id
     or new.trip_id is distinct from old.trip_id
     or new.user_id is distinct from old.user_id
     or new.pack_version_id is distinct from old.pack_version_id
     or new.generation_version is distinct from old.generation_version
     or new.recorded_at is distinct from old.recorded_at
     or new.highlights is distinct from old.highlights
     or new.risks is distinct from old.risks
     or new.budget_posture is distinct from old.budget_posture
     or new.pace_load is distinct from old.pace_load
     or new.learn_contract is distinct from old.learn_contract
     or new.created_at is distinct from old.created_at then
    raise exception 'roamly_trip_predictions is immutable except for the grades column';
  end if;
  return new;
end;
$$;

drop trigger if exists roamly_trip_predictions_immutable on public.roamly_trip_predictions;
create trigger roamly_trip_predictions_immutable
  before update on public.roamly_trip_predictions
  for each row execute function public.roamly_guard_prediction_immutability();

alter table public.roamly_trip_predictions enable row level security;

drop policy if exists roamly_trip_predictions_service_role on public.roamly_trip_predictions;
create policy roamly_trip_predictions_service_role
  on public.roamly_trip_predictions
  for all
  to service_role
  using (true)
  with check (true);

grant select, insert, update, delete on public.roamly_trip_predictions to service_role;
