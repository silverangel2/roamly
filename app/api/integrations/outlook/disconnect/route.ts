import { NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { disconnectEmailConnection } from "@/lib/roamly/emailConnections";

export const runtime = "nodejs";

export async function POST() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const result = await disconnectEmailConnection({
    supabase: auth.supabase,
    userId: auth.user.id,
    provider: "outlook"
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true });
}
