import { NextRequest, NextResponse } from "next/server";
import { searchCityPlaces } from "@/lib/roamly/placeResolver";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query =
    searchParams.get("query") ||
    searchParams.get("q") ||
    searchParams.get("term") ||
    "";
  const limit = Number(searchParams.get("limit") || 12);

  const places = searchCityPlaces(query, limit).map((place) => ({
    label: place.label,
    value: place.searchLabel,
    city: place.asciiName || place.name,
    region: place.admin1Name || place.admin1AsciiName || "",
    country: place.countryName,
    countryCode: place.countryCode,
    latitude: place.latitude,
    longitude: place.longitude,
    travelCode: place.travelCode || null,
    source: "geonames"
  }));

  return NextResponse.json({
    ok: true,
    query,
    places,
    results: places
  });
}
