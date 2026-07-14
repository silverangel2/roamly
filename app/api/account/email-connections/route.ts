import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { data, error } = await auth.supabase
    .from("email_connections")
    .select("provider,email_address,connection_status,last_synced_at,disconnected_at,updated_at")
    .eq("user_id", auth.user.id)
    .order("provider", { ascending: true });

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, connections: data || [] });
}
