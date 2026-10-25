-- S3 (Roamly production incident, 2026-10-25) — booking_segments RLS repair.
--
-- LIVE EVIDENCE (tester account only, labeled test data):
--   * Direct RPC roamly_replace_booking_segments (tester JWT, tester-owned
--     booking) returned segment_count 1 / 2 — the SECURITY DEFINER function
--     inserted rows.
--   * The immediate direct PostgREST select on booking_segments for the same
--     booking returned 200 with [] — and the app GET list embed returned []
--     too — while the app POST returned 200 with legs echoed from memory.
--   * A direct PostgREST insert into booking_segments returned 403
--     "new row violates row-level security policy".
--   * The live table carries NONE of the wallet-era constraints (sequence > 0
--     check, status check, booking+sequence unique index all absent — a
--     sequence-0, bogus-status, and duplicate-sequence RPC all returned
--     count), i.e. the table shape is the canonical one, but its RLS
--     policies do not recognize roamly_bookings ownership: RLS is enabled
--     with no passing SELECT/INSERT policy for the owner, so every owner
--     read is empty and every owner insert is denied, while the
--     SECURITY DEFINER RPC keeps storing rows invisibly.
--   * public.trip_bookings does not exist live (PostgREST PGRST205), so the
--     wallet-era policies that joined trip_bookings cannot be the live
--     policy set; whatever live policies exist, they do not join
--     roamly_bookings. The canonical migration's roamly_bookings-join
--     policies are therefore (re)created here, forward-only.
--
-- NOT APPLIED BY THIS CHANGE. This file is part of the coordinator's
-- consolidated approval packet: it lands only on Junel's tap, together with
-- the bookingWallet fail-loud guard (which turns today's silent 200 into a
-- loud 400 until this repair is applied — the guard + this repair are one
-- fix, neither half alone). Post-apply proof (no new write needed): the
-- direct booking_segments select for the S3 probe booking
-- c53e5378-3653-49ed-9526-7a18d86d6cc4 must show the 2 legs the RPC
-- already stored, and the app GET list must show the same 2 legs.
--
-- Idempotent: every policy is dropped by name first, then created. The
-- legacy wallet-era policy names are dropped too (harmless if absent).
-- Ownership rule is unchanged from the canonical migration: a caller sees
-- or writes only segments of bookings they own. No service_role widening:
-- the RPC paths keep their own ACLs (20261014 / 20261024 migrations).

alter table public.booking_segments enable row level security;

drop policy if exists "Users read own booking segments"
  on public.booking_segments;
drop policy if exists "Users insert own booking segments"
  on public.booking_segments;
drop policy if exists "Users update own booking segments"
  on public.booking_segments;
drop policy if exists "Users delete own booking segments"
  on public.booking_segments;
drop policy if exists "Roamly users read own booking segments"
  on public.booking_segments;
drop policy if exists "Roamly users create own booking segments"
  on public.booking_segments;
drop policy if exists "Roamly users update own booking segments"
  on public.booking_segments;
drop policy if exists "Roamly users delete own booking segments"
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
