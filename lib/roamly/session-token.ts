import type { User } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { verifyRoamlySessionToken } from "@/lib/roamly/sessionTokenCore";

export { createRoamlySessionToken, verifyRoamlySessionToken } from "@/lib/roamly/sessionTokenCore";
export type { RoamlySessionScope } from "@/lib/roamly/sessionTokenCore";

export async function getUserFromRoamlySessionToken(
  token: string | null | undefined,
  request: { method: string; path: string } | null | undefined
) {
  const payload = verifyRoamlySessionToken(token, request);
  if (!payload) return null;

  const admin = createSupabaseAdminClient();
  if (!admin) return null;

  const { data, error } = await admin.auth.admin.getUserById(payload.userId);
  if (error || !data.user) return null;
  return { user: data.user as User, supabase: admin };
}
