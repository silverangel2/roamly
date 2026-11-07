-- Roamly consolidation 2026-11-06: OSRM leg matrix on pack versions.
--
-- The pack builder computes ONE OSRM /table call per profile
-- (car + foot) per destination at build time and caches the
-- resulting duration matrix on the pack version, so generation
-- and solving make zero per-trip routing calls. The matrix is
-- part of the version's immutable content, like its candidate
-- rows. NULL = the version was built before this column existed
-- or routing was unreachable at build time; the solver then
-- falls back to haversine estimates, labelled as estimates on
-- every leg they produce.
--
-- NOT APPLIED by the consolidation build — ships with the
-- release, applied alongside the code that reads the column.

alter table public.roamly_destination_packs
  add column if not exists leg_matrix jsonb;
