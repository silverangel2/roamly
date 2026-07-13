import { NextRequest, NextResponse } from "next/server";
import { translateRoamlyItinerary, RoamlyItineraryGenerationError } from "@/lib/ai/roamly-itinerary";
import { getRequestLocale } from "@/lib/i18n-server";
import { requireUser } from "@/lib/roamly/auth";
import {
  getStoredItineraryTranslation,
  getTripItineraryLanguage,
  withStoredItineraryTranslation
} from "@/lib/roamly/itineraryTranslations";
import { getTripBundle, isMissingTableError } from "@/lib/trips";

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const auth = await requireUser();
  if (!auth.ok) return auth.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const language = getRequestLocale(request, getString(body.language));

  const bundleResult = await getTripBundle(auth.supabase, auth.user.id, id);
  if (!bundleResult.data) {
    if (isMissingTableError(bundleResult.error)) {
      return NextResponse.json({ ok: false, error: "Trip tables are not ready." }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: "Trip not found." }, { status: 404 });
  }

  const { trip, itinerary } = bundleResult.data;
  const full = itinerary?.full_json;
  if (!full) {
    return NextResponse.json({ ok: false, error: "Generate and lock this itinerary before translating it." }, { status: 400 });
  }

  const sourceLanguage = getTripItineraryLanguage(trip.metadata);
  if (language === sourceLanguage) {
    return NextResponse.json({ ok: true, language, alreadySourceLanguage: true });
  }

  const existing = getStoredItineraryTranslation(trip.metadata, language);
  if (existing) {
    return NextResponse.json({ ok: true, language, alreadyTranslated: true });
  }

  try {
    const translated = await translateRoamlyItinerary({
      itinerary: full,
      language,
      sourceLanguage
    });
    const metadata = withStoredItineraryTranslation({
      metadata: trip.metadata,
      locale: language,
      sourceLanguage,
      itinerary: translated
    });
    const { error } = await auth.supabase
      .from("roamly_trips")
      .update({ metadata })
      .eq("id", id)
      .eq("user_id", auth.user.id);

    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    return NextResponse.json({ ok: true, language });
  } catch (error) {
    const generationError =
      error instanceof RoamlyItineraryGenerationError
        ? error
        : new RoamlyItineraryGenerationError(
            "Roamly could not translate this itinerary. Please try again in a moment.",
            "AI_TRANSLATION_FAILED",
            502
          );
    return NextResponse.json(
      {
        ok: false,
        error: generationError.code,
        message: generationError.message
      },
      { status: generationError.status }
    );
  }
}
