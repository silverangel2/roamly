import { createSupabaseAdminClient } from "@/lib/supabase/admin";

// Site maintenance mode lives in the existing key/value admin settings
// table (roamly_admin_settings — the same store the Finds promo uses), so
// flipping it is a data change, never a redeploy. The middleware gate reads
// the same row through lib/roamly/maintenanceGate.ts with a short cache and
// fails OPEN (normal site) whenever the read fails.
export const MAINTENANCE_SETTING_KEY = "site_maintenance";

export type MaintenanceModeState = {
  enabled: boolean;
  updatedAt: string | null;
  configured: boolean;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

export function normalizeMaintenanceModeValue(value: unknown): { enabled: boolean; updatedAt: string | null } {
  const raw = record(value);
  return {
    enabled: raw.enabled === true,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : null
  };
}

export async function readMaintenanceMode(): Promise<MaintenanceModeState> {
  const admin = createSupabaseAdminClient();
  if (!admin) return { enabled: false, updatedAt: null, configured: false };
  const { data, error } = await admin
    .from("roamly_admin_settings")
    .select("value,updated_at")
    .eq("key", MAINTENANCE_SETTING_KEY)
    .maybeSingle();
  if (error || !data) return { enabled: false, updatedAt: null, configured: false };
  const normalized = normalizeMaintenanceModeValue(data.value);
  return {
    enabled: normalized.enabled,
    updatedAt: normalized.updatedAt || (typeof data.updated_at === "string" ? data.updated_at : null),
    configured: true
  };
}

export async function setMaintenanceMode(enabled: boolean): Promise<MaintenanceModeState> {
  const admin = createSupabaseAdminClient();
  if (!admin) throw new Error("SUPABASE_SERVICE_ROLE_MISSING");
  const updatedAt = new Date().toISOString();
  const { data, error } = await admin
    .from("roamly_admin_settings")
    .upsert({ key: MAINTENANCE_SETTING_KEY, value: { enabled, updatedAt } }, { onConflict: "key" })
    .select("value,updated_at")
    .single();
  if (error) throw new Error(error.message);
  const normalized = normalizeMaintenanceModeValue(data?.value);
  return { enabled: normalized.enabled, updatedAt: normalized.updatedAt || updatedAt, configured: true };
}
