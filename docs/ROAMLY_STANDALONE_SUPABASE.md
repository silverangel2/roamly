# Roamly Standalone Supabase Setup

Roamly must use its own Supabase project. Do not run these steps against the old shared ReviewIntel project.

## 1. Create the Supabase project

1. In Supabase, create a new project for Roamly.
2. Open **Project Settings > API**.
3. Copy the Project URL:
   `https://ikrfkpnbtkdohoxnbphu.supabase.co`
4. Copy the publishable or anon public key.
5. Copy the secret or service role key.
6. Do not paste secret keys into code, docs, screenshots, commits, or support messages.

## 2. Update Vercel environment variables

In the Roamly Vercel project, set these variables for Production, Preview, and Development as needed:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://ikrfkpnbtkdohoxnbphu.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=<publishable-or-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<secret-or-service-role-key>
NEXT_PUBLIC_APP_URL=https://roamlyhq.com
```

Keep the existing Stripe price IDs and payment variables unchanged.

## 3. Configure Supabase Auth URLs

In Supabase, open **Authentication > URL Configuration**.

Set **Site URL** to:

```text
https://roamlyhq.com
```

Add these redirect URLs:

```text
https://roamlyhq.com/auth/callback
https://www.roamlyhq.com/auth/callback
http://localhost:3000/auth/callback
```

Add any Vercel preview callback URLs only if preview login is required.

## 4. Enable Google login

In Supabase, open **Authentication > Providers > Google**.

1. Enable Google.
2. Add the Google OAuth client ID.
3. Add the Google OAuth client secret.
4. In Google Cloud Console, add Supabase's Google callback URL shown in the provider setup screen.
5. Save the provider settings.

## 5. Run the Roamly schema

In the Roamly Supabase project SQL Editor, run:

```text
supabase/roamly-full-production-schema.sql
```

This creates the full standalone `public.roamly_*` schema. It is safe to run more than once. It does not modify ReviewIntel tables.

## 6. Verify the schema

From the Roamly repo, run the verification script with the Roamly Supabase URL and service role key in the shell environment:

```bash
export NEXT_PUBLIC_SUPABASE_URL="https://ikrfkpnbtkdohoxnbphu.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<secret-or-service-role-key>"
node scripts/check-roamly-standalone-supabase.mjs
```

Expected result:

```text
Roamly standalone Supabase schema is ready at ikrfkpnbtkdohoxnbphu.supabase.co.
```

If it prints missing tables or columns, rerun `supabase/roamly-full-production-schema.sql` in the Roamly Supabase project and run the verifier again.

## 7. Redeploy Vercel

After the environment variables are set and the schema verifies:

1. Redeploy the Roamly production deployment in Vercel.
2. Confirm the deployed environment uses `https://ikrfkpnbtkdohoxnbphu.supabase.co`.

## 8. Smoke test production

1. Open `https://roamlyhq.com`.
2. Sign up or log in with Google.
3. Confirm a `roamly_profiles` row is created.
4. Generate a draft itinerary.
5. Confirm rows are created in `roamly_trips`, `roamly_trip_days`, `roamly_activities`, `roamly_itineraries`, `roamly_itinerary_days`, and `roamly_trip_activities`.
6. Test itinerary generation through completion.
7. Confirm no ReviewIntel Supabase project activity is involved.
