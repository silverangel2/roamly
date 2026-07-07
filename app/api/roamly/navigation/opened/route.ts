import { NextRequest, NextResponse } from "next/server";
import { recordTripEvent } from "@/lib/roamly/events";
import { requireUser } from "@/lib/roamly/auth";

export async function POST(request: NextRequest) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const provider = typeof body.provider === "string" ? body.provider : "map";
  const title = typeof body.destinationTitle === "string" ? body.destinationTitle : "Destination";
  const address = typeof body.destinationAddress === "string" ? body.destinationAddress : "";

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  await recordTripEvent(auth.supabase, {
    userId: auth.user.id,
    tripId,
    eventType: "navigation_opened",
    eventTitle: `Opened ${provider}`,
    eventBody: title,
    metadata: {
      provider,
      destination_title: title,
      destination_address: address
    }
  });

  return NextResponse.json({ ok: true });
}
