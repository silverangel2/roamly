import { NextRequest, NextResponse } from "next/server";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    tripId?: string;
    endpoint?: string;
    keys?: { p256dh?: string; auth?: string };
  };
  const tripId = typeof body.tripId === "string" && body.tripId.trim() ? body.tripId.trim() : undefined;
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  if (!body.endpoint) return NextResponse.json({ ok: false, error: "Push endpoint is required." }, { status: 400 });

  const { data, error } = await auth.supabase.from("roamly_push_subscriptions").upsert(
    {
      user_id: auth.userId,
      endpoint: body.endpoint,
      p256dh: body.keys?.p256dh || null,
      auth: body.keys?.auth || null,
      user_agent: request.headers.get("user-agent") || null,
      enabled: true
    },
    { onConflict: "endpoint" }
  ).select("id").maybeSingle();

  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, deviceRegistered: true, subscriptionId: data?.id || null });
}
