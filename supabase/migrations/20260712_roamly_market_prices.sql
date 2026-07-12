-- Roamly travel market price cache.
-- Stores normalized searched market options so itinerary budgets can cite search/provider data.

create extension if not exists pgcrypto;

create table if not exists public.roamly_market_prices (
  id uuid primary key default gen_random_uuid(),
  category text not null check (category in ('flight', 'hotel', 'attraction', 'tour', 'transport')),
  provider text,
  source text check (source in ('travelpayouts', 'stay22', 'getyourguide', 'viator', 'klook', 'google_search', 'fallback_estimate')),
  origin text,
  destination text,
  city text,
  country text,
  start_date date,
  end_date date,
  travelers integer,
  rooms integer,
  room_type text,
  title text not null,
  price_amount numeric,
  price_min numeric,
  price_max numeric,
  currency text default 'CAD',
  price_type text not null check (price_type in ('live_partner', 'cached_recent', 'search_ready', 'estimated_fallback', 'unknown')),
  confidence text not null check (confidence in ('high', 'medium', 'low')),
  booking_url text,
  normal_search_url text,
  affiliate_url text,
  search_key text not null,
  searched_at timestamptz default now(),
  expires_at timestamptz,
  metadata jsonb default '{}'::jsonb,
  created_at timestamptz default now()
);

create index if not exists roamly_market_prices_search_key_idx on public.roamly_market_prices (search_key);
create index if not exists roamly_market_prices_category_idx on public.roamly_market_prices (category);
create index if not exists roamly_market_prices_expires_at_idx on public.roamly_market_prices (expires_at);
create index if not exists roamly_market_prices_dates_idx on public.roamly_market_prices (start_date, end_date);
