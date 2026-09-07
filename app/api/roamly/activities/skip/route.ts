import { NextRequest, NextResponse } from "next/server";
import { normalizeCoordinates } from "@/lib/roamly/location";
import { performActivityAction } from "@/lib/roamly/activityActions";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { requireUserOrFieldTest } from "@/lib/roamly/fieldTestAccess";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const activityId = typeof body.activityId === "string" ? body.activityId : "";
  const tripId = typeof body.tripId === "string" ? body.tripId : "";
  const auth = await requireUserOrFieldTest(tripId);
  if (!auth.ok) return auth.response;
  const location = normalizeCoordinates({
    latitude: body.latitude as number,
    longitude: body.longitude as number
  });
  const access = auth.fieldTest ? { hasQaAccess: true } : getRoamlyAccessForUser(auth.userEmail);
  const simulated = body.simulated === true && access.hasQaAccess;

  if (!activityId || !tripId) {
    return NextResponse.json({ ok: false, error: "Activity and trip are required." }, { status: 400 });
  }

  const result = await performActivityAction(auth.supabase, {
    userId: auth.userId,
    userEmail: auth.userEmail,
    tripId,
    activityId,
    action: "skip",
    location,
    source: simulated ? "tester_location_simulator" : "user_skip",
    simulated
  });

  if (!result.ok) return NextResponse.json({ ok: false, error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, activity: result.activity, upNextActivity: result.upNextActivity });
}
