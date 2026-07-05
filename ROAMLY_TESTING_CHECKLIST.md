# Roamly Local Testing Checklist

## Setup
- Confirm `.env.local` has Roamly Supabase, OpenAI, Stripe, and app URL values.
- Apply `supabase/migrations/20260704_roamly_schema.sql`.
- Apply `supabase/migrations/20260705_roamly_itinerary_locking.sql`.
- Run `npm run lint`, `npm run typecheck`, and `npm run build`.

## Auth
- Sign up with a new email.
- Verify email if Supabase email confirmation is enabled.
- Log in.
- Log out.
- Confirm `/dashboard`, `/account`, `/trip/[id]`, and `/trip/[id]/live` redirect when logged out.

## Free Itinerary
- New user can generate exactly one full itinerary for free.
- The free itinerary is consumed only after successful itinerary save and lock.
- Failed generation does not consume the free itinerary.
- The same user cannot generate a second free itinerary.
- Another user cannot open the first user’s trip URL.

## Locking
- Generated itinerary shows the `Locked itinerary` badge.
- Locked itinerary hides edit and regeneration controls.
- Locked itinerary shows: `This itinerary is locked. To make major changes, create a new itinerary.`
- Destination, dates, travelers, budget, interests, activities, and itinerary content cannot be edited after lock.
- Direct POST to regeneration routes returns a disabled/locked response.

## Stripe Checkout
- After free itinerary is used, a new trip requires payment before final generation.
- `Full Itinerary Unlock` uses Stripe Checkout mode `payment` for $4.99 CAD or env price ID.
- `Live Trip Tracking Add-on` uses Stripe Checkout mode `payment` for $3.99 CAD or env price ID.
- `Complete Trip Pack` uses Stripe Checkout mode `payment` for $7.99 CAD or env price ID.
- Checkout metadata includes `user_id`, `trip_id`, and `purchase_type`.
- Payment success updates only the correct trip and account.
- Payment success never regenerates an already locked itinerary.

## Bundle And Tracking
- Bundle marks the trip as paid for itinerary generation and unlocks tracking for the same trip.
- Tracking add-on unlocks tracking only for that specific locked trip.
- `/trip/[id]/live` requires both a locked itinerary and `tracking_unlocked = true`.
- Check-in, complete, skip, and activity status routes require the same locked/tracking access.

## Dashboard And Admin
- Dashboard shows free itinerary used/available, locked itineraries, draft trips, and live tracking trips.
- `/admin/trips` shows itinerary status, locked state, unlock source, payment status, tracking state, generated date, and locked date.
- `/admin/users` shows free itinerary status, paid itinerary count, tracking add-on count, and bundle count.
- Non-admin emails cannot access `/admin`.

## Mobile
- Test homepage, plan, trip page, locked itinerary page, live mode, dashboard, pricing, account, terms, privacy, and contact under 390px width.
- Confirm bottom nav does not cover primary buttons.
- Confirm cards are readable and no text clips.

## Final
- Confirm no ReviewIntel routes, table names, product IDs, or copy appear in Roamly UI except documentation references about separation.
- Confirm user-facing copy uses `itinerary`, not `IT`.
