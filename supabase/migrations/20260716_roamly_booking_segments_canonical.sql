-- Unify booking segments with the canonical Roamly booking table.

create table if not exists public.booking_segments (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.roamly_bookings(id) on delete cascade,
  sequence integer not null,
  origin text,
  destination text,
  departure_time timestamptz,
  arrival_time timestamptz,
  provider text,
  service_number text,
  terminal text,
  gate text,
  seat text,
  status text not null default 'scheduled',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists booking_segments_booking_sequence_idx
  on public.booking_segments (booking_id, sequence);

alter table public.booking_segments enable row level security;

drop policy if exists "Users read own booking segments"
  on public.booking_segments;

create policy "Users read own booking segments"
on public.booking_segments
for select
using (
  exists (
    select 1
    from public.roamly_bookings booking
    where booking.id = booking_segments.booking_id
      and booking.user_id = auth.uid()
  )
);

drop policy if exists "Users insert own booking segments"
  on public.booking_segments;

create policy "Users insert own booking segments"
on public.booking_segments
for insert
with check (
  exists (
    select 1
    from public.roamly_bookings booking
    where booking.id = booking_segments.booking_id
      and booking.user_id = auth.uid()
  )
);

drop policy if exists "Users update own booking segments"
  on public.booking_segments;

create policy "Users update own booking segments"
on public.booking_segments
for update
using (
  exists (
    select 1
    from public.roamly_bookings booking
    where booking.id = booking_segments.booking_id
      and booking.user_id = auth.uid()
  )
)
with check (
  exists (
    select 1
    from public.roamly_bookings booking
    where booking.id = booking_segments.booking_id
      and booking.user_id = auth.uid()
  )
);

drop policy if exists "Users delete own booking segments"
  on public.booking_segments;

create policy "Users delete own booking segments"
on public.booking_segments
for delete
using (
  exists (
    select 1
    from public.roamly_bookings booking
    where booking.id = booking_segments.booking_id
      and booking.user_id = auth.uid()
  )
);
