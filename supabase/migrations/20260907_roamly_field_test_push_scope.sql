-- Associate a field-test push registration with its prepared trip so Admin
-- diagnostics can target that physical phone without broadcasting to an account.
alter table public.roamly_push_subscriptions
  add column if not exists trip_id uuid references public.roamly_trips(id) on delete cascade;

create index if not exists roamly_push_subscriptions_trip_idx
  on public.roamly_push_subscriptions (trip_id, enabled);
