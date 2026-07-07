import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getRoamlyAdminEmails, requireAdmin } from "@/lib/roamly/auth";
import { getCurrentUser } from "@/lib/supabase/server";

export async function requireRoamlyAdmin() {
  const guard = await requireAdmin("/admin");
  if (!guard.ok) return { ok: false as const, response: guard.response };
  return { ok: true as const, user: guard.user, admin: guard.admin };
}

export async function getRoamlyAdminPageState() {
  const current = await getCurrentUser();
  const adminEmails = getRoamlyAdminEmails();
  const email = (current.user?.email || "").toLowerCase();
  const admin = createSupabaseAdminClient();

  return {
    configured: current.configured,
    user: current.user,
    isAdmin: Boolean(current.user && adminEmails.includes(email)),
    admin,
    missingAdminEmail: !adminEmails.length
  };
}
