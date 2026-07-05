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

export type TripPlannerPayload = {
  origin?: string;
  destination: string;
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
