# Roamly Supabase Setup

Roamly should use its own Supabase project when possible. If it shares a Supabase project with another app, only run Roamly SQL that creates `roamly_` prefixed tables.

## Phase 4 Migration

Run:

```sql
supabase/migrations/20260704_roamly_schema.sql
```

It creates:

- `roamly_profiles`
- `roamly_trips`
- `roamly_itineraries`
- `roamly_itinerary_days`
- `roamly_trip_activities`
- `roamly_trip_checklists`
- `roamly_trip_usage`
- `roamly_trip_payments`
- `roamly_admin_settings`

## Security

Row-level security is enabled on every Roamly table.

Authenticated users can only access their own profiles, trips, itinerary data, checklist items, usage rows, and payment history. Admin writes should happen through server-side admin routes using `SUPABASE_SERVICE_ROLE_KEY`.

Do not modify or delete ReviewIntel tables from this project.
