export const travelStyles = [
  "Chill",
  "Balanced",
  "Packed",
  "Luxury",
  "Budget",
  "Adventure",
  "Foodie",
  "Family",
  "Solo"
] as const;

export const tripInterests = [
  "Food",
  "Beaches",
  "Museums",
  "Nightlife",
  "Shopping",
  "Culture",
  "Nature",
  "Diving",
  "Hiking",
  "Cafes",
  "Hidden gems"
] as const;

export const paceOptions = ["Slow", "Normal", "Fast"] as const;

export const accommodationOptions = ["Budget", "Mid-range", "Luxury", "Not sure"] as const;

export const transportationOptions = [
  "Walking",
  "Public transit",
  "Rental car",
  "Rideshare",
  "Mixed"
] as const;

export const currencyOptions = ["CAD", "USD", "EUR", "GBP", "PHP", "AUD", "JPY"] as const;

export type RecommendedDestination = {
  label: string;
  value: string;
  city: string;
  country: string;
  region?: string;
  latitude?: number;
  longitude?: number;
  currency?: string;
};

export const recommendedDestinations: RecommendedDestination[] = [
  { label: "Toronto, Canada", value: "Toronto, Canada", city: "Toronto", country: "Canada", region: "Ontario", latitude: 43.6532, longitude: -79.3832, currency: "CAD" },
  { label: "Vancouver, Canada", value: "Vancouver, Canada", city: "Vancouver", country: "Canada", region: "British Columbia", latitude: 49.2827, longitude: -123.1207, currency: "CAD" },
  { label: "Montreal, Canada", value: "Montreal, Canada", city: "Montreal", country: "Canada", region: "Quebec", latitude: 45.5019, longitude: -73.5674, currency: "CAD" },
  { label: "Banff, Canada", value: "Banff, Canada", city: "Banff", country: "Canada", region: "Alberta", latitude: 51.1784, longitude: -115.5708, currency: "CAD" },
  { label: "New York City, United States", value: "New York City, United States", city: "New York City", country: "United States", region: "New York", latitude: 40.7128, longitude: -74.006, currency: "USD" },
  { label: "Los Angeles, United States", value: "Los Angeles, United States", city: "Los Angeles", country: "United States", region: "California", latitude: 34.0522, longitude: -118.2437, currency: "USD" },
  { label: "Las Vegas, United States", value: "Las Vegas, United States", city: "Las Vegas", country: "United States", region: "Nevada", latitude: 36.1716, longitude: -115.1391, currency: "USD" },
  { label: "Paris, France", value: "Paris, France", city: "Paris", country: "France", latitude: 48.8566, longitude: 2.3522, currency: "EUR" },
  { label: "London, United Kingdom", value: "London, United Kingdom", city: "London", country: "United Kingdom", latitude: 51.5072, longitude: -0.1276, currency: "GBP" },
  { label: "Rome, Italy", value: "Rome, Italy", city: "Rome", country: "Italy", latitude: 41.9028, longitude: 12.4964, currency: "EUR" },
  { label: "Barcelona, Spain", value: "Barcelona, Spain", city: "Barcelona", country: "Spain", region: "Catalonia", latitude: 41.3874, longitude: 2.1686, currency: "EUR" },
  { label: "Tokyo, Japan", value: "Tokyo, Japan", city: "Tokyo", country: "Japan", latitude: 35.6762, longitude: 139.6503, currency: "JPY" },
  { label: "Seoul, South Korea", value: "Seoul, South Korea", city: "Seoul", country: "South Korea", latitude: 37.5665, longitude: 126.978, currency: "KRW" },
  { label: "Singapore", value: "Singapore", city: "Singapore", country: "Singapore", latitude: 1.3521, longitude: 103.8198, currency: "SGD" },
  { label: "Bangkok, Thailand", value: "Bangkok, Thailand", city: "Bangkok", country: "Thailand", latitude: 13.7563, longitude: 100.5018, currency: "THB" },
  { label: "Bali, Indonesia", value: "Bali, Indonesia", city: "Bali", country: "Indonesia", region: "Bali", latitude: -8.3405, longitude: 115.092, currency: "IDR" },
  { label: "Dubai, United Arab Emirates", value: "Dubai, United Arab Emirates", city: "Dubai", country: "United Arab Emirates", latitude: 25.2048, longitude: 55.2708, currency: "AED" },
  { label: "Sydney, Australia", value: "Sydney, Australia", city: "Sydney", country: "Australia", region: "New South Wales", latitude: -33.8688, longitude: 151.2093, currency: "AUD" },
  { label: "Amsterdam, Netherlands", value: "Amsterdam, Netherlands", city: "Amsterdam", country: "Netherlands", latitude: 52.3676, longitude: 4.9041, currency: "EUR" },
  { label: "Lisbon, Portugal", value: "Lisbon, Portugal", city: "Lisbon", country: "Portugal", latitude: 38.7223, longitude: -9.1393, currency: "EUR" }
];

export type TripPlannerPayload = {
  origin?: string;
  destination: string;
  destinationCity?: string;
  destinationCountry?: string;
  destinationRegion?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  startDate: string;
  endDate: string;
  daysCount: number | null;
  travelersCount?: number | null;
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetIncludesFlights?: boolean;
  budgetIncludesHotel?: boolean;
  travelStyle: string;
  interests: string[];
  pace: string;
  accommodationPreference: string;
  transportationPreference: string;
  specialNotes: string;
  language?: string;
  budgetConstraint?: string;
  priceDiscoveryId?: string | null;
};
