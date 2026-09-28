-- Atomic checkout-attempt claim for one logical Roamly purchase.
-- A pending row is the database-owned checkout attempt. Terminal rows may be
-- followed by a new attempt after Stripe marks the prior session expired.

do $$
begin
  if exists (
    select 1
    from public.roamly_itinerary_purchases
    where status = 'pending'
    group by user_id, trip_id, purchase_type
    having count(*) > 1
  ) then
    raise exception using
      errcode = '23505',
      message = 'ROAMLY_PENDING_CHECKOUT_DUPLICATES_REQUIRE_REVIEW';
  end if;
end;
$$;

create unique index if not exists roamly_itinerary_purchases_pending_identity_uidx
  on public.roamly_itinerary_purchases (user_id, trip_id, purchase_type)
  where status = 'pending';

create or replace function public.roamly_claim_checkout_attempt(
  p_user_id uuid,
  p_trip_id uuid,
  p_purchase_type text,
  p_amount_cents integer,
  p_currency text
)
returns table (
  purchase_id uuid,
  stripe_checkout_session_id text,
  purchase_status text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  paid_purchase public.roamly_itinerary_purchases%rowtype;
begin
  if p_user_id is null
     or p_trip_id is null
     or p_purchase_type not in ('itinerary_unlock', 'tracking_addon', 'bundle')
     or p_amount_cents is null
     or p_amount_cents < 0
     or p_currency is null
     or nullif(trim(p_currency), '') is null then
    raise exception using errcode = '22023', message = 'INVALID_CHECKOUT_ATTEMPT';
  end if;

  select * into paid_purchase
  from public.roamly_itinerary_purchases
  where user_id = p_user_id
    and trip_id = p_trip_id
    and purchase_type = p_purchase_type
    and status = 'paid'
  order by created_at desc
  limit 1
  for update;

  if found then
    return query select paid_purchase.id, paid_purchase.stripe_checkout_session_id, paid_purchase.status;
    return;
  end if;

  return query
    insert into public.roamly_itinerary_purchases (
      user_id,
      trip_id,
      purchase_type,
      amount_cents,
      currency,
      status
    )
    values (
      p_user_id,
      p_trip_id,
      p_purchase_type,
      p_amount_cents,
      lower(trim(p_currency)),
      'pending'
    )
    on conflict (user_id, trip_id, purchase_type) where status = 'pending'
    do update set
      user_id = public.roamly_itinerary_purchases.user_id
    returning
      id,
      stripe_checkout_session_id,
      status;
end;
$$;

revoke all on function public.roamly_claim_checkout_attempt(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.roamly_claim_checkout_attempt(uuid, uuid, text, integer, text)
  to service_role;
