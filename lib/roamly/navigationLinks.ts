export type NavigationDestination = {
  destinationLabel?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  address?: string | null;
};

function destinationValue(destination: NavigationDestination) {
  if (destination.latitude != null && destination.longitude != null) {
    return `${destination.latitude},${destination.longitude}`;
  }
  return destination.address || destination.destinationLabel || "";
}

export function buildGoogleMapsDirectionsUrl(destination: NavigationDestination) {
  const value = destinationValue(destination);
  if (!value) return "";
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(value)}`;
}

export function buildAppleMapsDirectionsUrl(destination: NavigationDestination) {
  const value = destinationValue(destination);
  if (!value) return "";
  return `https://maps.apple.com/?daddr=${encodeURIComponent(value)}`;
}

export function buildCitymapperDirectionsUrl(destination: NavigationDestination) {
  const value = destinationValue(destination);
  if (!value) return "";
  return `https://citymapper.com/directions?endcoord=${encodeURIComponent(value)}&endname=${encodeURIComponent(
    destination.destinationLabel || "Destination"
  )}`;
}

export function buildNavigationLinks(destination: NavigationDestination) {
  const google = buildGoogleMapsDirectionsUrl(destination);
  const apple = buildAppleMapsDirectionsUrl(destination);
  const citymapper = buildCitymapperDirectionsUrl(destination);
  return [
    google ? { provider: "google_maps", label: "Open in Google Maps", href: google } : null,
    apple ? { provider: "apple_maps", label: "Open in Apple Maps", href: apple } : null,
    citymapper ? { provider: "citymapper", label: "Open in Citymapper", href: citymapper } : null
  ].filter(Boolean) as Array<{ provider: string; label: string; href: string }>;
}
