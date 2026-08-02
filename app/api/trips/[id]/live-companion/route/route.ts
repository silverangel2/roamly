import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getLiveRouteStatus } from "@/lib/roamly/liveRouting";
import { getTripBundle } from "@/lib/trips";
import type { LiveCompanionActivity, LiveCoordinates } from "@/lib/roamly/liveCompanion";

type RouteContext = {
  params: Promise<{ id: string }>;
};

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function cleanString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const { id } = await context.params;
  const bundle = await getTripBundle(auth.supabase, auth.user.id, id);
  if (!bundle.data) {
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const originLatitude = numberValue(body.originLatitude);
  const originLongitude = numberValue(body.originLongitude);
  const destinationLatitude = numberValue(body.destinationLatitude);
  const destinationLongitude = numberValue(body.destinationLongitude);
  const destinationTitle = cleanString(body.destinationTitle) || "Next stop";
  const mode =
    body.mode === "transit" || body.mode === "driving" || body.mode === "rideshare"
      ? body.mode
      : "walking";

  const origin: LiveCoordinates | null =
    originLatitude == null || originLongitude == null
      ? null
      : {
          latitude: originLatitude,
          longitude: originLongitude,
          accuracy: numberValue(body.accuracy)
        };
  const destination: LiveCompanionActivity = {
    id: cleanString(body.destinationId) || "next",
    title: destinationTitle,
    address: cleanString(body.destinationAddress),
    placeName: cleanString(body.destinationPlaceName),
    latitude: destinationLatitude,
    longitude: destinationLongitude
  };

  const route = await getLiveRouteStatus({
    origin,
    destination,
    mode
  });

  return NextResponse.json({
    ok: true,
    route
  });
}
