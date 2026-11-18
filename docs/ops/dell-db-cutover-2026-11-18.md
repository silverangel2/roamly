# Dell database cutover — 2026-11-18

Roamly's database moved from Supabase cloud (Pro) to the self-hosted
Supabase stack on the Dell at home, reached at
https://db.roamly-translate.com (Cloudflare Tunnel "roamly-translator",
public hostname db.roamly-translate.com -> http://localhost:8000).

Production environment variables changed in Vercel (Production only):
- NEXT_PUBLIC_SUPABASE_URL -> https://db.roamly-translate.com
- SUPABASE_URL -> https://db.roamly-translate.com
- NEXT_PUBLIC_SUPABASE_ANON_KEY -> Dell stack anon key
- SUPABASE_SERVICE_ROLE_KEY -> Dell stack service role key

Verified before the flip: /auth/v1/health 200 and the CORS preflight
for https://roamlyhq.com 200 over the public hostname.

This commit changes no code. Its purpose is to trigger the production
redeploy so the live app picks up the new database connection.
