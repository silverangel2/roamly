export type NavigationDestination = {
  label?: string | null;
  destinationLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
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
  return [
    google ? { provider: "google_maps", label: "Open in Google Maps", href: google } : null,
    apple ? { provider: "apple_maps", label: "Open in Apple Maps", href: apple } : null,
    citymapper ? { provider: "citymapper", label: "Open in Citymapper", href: citymapper } : null
  ].filter(Boolean) as Array<{ provider: string; label: string; href: string }>;
}
