import { buildPreviewFromItinerary, type RoamlyItinerary, type RoamlyPreview } from "@/lib/itinerary";
import { normalizeLocale, type RoamlyLocale } from "@/lib/i18n";
import { getTripPlanningMetadata } from "@/lib/roamly/tripMetadata";

export type StoredItineraryTranslation = {
  language: RoamlyLocale;
  source_language: RoamlyLocale;
  full_json: RoamlyItinerary;
  preview_json: RoamlyPreview;
  updated_at: string;
};

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getTranslations(metadata: unknown) {
  const root = getRecord(metadata);
  return getRecord(root?.itineraryTranslations) || {};
}

export function getTripItineraryLanguage(metadata: unknown): RoamlyLocale {
  const root = getRecord(metadata);
  const planning = getTripPlanningMetadata(metadata);
  const generated = getRecord(root?.generatedItinerary);
  return normalizeLocale(
    (typeof generated?.language === "string" && generated.language) ||
      (typeof planning.language === "string" && planning.language) ||
      "en"
  );
}

export function getStoredItineraryTranslation(
  metadata: unknown,
  locale: RoamlyLocale
): StoredItineraryTranslation | null {
  const stored = getRecord(getTranslations(metadata)[locale]);
  const full = getRecord(stored?.full_json);
  if (!full) return null;
  const preview = getRecord(stored?.preview_json);
  return {
    language: normalizeLocale(typeof stored?.language === "string" ? stored.language : locale),
    source_language: normalizeLocale(typeof stored?.source_language === "string" ? stored.source_language : "en"),
    full_json: full as unknown as RoamlyItinerary,
    preview_json: preview ? (preview as unknown as RoamlyPreview) : buildPreviewFromItinerary(full as unknown as RoamlyItinerary),
    updated_at: typeof stored?.updated_at === "string" ? stored.updated_at : ""
  };
}

export function getLocalizedItinerary(params: {
  metadata: unknown;
  baseItinerary: RoamlyItinerary;
  locale: RoamlyLocale;
}) {
  const sourceLanguage = getTripItineraryLanguage(params.metadata);
  const translated = getStoredItineraryTranslation(params.metadata, params.locale);
  if (translated) {
    return {
      itinerary: translated.full_json,
      preview: translated.preview_json,
      language: translated.language,
      sourceLanguage,
      translated: true
    };
  }

  return {
    itinerary: params.baseItinerary,
    preview: buildPreviewFromItinerary(params.baseItinerary),
    language: sourceLanguage,
    sourceLanguage,
    translated: false
  };
}

export function withStoredItineraryTranslation(params: {
  metadata: unknown;
  locale: RoamlyLocale;
  sourceLanguage: RoamlyLocale;
  itinerary: RoamlyItinerary;
}) {
  const root = getRecord(params.metadata) || {};
  return {
    ...root,
    itineraryTranslations: {
      ...getTranslations(root),
      [params.locale]: {
        language: params.locale,
        source_language: params.sourceLanguage,
        full_json: params.itinerary,
        preview_json: buildPreviewFromItinerary(params.itinerary),
        updated_at: new Date().toISOString()
      }
    }
  };
}
