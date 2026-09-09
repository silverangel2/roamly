import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function recordNotificationSchedulerSuccess(params: { supabase?: SupabaseClient | null } = {}) {
  const db = createSupabaseAdminClient() || params.supabase || null;
  if (!db) return false;
  try {
    const result = await db.rpc("roamly_record_notification_scheduler_success");
    return !result.error && result.data === true;
  } catch {
    return false;
  }
}
