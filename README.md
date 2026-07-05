# Roamly

Roamly is a separate mobile-first web app scaffolded from the ReviewIntel architecture style without touching ReviewIntel production files.

Core promise:

> Plan for free. Activate your trip when you are ready.

## Phase 1 status

This phase includes:

- Next.js App Router foundation
- TypeScript and Tailwind setup
- Mobile-first app shell
- Global theme and reusable UI components
- Required route placeholders
- Loading, error, and not-found states
- Environment variable example
- Vercel-ready build structure

This phase does not include production auth, Supabase tables, Stripe checkout, OpenAI trip generation, or live trip logic yet. Those are later phases.

## Phase status

- Phase 1: foundation complete
- Phase 2: homepage complete
- Phase 3: auth/user-system code complete
- Phase 4: Supabase schema migration file complete

Phase 4 creates the SQL setup file only. Run `supabase/migrations/20260704_roamly_schema.sql` in the Roamly Supabase project before using live auth profiles, trips, usage, payments, or admin settings.

## Separation rules

Use the same provider accounts as ReviewIntel, but keep Roamly separate:

- Separate Vercel project
- Separate GitHub repository or clean folder
- Separate Stripe product and price
- Separate Supabase project preferred
- If sharing Supabase, only use tables prefixed with `roamly_`
- Separate environment variable names

## Local commands

```bash
npm install
npm run dev
npm run build
```
