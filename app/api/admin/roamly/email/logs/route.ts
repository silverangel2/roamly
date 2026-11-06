import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { listHeldCompanionEmailClaims } from "@/lib/roamly/heldEmailClaims";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("roamly_email_logs")
    .select("id,to_email,subject,provider,status,provider_message_id,error,last_error,template,attempt_count,trip_id,created_at,sent_at,idempotency_key,metadata")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  // Held/ambiguous companion-email claims (read-only visibility): the log
  // rows alone cannot show them — a held claim may have no log row at all.
  const heldClaims = await listHeldCompanionEmailClaims(guard.admin);
  return NextResponse.json({ ok: true, logs: data || [], heldClaims });
}
