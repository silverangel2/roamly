-- Correct the applied checkout-attempt claim function without changing its
-- signature, return contract, validation, or atomic pending-attempt semantics.
-- The original function's unqualified RETURNING columns collide with its
-- PL/pgSQL RETURNS TABLE output variable named stripe_checkout_session_id.

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

  select p.* into paid_purchase
  from public.roamly_itinerary_purchases as p
  where p.user_id = p_user_id
    and p.trip_id = p_trip_id
    and p.purchase_type = p_purchase_type
    and p.status = 'paid'
  order by p.created_at desc
  limit 1
  for update;

  if found then
    return query select paid_purchase.id, paid_purchase.stripe_checkout_session_id, paid_purchase.status;
    return;
  end if;

  return query
    insert into public.roamly_itinerary_purchases as target (
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
      user_id = target.user_id
    returning
      target.id,
      target.stripe_checkout_session_id,
      target.status;
end;
$$;

revoke all on function public.roamly_claim_checkout_attempt(uuid, uuid, text, integer, text)
  from public, anon, authenticated;
grant execute on function public.roamly_claim_checkout_attempt(uuid, uuid, text, integer, text)
  to service_role;
