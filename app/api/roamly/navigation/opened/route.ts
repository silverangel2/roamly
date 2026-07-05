import { NextRequest, NextResponse } from "next/server";
import { recordTripEvent } from "@/lib/roamly/events";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data, error: userError } = await supabase.auth.getUser();
  if (userError || !data.user) return NextResponse.json({ ok: false, error: "Login required." }, { status: 401 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const provider = typeof body.provider === "string" ? body.provider : "map";
  const title = typeof body.destinationTitle === "string" ? body.destinationTitle : "Destination";
  const address = typeof body.destinationAddress === "string" ? body.destinationAddress : "";

  if (!tripId) return NextResponse.json({ ok: false, error: "Trip is required." }, { status: 400 });

  await recordTripEvent(supabase, {
    userId: data.user.id,
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
