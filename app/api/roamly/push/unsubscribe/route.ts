import { NextRequest, NextResponse } from "next/server";
import { disablePushSubscription } from "@/lib/roamly/pushServer";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint.trim() : "";
  const tripId = typeof body.tripId === "string" ? body.tripId : undefined;

  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  if (auth.fieldTest && !tripId) {
    return NextResponse.json({ ok: false, error: "Field-test trip context is required." }, { status: 400 });
  }
  if (!endpoint) return NextResponse.json({ ok: false, error: "Push subscription endpoint is required." }, { status: 400 });
  const result = await disablePushSubscription(auth.supabase, auth.userId, endpoint);
  if (result.error) return NextResponse.json({ ok: false, error: result.error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
