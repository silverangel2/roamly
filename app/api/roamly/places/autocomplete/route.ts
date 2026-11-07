import { NextRequest, NextResponse } from "next/server";
import { searchCityPlaces } from "@/lib/roamly/placeResolver";
import { searchPhotonCached, type PhotonFeature } from "@/lib/roamly/engine/photon";

/*
 * Place picker search (consolidation 2026-11-06): Photon is the
 * PRIMARY candidate source, GeoNames the local fallback lane.
 *
 * Discipline carried over from the places evaluation:
 *  - Photon's raw global ranking is NEVER surfaced unfiltered:
 *    features pass Roamly's own gates here — a feature needs a
 *    name and coordinates; POI features are only returned when the
 *    caller passes the destination bias (lat/lon), because
 *    unbiased POI ranking resolves same-named places continents
 *    away.
 *  - NO layer filter is ever sent to Photon (layer=city is a
 *    tested trap that returns zero results for real cities).
 *  - A `country` hint (the country the traveller already picked)
 *    narrows Photon features before merging.
 *  - Results are cached per normalised query at picker-session
 *    level (searchPhotonCached) — repeat keystrokes cost nothing.
 * GeoNames results keep their existing shape and always ride
 * along: if Photon is unreachable, the picker behaves exactly as
 * it did before the flip.
 */

interface PickerPlace {
  label: string;
  value: string;
  city: string;
  region: string;
  country: string;
  countryCode: string;
  latitude: number;
  longitude: number;
  travelCode: string | null;
  source: string;
  kind: string;
}

const CITY_TYPES = new Set(["city", "town", "village", "administrative", "state", "country"]);

function photonFeatureToPickerPlace(feature: PhotonFeature): PickerPlace | null {
  const props = feature.properties || {};
  const coords = feature.geometry?.coordinates;
  if (!props.name || !Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  const isCityLike = CITY_TYPES.has(props.type || "") || props.osm_key === "place" || props.osm_key === "boundary";
  const region = props.state || "";
  const country = props.country || "";
  const label = [props.name, region, country].filter(Boolean).join(", ");
  return {
    label,
    value: label,
    city: props.name,
    region,
    country,
    countryCode: (props.countrycode || "").toUpperCase(),
    latitude,
    longitude,
    travelCode: null,
    source: "photon",
    kind: isCityLike ? "city" : "poi"
  };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const query =
    searchParams.get("query") ||
    searchParams.get("q") ||
    searchParams.get("term") ||
    "";
  const limit = Number(searchParams.get("limit") || 12);
  const countryHint = (searchParams.get("country") || "").trim().toLowerCase();
  const biasLat = Number(searchParams.get("lat"));
  const biasLon = Number(searchParams.get("lon"));
  const bias =
    Number.isFinite(biasLat) && Number.isFinite(biasLon) && (biasLat !== 0 || biasLon !== 0)
      ? { lat: biasLat, lon: biasLon }
      : null;

  const geonames: PickerPlace[] = searchCityPlaces(query, limit).map((place) => ({
    label: place.label,
    value: place.searchLabel,
    city: place.asciiName || place.name,
    region: place.admin1Name || place.admin1AsciiName || "",
    country: place.countryName,
    countryCode: place.countryCode,
    latitude: place.latitude,
    longitude: place.longitude,
    travelCode: place.travelCode || null,
    source: "geonames",
    kind: "city"
  }));

  let photonPlaces: PickerPlace[] = [];
  if (query.trim().length >= 2) {
    const { features } = await searchPhotonCached(
      (url, init) => fetch(url, init),
      query,
      { limit: Math.max(limit, 8), bias }
    );
    const queryKey = query.trim().toLowerCase();
    photonPlaces = features
      .map(photonFeatureToPickerPlace)
      .filter((p): p is PickerPlace => Boolean(p))
      .filter((p) => {
        if (countryHint) {
          const cc = p.countryCode.toLowerCase();
          const country = p.country.toLowerCase();
          if (cc !== countryHint && country !== countryHint) return false;
        }
        if (p.kind === "poi") {
          // POIs surface ONLY under a destination bias (see header)
          // and only when the query actually names them.
          if (!bias) return false;
          if (!p.city.toLowerCase().includes(queryKey) && !queryKey.includes(p.city.toLowerCase())) return false;
        }
        return true;
      });
  }

  // Merge: Photon first (primary), GeoNames fills the rest; a
  // GeoNames row that is the same place as a Photon row (same
  // name + country) yields to the Photon row.
  const merged: PickerPlace[] = [];
  const seen = new Set<string>();
  const keyOf = (p: PickerPlace) => `${p.city.toLowerCase()}|${p.country.toLowerCase()}`;
  for (const p of [...photonPlaces, ...geonames]) {
    const k = keyOf(p);
    if (seen.has(k)) continue;
    seen.add(k);
    merged.push(p);
  }
  const places = merged.slice(0, Math.max(1, limit));

  return NextResponse.json({
    ok: true,
    query,
    places,
    results: places
  });
}
