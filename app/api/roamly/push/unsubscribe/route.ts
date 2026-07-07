import { NextRequest, NextResponse } from "next/server";
import { disablePushSubscription } from "@/lib/roamly/pushServer";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : undefined;

  const result = await disablePushSubscription(auth.supabase, auth.user.id, endpoint);
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
