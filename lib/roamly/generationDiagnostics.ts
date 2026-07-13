import type { RoamlyItinerary } from "@/lib/itinerary";

type DiagnosticValue = string | number | boolean | null | Array<string | number>;

type DiagnosticDetails = Record<string, unknown>;

const SENSITIVE_KEY_PATTERN = /(api[_-]?key|authorization|cookie|secret|token|prompt|full[_-]?response|request[_-]?body)/i;

function getRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function getString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function safeString(value: string) {
  return value.length > 120 ? `${value.slice(0, 117)}...` : value;
}

function sanitizeValue(key: string, value: unknown): DiagnosticValue | undefined {
  if (SENSITIVE_KEY_PATTERN.test(key)) return "[redacted]";
  if (value == null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeString(value);
  if (Array.isArray(value)) {
    const safeItems = value
      .filter((item): item is string | number => typeof item === "string" || typeof item === "number")
      .slice(0, 12)
      .map((item) => (typeof item === "string" ? safeString(item) : item));
    return safeItems;
  }
  return undefined;
}

export function getPublicSupabaseHost() {
  const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!value) return "missing";
  try {
    return new URL(value).host;
  } catch {
    return "invalid";
  }
}

export function logGenerationDiagnostic(event: string, details: DiagnosticDetails = {}) {
  const safeDetails = Object.fromEntries(
    Object.entries(details)
      .map(([key, value]) => [key, sanitizeValue(key, value)] as const)
      .filter((entry): entry is readonly [string, DiagnosticValue] => entry[1] !== undefined)
  );

  console.info("[Roamly generation trace]", {
    event,
    ...safeDetails
  });
}

function timelineItemsForDay(day: unknown): unknown[] {
  const record = getRecord(day);
  if (!record) return [];
  if (Array.isArray(record.live_timeline)) return record.live_timeline;
  if (Array.isArray(record.items)) return record.items;
  return [];
}

function timelineType(item: unknown) {
  const record = getRecord(item);
  if (!record) return "";
  return getString(record.item_type || record.type || record.category).toLowerCase();
}

function hasTravelLikeItem(day: unknown) {
  return timelineItemsForDay(day).some((item) => {
    const type = timelineType(item);
    return type.includes("travel") || type.includes("flight") || type.includes("train") || type.includes("drive");
  });
}

function hasReturnLikeItem(day: unknown) {
  return timelineItemsForDay(day).some((item) => {
    const record = getRecord(item);
    const type = timelineType(item);
    const title = getString(record?.title).toLowerCase();
    const description = getString(record?.description).toLowerCase();
    return (
      type.includes("travel") &&
      (title.includes("return") ||
        title.includes("departure") ||
        title.includes("flight home") ||
        description.includes("return") ||
        description.includes("departure"))
    );
  });
}

function hasTimeFields(item: unknown) {
  const record = getRecord(item);
  if (!record) return false;
  return Boolean(getString(record.startTime || record.start_time) && getString(record.endTime || record.end_time));
}

function hasBookingUrl(item: unknown) {
  const record = getRecord(item);
  const booking = getRecord(record?.booking);
  return Boolean(getString(booking?.url));
}

export function summarizeItineraryShape(value: unknown) {
  const record = getRecord(value);
  const days = Array.isArray(record?.daily_itinerary)
    ? record.daily_itinerary
    : Array.isArray(record?.days)
      ? record.days
      : [];
  const timelineByDay = days.map(timelineItemsForDay);
  const timelineItemCount = timelineByDay.reduce((sum, items) => sum + items.length, 0);
  const timelineItems = timelineByDay.flat();
  const bookingSuggestions = Array.isArray(record?.booking_suggestions) ? record.booking_suggestions : [];
  const firstDay = days[0];
  const finalDay = days.at(-1);

  return {
    hasDailyItinerary: Array.isArray(record?.daily_itinerary),
    dayCount: days.length,
    daysWithTimelineItems: timelineByDay.filter((items) => items.length > 0).length,
    timelineItemCount,
    timelineItemsWithTimes: timelineItems.filter(hasTimeFields).length,
    timelineItemsWithBookingUrls: timelineItems.filter(hasBookingUrl).length,
    bookingSuggestionCount: bookingSuggestions.length,
    firstDayItemCount: timelineItemsForDay(firstDay).length,
    firstDayHasTravel: hasTravelLikeItem(firstDay),
    finalDayItemCount: timelineItemsForDay(finalDay).length,
    finalDayHasReturnTravel: hasReturnLikeItem(finalDay),
    structuredTimelineComplete: days.length > 0 && timelineByDay.every((items) => items.length > 0)
  };
}

export function summarizeStoredItinerary(itinerary: RoamlyItinerary) {
  return summarizeItineraryShape(itinerary);
}

export function classifyGenerationValidationErrors(errors: string[]) {
  const categories = new Set<string>();
  for (const error of errors) {
    const text = error.toLowerCase();
    if (text.includes("day 1")) categories.add("missing_day_1_travel");
    else if (text.includes("final day")) categories.add("missing_final_return_travel");
    else if (text.includes("overlap") || text.includes("ends before")) categories.add("invalid_timing");
    else if (text.includes("transfer")) categories.add("missing_transfer");
    else if (text.includes("booking") || text.includes("cta")) categories.add("invalid_booking_cta");
    else if (text.includes("legacy")) categories.add("legacy_booking_link");
    else if (text.includes("timeline")) categories.add("missing_timeline");
    else categories.add("other_validation_error");
  }
  return Array.from(categories).slice(0, 12);
}
