import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/roamly/auth";
import { getTripFeedback, submitTripFeedback } from "@/lib/roamly/tripFeedback";

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringRecord(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(record(value))
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([key, entryValue]) => [key, entryValue.trim()])
      .filter(([, entryValue]) => entryValue)
  );
}

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function GET(_request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;

  const result = await getTripFeedback({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id
  });
  if (result.error) return NextResponse.json({ ok: false, error: result.error }, { status: 500 });

  return NextResponse.json({ ok: true, feedback: result.feedback });
}

export async function POST(request: NextRequest, context: RouteContext) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  const body = record(await request.json().catch(() => ({})));

  const result = await submitTripFeedback({
    supabase: auth.supabase,
    userId: auth.user.id,
    tripId: id,
    input: {
      feedbackType: body.feedbackType === "in_trip" ? "in_trip" : "post_trip",
      tripDay: typeof body.tripDay === "number" ? body.tripDay : null,
      overallSatisfaction: typeof body.overallSatisfaction === "number" ? body.overallSatisfaction : null,
      itineraryPace: typeof body.itineraryPace === "string" ? body.itineraryPace : null,
      transportationSatisfaction: typeof body.transportationSatisfaction === "number" ? body.transportationSatisfaction : null,
      hotelLocationSatisfaction: typeof body.hotelLocationSatisfaction === "number" ? body.hotelLocationSatisfaction : null,
      hotelQualitySatisfaction: typeof body.hotelQualitySatisfaction === "number" ? body.hotelQualitySatisfaction : null,
      budgetAccuracy: typeof body.budgetAccuracy === "number" ? body.budgetAccuracy : null,
      scheduleRealism: typeof body.scheduleRealism === "number" ? body.scheduleRealism : null,
      favouriteActivities: Array.isArray(body.favouriteActivities) ? (body.favouriteActivities as string[]) : [],
      disappointingActivities: Array.isArray(body.disappointingActivities) ? (body.disappointingActivities as string[]) : [],
      skippedActivities: Array.isArray(body.skippedActivities) ? (body.skippedActivities as string[]) : [],
      reasonsForSkipping: stringRecord(body.reasonsForSkipping),
      wouldUseRoamlyAgain: typeof body.wouldUseRoamlyAgain === "boolean" ? body.wouldUseRoamlyAgain : null,
      freeTextFeedback: typeof body.freeTextFeedback === "string" ? body.freeTextFeedback : null,
      todayPace: typeof body.todayPace === "string" ? body.todayPace : null,
      transportationDifficult: typeof body.transportationDifficult === "boolean" ? body.transportationDifficult : null,
      adjustTomorrow: typeof body.adjustTomorrow === "boolean" ? body.adjustTomorrow : null,
      recommendationUsefulness: typeof body.recommendationUsefulness === "number" ? body.recommendationUsefulness : null
    }
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.error === "TRIP_NOT_FOUND" ? 404 : 400 });
  }

  return NextResponse.json({
    ok: true,
    feedback: result.feedback,
    proposedPreferences: result.proposedPreferences,
    message: result.message
  });
}
