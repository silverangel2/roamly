import { NextRequest, NextResponse } from "next/server";
import { localPlaceSearch, normalizePlaceText, recommendedPlaces, type NormalizedPlace } from "@/lib/roamly/places";

type GooglePrediction = {
  description?: string;
  place_id?: string;
  terms?: Array<{ value?: string }>;
};

type GoogleDetails = {
  formatted_address?: string;
  geometry?: {
    location?: {
      lat?: number;
      lng?: number;
    };
  };
  address_components?: Array<{
    long_name?: string;
    types?: string[];
  }>;
};

function googleKey() {
  return process.env.GOOGLE_MAPS_API_KEY || "";
}

function providerEnabled() {
  const provider = (process.env.ROAMLY_PLACES_PROVIDER || "google").toLowerCase();
  return provider === "google" && Boolean(googleKey());
}

function component(details: GoogleDetails | null, type: string) {
  return details?.address_components?.find((item) => item.types?.includes(type))?.long_name;
}

function fromGooglePrediction(prediction: GooglePrediction, details: GoogleDetails | null): NormalizedPlace | null {
  const label = normalizePlaceText(prediction.description || "");
  const placeId = prediction.place_id;
  if (!label || !placeId) return null;

  const terms = prediction.terms?.map((term) => normalizePlaceText(term.value || "")).filter(Boolean) || [];
  const lat = details?.geometry?.location?.lat;
  const lng = details?.geometry?.location?.lng;

  return {
    label,
    value: label,
    city: component(details, "locality") || component(details, "postal_town") || terms[0],
    region: component(details, "administrative_area_level_1") || (terms.length > 2 ? terms[terms.length - 2] : undefined),
    country: component(details, "country") || terms[terms.length - 1],
    place_id: placeId,
    latitude: typeof lat === "number" ? lat : undefined,
    longitude: typeof lng === "number" ? lng : undefined,
    formatted_address: details?.formatted_address || label,
    source: "google"
  };
}

async function getGoogleDetails(placeId: string, key: string) {
  const url = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  url.searchParams.set("place_id", placeId);
  url.searchParams.set("fields", "address_components,formatted_address,geometry");
  url.searchParams.set("key", key);

  const response = await fetch(url, { next: { revalidate: 86_400 } });
  if (!response.ok) return null;

  const data = (await response.json().catch(() => null)) as { result?: GoogleDetails; status?: string } | null;
  return data?.status === "OK" && data.result ? data.result : null;
}

async function googleAutocomplete(query: string) {
  const key = googleKey();
  const url = new URL("https://maps.googleapis.com/maps/api/place/autocomplete/json");
  url.searchParams.set("input", query);
  url.searchParams.set("types", "(cities)");
  url.searchParams.set("key", key);

  const response = await fetch(url, { next: { revalidate: 3600 } });
  if (!response.ok) throw new Error("Google Places autocomplete failed.");

  const data = (await response.json().catch(() => null)) as { predictions?: GooglePrediction[]; status?: string } | null;
  if (!data || (data.status && !["OK", "ZERO_RESULTS"].includes(data.status))) {
    throw new Error("Google Places autocomplete returned an invalid status.");
  }

  const predictions = (data.predictions || []).slice(0, 8);
  const details = await Promise.all(
    predictions.map((prediction) => (prediction.place_id ? getGoogleDetails(prediction.place_id, key) : null))
  );

  return predictions
    .map((prediction, index) => fromGooglePrediction(prediction, details[index]))
    .filter((place): place is NormalizedPlace => Boolean(place));
}

export async function GET(request: NextRequest) {
  const query = normalizePlaceText(request.nextUrl.searchParams.get("query") || "");

  if (!query || query.length < 2) {
    return NextResponse.json({ ok: true, source: "local", results: recommendedPlaces.slice(0, 8) });
  }

  if (providerEnabled()) {
    try {
      const results = await googleAutocomplete(query);
      return NextResponse.json({
        ok: true,
        source: "google",
        results: results.length ? results : localPlaceSearch(query)
      });
    } catch (error) {
      console.error("[Roamly Places] provider autocomplete failed", error);
    }
  }

  return NextResponse.json({ ok: true, source: "local", results: localPlaceSearch(query) });
}
