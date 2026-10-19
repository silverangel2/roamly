# Sophie travel research intake

Status: staged implementation; not deployed. The booking-proven traveler library and existing customer itineraries remain untouched.

POST /api/command/contributions accepts hotel/activity/flight research with a source URL, recent observedAt timestamp, destination, reason and optional dated price/party context. It uses existing Bearer SOPHIE_COMMAND_KEY authentication. UNKNOWN price stays null; quoted prices remain ESTIMATED. No server independent source verification, live availability or booking proof is claimed. Source URLs are stored, never fetched by this endpoint. Real flight/hotel availability needs provider verification at use time.

GET /api/command/contributions lists pending/accepted/rejected research. /admin/sophie-contributions provides a review screen using existing Roamly admin access. Accepted candidates are available in a private reviewed-research collection at GET /api/command/library?destination=...; this is not the traveler experience library and is not automatically inserted into itineraries. The latest 30 accepted records are searched. No personal traveler data or bookings are exported to Sophie.

Apply only the reviewed 20261019000100_sophie_contributions.sql migration in staging first. No bulk migration push/reset/repair. RLS, service-only grants, content-fingerprint idempotency, conditional pending-only review and an atomic 50-pending intake cap are included. Existing customer workflows do not wait for Sophie. Customer traffic is not forwarded as iMac inference tasks.

No paid AI API, scraper, booking, email or deployment runs. All accept/reject decisions require an existing site-admin session and a review note. Acceptance records human review, not factual verification of every claim or travel availability. Live publishing and integrating approved candidates into the itinerary engine remain separate reviewed work.

Node 24 checks: node --test tests/sophieContributions.test.mjs tests/sophieRoutes.test.mjs
These exercise real validators and routes against isolated auth/storage doubles; no live service writes. Full application typecheck/build and real database migration execution remain unverified; dependency installation was not completed. Real auth and SQL behavior must pass staging checks before production.
