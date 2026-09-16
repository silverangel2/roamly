-- Account-holder passport country is an explicit, nullable traveler fact.
-- This migration is intentionally local-only until the production schema gate
-- is reviewed and manually approved.

alter table public.traveler_profiles
  add column if not exists passport_issuing_country text;

alter table public.traveler_profiles
  drop constraint if exists traveler_profiles_passport_issuing_country_check;

alter table public.traveler_profiles
  add constraint traveler_profiles_passport_issuing_country_check
  check (passport_issuing_country is null or passport_issuing_country ~ '^[A-Z]{2}$');
