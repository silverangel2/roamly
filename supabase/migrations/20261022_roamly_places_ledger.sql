-- Roamly production wiring, Phase 4: the Google Places cost-guard ledger.
--
-- FILES ONLY migration: handed to the owner for manual apply in Supabase.
-- Never applied by agents (house rule). NOT executed by the Phase 4 build.
--
-- Design: DESIGN-PRODUCTION.md §2.5 + DATA-INFRA §5 — the ledger creates
-- NO new table. Monthly counters ride the existing key-value store
-- `roamly_admin_settings` (the same store that already holds the
-- maintenance flag and the Finds promo), one row per (billing scope,
-- month):
--
--   key   = 'places_ledger:v1:<scope>:<YYYY-MM>'
--   value = { "version": 1, "scope": <scope>, "month": "YYYY-MM",
--             "textSearch":   { "reserved": n, "committed": n },
--             "placeDetails": { "reserved": n, "committed": n },
--             "updatedAt": <iso instant | null> }
--
-- "Scope" is the Google project/billing identity of the production
-- Places key (GOOGLE_PLACES_API_KEY, owner-pasted into Vercel). Every
-- spend path for that project shares these counters, so no second path
-- can spend outside the same caps (DESIGN §2.5).
--
-- Caps (policy constants in lib/roamly/engine/places/types.ts, mirrored
-- from CONTRACTS.md): 4,500 Place Details + 9,000 Text Search calls per
-- month — deliberately inside the free allotments (5,000 Pro / 10,000
-- Essentials), so a guarded month bills $0 by construction.
--
-- RESERVE DISCIPLINE (the Supabase ledger implementation, landing with
-- the provider flag, must implement tryReserve as ONE conditional
-- UPDATE so concurrent enrichment jobs cannot overspend):
--
--   update public.roamly_admin_settings
--      set value = jsonb_set(value, '{placeDetails,reserved}',
--                  to_jsonb((value #>> '{placeDetails,reserved}')::int + 1)),
--          updated_at = now()
--    where key = 'places_ledger:v1:<scope>:<YYYY-MM>'
--      and (value #>> '{placeDetails,committed}')::int
--        + (value #>> '{placeDetails,reserved}')::int < 4500
--    returning value;   -- zero rows returned = cap refusal, no call made
--
-- (same shape for textSearch with its 9,000 cap). Commit decrements
-- reserved and increments committed; release decrements reserved; a
-- reservation whose call outcome is unknown STAYS in reserved under a
-- reconciliation status on its operation record — never blindly
-- retried into a double-spend (lib/roamly/engine/places/ledger.ts is
-- the reference semantics, proven by the Phase 4 checks).
--
-- Per-call operation records (reserve/commit/release with unique
-- operation keys) are stamped onto the candidate's enrichment record
-- (roamly_destination_candidates.enrichment -> 'operationKey', M7) —
-- the audit trail lives with the record it paid for.
--
-- Below: idempotent seeds of the counter rows for the authoring month
-- and the next, for the production scope. Later months' rows are
-- created on first use by the ledger service (an absent row reads as
-- zeroes), exactly as the in-memory reference implementation does.

insert into public.roamly_admin_settings (key, value)
values
  ('places_ledger:v1:roamly-production:2026-10',
   '{"version": 1, "scope": "roamly-production", "month": "2026-10",
     "textSearch": {"reserved": 0, "committed": 0},
     "placeDetails": {"reserved": 0, "committed": 0},
     "updatedAt": null}'::jsonb),
  ('places_ledger:v1:roamly-production:2026-11',
   '{"version": 1, "scope": "roamly-production", "month": "2026-11",
     "textSearch": {"reserved": 0, "committed": 0},
     "placeDetails": {"reserved": 0, "committed": 0},
     "updatedAt": null}'::jsonb)
on conflict (key) do nothing;
