import { createClient } from "@supabase/supabase-js";
import { getSupabaseUrl, hasSupabaseConfig } from "@/lib/supabase/config";

export function createSupabaseAdminClient() {
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!hasSupabaseConfig() || !serviceRoleKey) return null;

  return createClient(getSupabaseUrl(), serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
