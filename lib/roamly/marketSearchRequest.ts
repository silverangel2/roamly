import type { TravelMarketCategory, TravelMarketSearchRequest } from "@/lib/roamly/travelMarketSearch";

const categories = new Set<TravelMarketCategory>(["flight", "hotel", "attraction", "tour", "restaurant", "transport"]);

function boundedString(value: unknown, maxLength: number) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function positiveInteger(value: unknown, fallback: number, maximum: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, Math.floor(parsed)) : fallback;
}

function positiveAmount(value: unknown, maximum: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(maximum, parsed) : undefined;
}

function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

export function parseMarketSearchRequest(body: Record<string, unknown>): TravelMarketSearchRequest | null {
  const category = body.category;
  if (typeof category !== "string" || !categories.has(category as TravelMarketCategory)) return null;
  const currency = boundedString(body.currency, 3).toUpperCase() || "CAD";

  const request: TravelMarketSearchRequest = {
    category: category as TravelMarketCategory,
    origin: boundedString(body.origin, 100),
    destination: boundedString(body.destination, 100),
    city: boundedString(body.city, 100),
    country: boundedString(body.country, 80),
    start_date: boundedString(body.start_date || body.startDate || body.date, 10),
    end_date: boundedString(body.end_date || body.endDate, 10),
    travelers: positiveInteger(body.travelers, 1, 20),
    rooms: positiveInteger(body.rooms, 1, 10),
    maximum_nightly_price: positiveAmount(body.maximum_nightly_price, 100_000),
    hotel_preferences: boundedString(body.hotel_preferences, 180),
    room_type: boundedString(body.room_type || body.roomType, 60),
    title: boundedString(body.title || body.query, 160),
    currency
  };

  if (!/^[A-Z]{3}$/.test(currency)) return null;
  if (request.start_date && !validDate(request.start_date)) return null;
  if (request.end_date && !validDate(request.end_date)) return null;
  if (request.end_date && request.start_date && request.end_date < request.start_date) return null;
  if (!request.destination && !request.city) return null;
  if (category === "flight" && (!request.origin || !request.start_date)) return null;
  if (category === "hotel" && (!request.country || !request.start_date || !request.end_date || request.start_date === request.end_date)) return null;
  if ((category === "attraction" || category === "tour" || category === "restaurant") && !request.title) return null;
  return request;
}
