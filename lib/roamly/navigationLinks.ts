export type NavigationDestination = {
  label?: string | null;
  destinationLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
  /** True when the destination is only a bare text query with no
   *  identified place behind it (map-honesty fix, 2026-11-07): the
   *  provider will resolve the words at click time, possibly to a
   *  guess, so the link labels must say "Search in …" instead of
   *  presenting the words as the place. Ignored when coordinates
   *  are present — an exact point needs no such warning. */
  unverifiedSearch?: boolean;
};

function hasCoordinates(destination: NavigationDestination) {
  return (
    typeof destination.latitude === "number" &&
    Number.isFinite(destination.latitude) &&
    typeof destination.longitude === "number" &&
    Number.isFinite(destination.longitude)
  );
}

function destinationLabel(destination: NavigationDestination) {
  return destination.label || destination.destinationLabel || "Destination";
}

function destinationValue(destination: NavigationDestination) {
  if (hasCoordinates(destination)) {
    return `${destination.latitude},${destination.longitude}`;
  }
  return destination.address || destination.label || destination.destinationLabel || "";
}

export function buildGoogleMapsUrl(destination: NavigationDestination) {
  const value = destinationValue(destination);
  if (!value) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}`;
}

export function buildAppleMapsUrl(destination: NavigationDestination) {
  const value = destinationValue(destination);
  if (!value) return "";
  return `https://maps.apple.com/?daddr=${encodeURIComponent(value)}`;
}

export function buildCitymapperUrl(destination: NavigationDestination) {
  if (hasCoordinates(destination)) {
    return `https://citymapper.com/directions?endcoord=${encodeURIComponent(
      `${destination.latitude},${destination.longitude}`
    )}&endname=${encodeURIComponent(destinationLabel(destination))}`;
  }

  const value = destinationValue(destination);
  if (!value) return "";
  return `https://citymapper.com/search?query=${encodeURIComponent(value)}`;
}

export const buildGoogleMapsDirectionsUrl = buildGoogleMapsUrl;
export const buildAppleMapsDirectionsUrl = buildAppleMapsUrl;
export const buildCitymapperDirectionsUrl = buildCitymapperUrl;

export function buildNavigationLinks(destination: NavigationDestination) {
  const google = buildGoogleMapsUrl(destination);
  const apple = buildAppleMapsUrl(destination);
  const citymapper = buildCitymapperUrl(destination);
  // A bare text search is labelled as a search (map-honesty fix,
  // 2026-11-07): the traveller is told to check the result is the
  // right place, because the provider resolves the words, not a
  // verified location. Coordinate destinations keep the plain
  // labels — the link points at the exact place.
  const searchOnly = destination.unverifiedSearch === true && !hasCoordinates(destination);
  return [
    google
      ? {
          provider: "google_maps",
          label: searchOnly ? "Search in Google Maps — check it's the right place" : "Open in Google Maps",
          href: google
        }
      : null,
    apple
      ? {
          provider: "apple_maps",
          label: searchOnly ? "Search in Apple Maps — check it's the right place" : "Open in Apple Maps",
          href: apple
        }
      : null,
    citymapper
      ? {
          provider: "citymapper",
          label: searchOnly ? "Search in Citymapper — check it's the right place" : "Open in Citymapper",
          href: citymapper
        }
      : null
  ].filter(Boolean) as Array<{ provider: string; label: string; href: string }>;
}
