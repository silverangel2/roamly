alter table public.roamly_market_prices
  drop constraint if exists roamly_market_prices_category_check;

alter table public.roamly_market_prices
  add constraint roamly_market_prices_category_check
  check (category in ('flight', 'hotel', 'attraction', 'tour', 'restaurant', 'transport'));
