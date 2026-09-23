import { NextRequest, NextResponse } from "next/server";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";
import { isValidPushKey, normalizePushEndpoint } from "@/lib/roamly/pushEndpoint";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    tripId?: string;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const tripId = typeof body.tripId === "string" && body.tripId.trim() ? body.tripId.trim() : undefined;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  const endpoint = normalizePushEndpoint(body.endpoint);
  if (!endpoint) return NextResponse.json({ ok: false, error: "Push endpoint is invalid or unsupported." }, { status: 400 });
  const p256dh = body.keys?.p256dh;
  const authKey = body.keys?.auth;
  if (!isValidPushKey(p256dh, "p256dh") || !isValidPushKey(authKey, "auth")) {
    return NextResponse.json({ ok: false, error: "Push subscription keys are invalid." }, { status: 400 });
  }

  // A field-test session is scoped to its controlled trip. A normal account
  // may only register a subscription while viewing one of its own trips.
  if (tripId) {
    const { data: trip } = await auth.supabase
      .from("roamly_trips")
      .select("id")
      .eq("id", tripId)
      .eq("user_id", auth.userId)
      .maybeSingle();
    if (!trip) return NextResponse.json({ ok: false, error: "Trip access denied." }, { status: 403 });
  }

  const { data: existing, error: existingError } = await auth.supabase
    .from("roamly_push_subscriptions")
    .select("id,user_id")
    .eq("endpoint", endpoint)
    .maybeSingle();
  if (existingError) return NextResponse.json({ ok: false, error: existingError.message }, { status: 500 });
  if (existing && existing.user_id !== auth.userId) {
    return NextResponse.json({ ok: false, error: "This push device is registered to another account." }, { status: 409 });
  }

  const { data, error } = await auth.supabase.from("roamly_push_subscriptions").upsert(
    {
      user_id: auth.userId,
      trip_id: tripId || null,
      endpoint,
      p256dh,
      auth: authKey,
      user_agent: request.headers.get("user-agent") || null,
      enabled: true
    },
    { onConflict: "endpoint" }
  ).select("id").maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  if (!data?.id) return NextResponse.json({ ok: false, error: "Push subscription was not persisted." }, { status: 500 });
  return NextResponse.json({ ok: true, deviceRegistered: true, subscriptionId: data.id });
}

export async function GET(request: NextRequest) {
  const tripId = request.nextUrl.searchParams.get("tripId") || undefined;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  const endpoint = request.nextUrl.searchParams.get("endpoint") || "";
  if (!endpoint) return NextResponse.json({ ok: true, deviceRegistered: false });
  const query = auth.supabase
    .from("roamly_push_subscriptions")
    .select("id")
    .eq("user_id", auth.userId)
    .eq("endpoint", endpoint)
    .eq("enabled", true);
  const { data, error } = await query.maybeSingle();
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deviceRegistered: Boolean(data?.id), subscriptionId: data?.id || null });
}
