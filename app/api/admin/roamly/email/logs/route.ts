import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("roamly_email_logs")
    .select("id,to_email,subject,provider,status,provider_message_id,error,created_at,sent_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, logs: data || [] });
}
