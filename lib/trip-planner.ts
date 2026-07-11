import { recommendedPlaces, type NormalizedPlace } from "@/lib/roamly/places";

export const travelStyles = [
  "Budget",
  "Balanced",
  "Premium",
  "Chill",
  "Luxury",
  "Adventure",
  "Foodie",
  "Family",
  "Solo"
] as const;

export const tripInterests = [
  "Culture",
  "Food",
  "Nightlife",
  "Nature",
  "Shopping",
  "Museums",
  "Beaches",
  "Family",
  "Adventure",
  "Romance",
  "Business",
  "Diving",
  "Hiking",
  "Cafes",
  "Hidden gems"
] as const;

export const paceOptions = ["Relaxed", "Balanced", "Packed", "Slow", "Normal", "Fast"] as const;

export const walkingToleranceOptions = ["Low", "Medium", "High"] as const;

export const bedPreferenceOptions = ["No preference", "One bed", "Two beds", "Family room", "Accessible room"] as const;

export const accommodationOptions = ["Budget", "Mid-range", "Luxury", "Not sure"] as const;

export const transportationOptions = [
  "Walking",
  "Public transit",
  "Rental car",
  "Rideshare",
  "Mixed"
] as const;

export const currencyOptions = [
  "CAD",
  "USD",
  "EUR",
  "GBP",
  "PHP",
  "AUD",
  "JPY",
  "KRW",
  "SGD",
  "THB",
  "IDR",
  "AED"
] as const;

export type RecommendedDestination = NormalizedPlace & {
  city: string;
  country: string;
};

export const recommendedDestinations = recommendedPlaces as RecommendedDestination[];

export type TripType = "single_destination" | "multi_city";

export type TravelerDetails = {
  adults: number;
  children: number;
  infants?: number;
};

export type TripPlannerPayload = {
  tripType?: TripType;
  origin?: string;
  originPlaceId?: string;
  originCity?: string;
  originRegion?: string;
  originCountry?: string;
  originLatitude?: number;
  originLongitude?: number;
  originPlace?: NormalizedPlace;
  destination: string;
  destinationPlaceId?: string;
  destinationCity?: string;
  destinationCountry?: string;
  destinationRegion?: string;
  destinationLatitude?: number;
  destinationLongitude?: number;
  destinationPlace?: NormalizedPlace;
  destinationStops?: NormalizedPlace[];
  returnToOrigin?: boolean;
  flexibleCityOrder?: boolean;
  flexibleDates?: boolean;
  startDate: string;
  endDate: string;
  daysCount: number | null;
  travelersCount?: number | null;
  travelers?: TravelerDetails;
  rooms?: number | null;
  bedPreference?: string;
  budgetAmount: number | null;
  budgetCurrency: string;
  budgetIncludesFlights?: boolean;
  budgetIncludesHotel?: boolean;
  budgetIncludesActivities?: boolean;
  travelStyle: string;
  interests: string[];
  pace: string;
  walkingTolerance?: string;
  accommodationPreference: string;
  transportationPreference: string;
  accessibilityNeeds?: string;
  dietaryPreference?: string;
  specialNotes: string;
  language?: string;
  budgetConstraint?: string;
  priceDiscoveryId?: string | null;
  priceDiscovery?: Record<string, unknown>;
};
