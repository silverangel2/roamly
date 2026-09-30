-- Roamly market-price cache trust boundary repair.
-- The table is reconstructable provider-search cache, not customer or booking truth.

begin;

-- Pre-repair authenticated writes could have authored arbitrary cache rows.
-- Clear the reconstructable cache before reopening trusted ingestion.
delete from public.roamly_market_prices;

alter table public.roamly_market_prices enable row level security;

drop policy if exists "Roamly authenticated users insert market prices" on public.roamly_market_prices;
drop policy if exists "Roamly authenticated users update market prices" on public.roamly_market_prices;
drop policy if exists "Roamly authenticated users read market prices" on public.roamly_market_prices;

create policy "Roamly authenticated users read market prices"
on public.roamly_market_prices
for select
to authenticated
using (true);

revoke all privileges on table public.roamly_market_prices from public, anon;
revoke all privileges on table public.roamly_market_prices from authenticated;
grant select on table public.roamly_market_prices to authenticated;
grant all privileges on table public.roamly_market_prices to service_role;

commit;
