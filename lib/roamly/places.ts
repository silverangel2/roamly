export type NormalizedPlaceSource = "google" | "local" | "custom";

export type NormalizedPlace = {
  label: string;
  value: string;
  city?: string;
  region?: string;
  country?: string;
  place_id?: string;
  latitude?: number;
  longitude?: number;
  formatted_address?: string;
  currency?: string;
  timezone?: string;
  source: NormalizedPlaceSource;
};

export function normalizePlaceText(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

function searchText(place: NormalizedPlace) {
  return [place.label, place.value, place.city, place.region, place.country, place.formatted_address]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export const recommendedPlaces: NormalizedPlace[] = [
  {
    label: "Saint John, Canada",
    value: "Saint John, Canada",
    city: "Saint John",
    region: "New Brunswick",
    country: "Canada",
    latitude: 45.2733,
    longitude: -66.0633,
    currency: "CAD",
    timezone: "America/Moncton",
    source: "local"
  },
  {
    label: "Toronto, Canada",
    value: "Toronto, Canada",
    city: "Toronto",
    region: "Ontario",
    country: "Canada",
    latitude: 43.6532,
    longitude: -79.3832,
    currency: "CAD",
    timezone: "America/Toronto",
    source: "local"
  },
  {
    label: "Vancouver, Canada",
    value: "Vancouver, Canada",
    city: "Vancouver",
    region: "British Columbia",
    country: "Canada",
    latitude: 49.2827,
    longitude: -123.1207,
    currency: "CAD",
    timezone: "America/Vancouver",
    source: "local"
  },
  {
    label: "Montreal, Canada",
    value: "Montreal, Canada",
    city: "Montreal",
    region: "Quebec",
    country: "Canada",
    latitude: 45.5019,
    longitude: -73.5674,
    currency: "CAD",
    timezone: "America/Toronto",
    source: "local"
  },
  {
    label: "Banff, Canada",
    value: "Banff, Canada",
    city: "Banff",
    region: "Alberta",
    country: "Canada",
    latitude: 51.1784,
    longitude: -115.5708,
    currency: "CAD",
    timezone: "America/Edmonton",
    source: "local"
  },
  {
    label: "New York City, United States",
    value: "New York City, United States",
    city: "New York City",
    region: "New York",
    country: "United States",
    latitude: 40.7128,
    longitude: -74.006,
    currency: "USD",
    timezone: "America/New_York",
    source: "local"
  },
  {
    label: "Los Angeles, United States",
    value: "Los Angeles, United States",
    city: "Los Angeles",
    region: "California",
    country: "United States",
    latitude: 34.0522,
    longitude: -118.2437,
    currency: "USD",
    timezone: "America/Los_Angeles",
    source: "local"
  },
  {
    label: "Las Vegas, United States",
    value: "Las Vegas, United States",
    city: "Las Vegas",
    region: "Nevada",
    country: "United States",
    latitude: 36.1716,
    longitude: -115.1391,
    currency: "USD",
    timezone: "America/Los_Angeles",
    source: "local"
  },
  {
    label: "Paris, France",
    value: "Paris, France",
    city: "Paris",
    country: "France",
    latitude: 48.8566,
    longitude: 2.3522,
    currency: "EUR",
    timezone: "Europe/Paris",
    source: "local"
  },
  {
    label: "London, United Kingdom",
    value: "London, United Kingdom",
    city: "London",
    country: "United Kingdom",
    latitude: 51.5072,
    longitude: -0.1276,
    currency: "GBP",
    timezone: "Europe/London",
    source: "local"
  },
  {
    label: "Rome, Italy",
    value: "Rome, Italy",
    city: "Rome",
    country: "Italy",
    latitude: 41.9028,
    longitude: 12.4964,
    currency: "EUR",
    timezone: "Europe/Rome",
    source: "local"
  },
  {
    label: "Barcelona, Spain",
    value: "Barcelona, Spain",
    city: "Barcelona",
    region: "Catalonia",
    country: "Spain",
    latitude: 41.3874,
    longitude: 2.1686,
    currency: "EUR",
    timezone: "Europe/Madrid",
    source: "local"
  },
  {
    label: "Tokyo, Japan",
    value: "Tokyo, Japan",
    city: "Tokyo",
    country: "Japan",
    latitude: 35.6762,
    longitude: 139.6503,
    currency: "JPY",
    timezone: "Asia/Tokyo",
    source: "local"
  },
  {
    label: "Seoul, South Korea",
    value: "Seoul, South Korea",
    city: "Seoul",
    country: "South Korea",
    latitude: 37.5665,
    longitude: 126.978,
    currency: "KRW",
    timezone: "Asia/Seoul",
    source: "local"
  },
  {
    label: "Singapore",
    value: "Singapore",
    city: "Singapore",
    country: "Singapore",
    latitude: 1.3521,
    longitude: 103.8198,
    currency: "SGD",
    timezone: "Asia/Singapore",
    source: "local"
  },
  {
    label: "Bangkok, Thailand",
    value: "Bangkok, Thailand",
    city: "Bangkok",
    country: "Thailand",
    latitude: 13.7563,
    longitude: 100.5018,
    currency: "THB",
    timezone: "Asia/Bangkok",
    source: "local"
  },
  {
    label: "Bali, Indonesia",
    value: "Bali, Indonesia",
    city: "Bali",
    region: "Bali",
    country: "Indonesia",
    latitude: -8.3405,
    longitude: 115.092,
    currency: "IDR",
    timezone: "Asia/Makassar",
    source: "local"
  },
  {
    label: "Dubai, United Arab Emirates",
    value: "Dubai, United Arab Emirates",
    city: "Dubai",
    country: "United Arab Emirates",
    latitude: 25.2048,
    longitude: 55.2708,
    currency: "AED",
    timezone: "Asia/Dubai",
    source: "local"
  },
  {
    label: "Sydney, Australia",
    value: "Sydney, Australia",
    city: "Sydney",
    region: "New South Wales",
    country: "Australia",
    latitude: -33.8688,
    longitude: 151.2093,
    currency: "AUD",
    timezone: "Australia/Sydney",
    source: "local"
  },
  {
    label: "Amsterdam, Netherlands",
    value: "Amsterdam, Netherlands",
    city: "Amsterdam",
    country: "Netherlands",
    latitude: 52.3676,
    longitude: 4.9041,
    currency: "EUR",
    timezone: "Europe/Amsterdam",
    source: "local"
  },
  {
    label: "Lisbon, Portugal",
    value: "Lisbon, Portugal",
    city: "Lisbon",
    country: "Portugal",
    latitude: 38.7223,
    longitude: -9.1393,
    currency: "EUR",
    timezone: "Europe/Lisbon",
    source: "local"
  }
];

export const popularOriginPlaces = recommendedPlaces.filter((place) =>
  ["Saint John", "Toronto", "Vancouver", "Montreal", "New York City", "Paris"].includes(place.city || place.label)
);

export function localPlaceSearch(query: string, places: NormalizedPlace[] = recommendedPlaces, limit = 8) {
  const normalized = normalizePlaceText(query).toLowerCase();
  if (!normalized) return places.slice(0, limit);

  return places
    .filter((place) => searchText(place).includes(normalized))
    .sort((a, b) => {
      const aStarts = a.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      const bStarts = b.label.toLowerCase().startsWith(normalized) ? 0 : 1;
      return aStarts - bStarts || a.label.localeCompare(b.label);
    })
    .slice(0, limit);
}

export function normalizeCustomPlace(value: string): NormalizedPlace {
  const cleaned = normalizePlaceText(value);
  return {
    label: cleaned,
    value: cleaned,
    source: "custom"
  };
}

export function isValidPlaceValue(value: string | undefined | null) {
  return normalizePlaceText(value || "").length >= 2;
}
