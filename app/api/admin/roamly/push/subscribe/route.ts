import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as {
    tripId?: string;
    endpoint?: string;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  };

  if (!body.tripId || !body.endpoint) {
    return NextResponse.json(
      { ok: false, error: "QA trip and push endpoint are required." },
      { status: 400 }
    );
  }

  const { data: trip, error: tripError } = await guard.admin
    .from("roamly_trips")
    .select("id,user_id,metadata")
    .eq("id", body.tripId)
    .single();

  if (tripError || !trip) {
    return NextResponse.json(
      { ok: false, error: "QA trip was not found." },
      { status: 404 }
    );
  }

  const metadata =
    trip.metadata && typeof trip.metadata === "object"
      ? (trip.metadata as Record<string, unknown>)
      : {};

  if (metadata.admin_test !== true) {
    return NextResponse.json(
      {
        ok: false,
        error: "Push QA registration is restricted to controlled admin_test trips."
      },
      { status: 403 }
    );
  }

  const { error } = await guard.admin
    .from("roamly_push_subscriptions")
    .upsert(
      {
        user_id: trip.user_id,
        endpoint: body.endpoint,
        p256dh: body.keys?.p256dh || null,
        auth: body.keys?.auth || null,
        user_agent: request.headers.get("user-agent") || null,
        enabled: true
      },
      { onConflict: "endpoint" }
    );

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    ok: true,
    tripId: trip.id
  });
}
