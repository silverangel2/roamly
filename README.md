# Roamly

Roamly is a mobile-first trip planning and travel companion app. It runs as a separate product from ReviewIntel, with its own GitHub repository, Vercel project, Stripe catalog, and Supabase project.

Product promise:

> Plan for free. Activate your trip when you are ready.

## Current product

The application has moved beyond the original scaffold. Current product areas include:

- Account authentication and traveler profiles
- Free and paid trip itinerary generation
- Budget-aware, booking-aware planning and customer trip changes
- Itinerary, booking, and trip timeline management
- Live Trip Companion reminders and in-trip tools
- Trip feedback and privacy-bounded traveler memory
- Stripe one-time purchases and activation
- Protected scheduled jobs for generation and trip operations

See `app/`, `lib/roamly/`, and `supabase/migrations/` for the implemented surfaces and current database contracts.

## Production and database safety

- Production Supabase changes use reviewed migrations and their matching pre- and post-checks in `supabase/checks/`.
- Confirm production state before applying a migration. Apply each migration only once; do not rely on a migration-history table unless its existence has been verified.
- Compare the local migration SHA with the approved value before manually applying it in Supabase SQL Editor.
- Never stage unrelated work with broad Git commands. Stage only the files belonging to the release.
- Keep service-role credentials server-side. Never expose secrets in client code, logs, or documentation.

Some public-schema tables are product-specific but do not use a `roamly_` prefix, including `trip_feedback`, `traveler_profiles`, and `traveler_preference_events`. Treat the current migrations, RLS policies, and production checks as authoritative; do not infer isolation from table names alone.

Airalo remains disabled and unapproved.

## Local commands

```bash
npm install
npm run dev
npm run build
```
