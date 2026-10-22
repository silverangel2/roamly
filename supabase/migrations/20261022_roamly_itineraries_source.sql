-- Roamly production wiring, Phase 5 (M10): honest itinerary provenance.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule). NOT executed by the Phase 5 build;
-- it lands with the Phase 5 release, in order, with read-back verification.
--
-- Design: DESIGN-PRODUCTION.md §1.6 + §6 (M10), DATA-INFRA Blocker B2.
--
-- The problem this solves, honestly: isFinalStoredItinerary() accepts a
-- stored plan as final only when full_json.generation_note matches the
-- staged-AI wording. The deterministic zero-engine must NEVER write that
-- literal — its plans are not AI-generated, and faking the note would be
-- a provenance lie baked into every engine itinerary. The honest fix is
-- an explicit source column on the itinerary row:
--
--   source = 'staged-ai'   (default; every pre-existing row, and every
--                           row the incumbent model path writes)
--   source = 'zero-engine' (rows the deterministic engine finalizes;
--                           stamped by the engine's finalization bridge)
--
-- Finalization acceptance (the Phase 5 code change in
-- generationFinalization.ts) then reads: a non-empty daily_itinerary
-- AND (the legacy staged-AI note) OR (source = 'zero-engine' AND a note
-- that names the zero-engine). Content validation is untouched — this
-- widens PROVENANCE acceptance only, for rows whose provenance is
-- explicit in the schema rather than implied by a sentence.
--
-- The DEFAULT is 'staged-ai' so every existing row and every incumbent
-- write keeps its current meaning with zero backfill and zero behavior
-- change while the zero-engine flag is off.

alter table public.roamly_itineraries
  add column if not exists source text not null default 'staged-ai';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'roamly_itineraries_source_check'
  ) then
    alter table public.roamly_itineraries
      add constraint roamly_itineraries_source_check
      check (source in ('staged-ai', 'zero-engine'));
  end if;
end;
$$;

comment on column public.roamly_itineraries.source is
  'Generation provenance: staged-ai (incumbent model path) | zero-engine (deterministic engine, Phase 5). Finalization accepts an engine final only when source = ''zero-engine'' AND full_json.generation_note names the zero-engine (M10).';
