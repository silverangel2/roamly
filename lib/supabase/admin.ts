import { createClient } from "@supabase/supabase-js";
import { createBoundedFetch, SUPABASE_FETCH_TIMEOUT_MS } from "@/lib/boundedFetch";
import { getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasSupabaseConfig() || !serviceRoleKey) return null;

  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    // supabase-js installs no timeout of its own: a stalled
    // connection hangs the caller forever (wiring audit
    // 2026-11-07 — a settings read through this client sat open
    // 400+ s). Every request carries the bounded fetch instead;
    // healthy calls are untouched.
    global: {
      fetch: createBoundedFetch(SUPABASE_FETCH_TIMEOUT_MS)
    }
  });
}
