-- Booking identity lineage for proven post-confirmation replacements.
-- Additive only. No existing rows are backfilled or modified.

alter table public.roamly_bookings
  add column superseded_by_booking_id uuid;

alter table public.roamly_bookings
  add constraint roamly_bookings_owner_trip_id_uq
  unique (user_id, trip_id, id);

alter table public.roamly_bookings
  add constraint roamly_bookings_superseded_by_self_ck
  check (
    superseded_by_booking_id is null
    or (
      trip_id is not null
      and superseded_by_booking_id <> id
    )
  );

alter table public.roamly_bookings
  add constraint roamly_bookings_superseded_by_fkey
  foreign key (user_id, trip_id, superseded_by_booking_id)
  references public.roamly_bookings (user_id, trip_id, id)
  on delete no action
  deferrable initially deferred;

-- The existing trip_id ON DELETE CASCADE can remove an entire owned trip
-- lineage in one transaction, while an individual successor delete remains
-- blocked when a predecessor still points at it.

create function public.roamly_guard_booking_supersession()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.role() <> 'service_role' then
    if tg_op = 'INSERT'
      and new.superseded_by_booking_id is not null then
      raise exception 'Booking supersession must use a trusted server boundary.'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE'
      and new.superseded_by_booking_id is distinct from old.superseded_by_booking_id then
      raise exception 'Booking supersession must use a trusted server boundary.'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger roamly_bookings_supersession_guard
before insert or update of superseded_by_booking_id on public.roamly_bookings
for each row execute function public.roamly_guard_booking_supersession();

grant all privileges on table public.roamly_bookings to service_role;
