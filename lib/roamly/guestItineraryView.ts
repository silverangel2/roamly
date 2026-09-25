export const GUEST_ITINERARY_PATH = "/plan/itinerary";
export const GUEST_FREE_ITINERARY_DISCLAIMER = "This is your free itinerary. Nothing is booked or charged.";
export const GUEST_ACCOUNT_WALL = [
  "Save this itinerary",
  "Continue beyond this free itinerary",
  "Live Companion",
  "Paid packs"
] as const;

export type GuestItineraryStatus = "building" | "ready" | "failed";

export type GuestItineraryDayView = {
  dayNumber: number;
  date: string | null;
  title: string;
  morning: string;
  afternoon: string;
  evening: string;
  food: string[];
  timeline: Array<{ time: string; title: string }>;
};

export type GuestItineraryView = {
  title: string;
  summary: string;
  disclaimer: typeof GUEST_FREE_ITINERARY_DISCLAIMER;
  status: GuestItineraryStatus;
  days: GuestItineraryDayView[];
  continuesBehindAccount: readonly string[];
};

const FINAL_NOTE = /generated through roamly staged ai generation/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function clip(value: unknown, limit = 500) {
  return typeof value === "string" ? value.trim().slice(0, limit) : "";
}

function dayFromRecord(value: unknown): GuestItineraryDayView | null {
  const day = asRecord(value);
  if (!day) return null;
  const dayNumber = Number(day.day_number ?? day.dayNumber);
  if (!Number.isFinite(dayNumber) || dayNumber < 1) return null;
  const timeline = Array.isArray(day.live_timeline) ? day.live_timeline : [];
  return {
    dayNumber,
    date: clip(day.date, 40) || null,
    title: clip(day.title, 180),
    morning: clip(day.morning),
    afternoon: clip(day.afternoon),
    evening: clip(day.evening),
    food: (Array.isArray(day.food) ? day.food : [])
      .map((item) => clip(item, 160))
      .filter(Boolean)
      .slice(0, 4),
    timeline: timeline
      .map((item) => {
        const record = asRecord(item);
        return { time: clip(record?.time_label, 40), title: clip(record?.title, 180) };
      })
      .filter((item) => item.title)
      .slice(0, 8)
  };
}

function daysFromItinerary(fullJson: unknown) {
  const days = asRecord(fullJson)?.daily_itinerary;
  if (!Array.isArray(days)) return [];
  return days
    .map(dayFromRecord)
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

function daysFromMetadata(metadata: unknown) {
  const generatedDays = asRecord(asRecord(asRecord(metadata)?.generation)?.generatedDays);
  if (!generatedDays) return [];
  return Object.values(generatedDays)
    .map(dayFromRecord)
    .filter((day): day is GuestItineraryDayView => Boolean(day))
    .sort((a, b) => a.dayNumber - b.dayNumber);
}

export function publicGuestItineraryView(input: {
  tripTitle?: string | null;
  destination?: string | null;
  tripStatus?: string | null;
  itineraryStatus?: string | null;
  fullJson?: unknown;
  metadata?: unknown;
}): GuestItineraryView {
  const full = asRecord(input.fullJson);
  const generation = asRecord(asRecord(input.metadata)?.generation);
  const generationStatus = clip(generation?.status, 40).toLowerCase();
  const tripStatus = clip(input.tripStatus, 40).toLowerCase();
  const itineraryStatus = clip(input.itineraryStatus, 40).toLowerCase();
  const storedDays = daysFromItinerary(input.fullJson);
  const days = storedDays.length ? storedDays : daysFromMetadata(input.metadata);
  const final =
    FINAL_NOTE.test(clip(full?.generation_note, 200)) ||
    generationStatus === "complete" ||
    itineraryStatus === "generated" ||
    itineraryStatus === "locked";
  const failed = generationStatus === "failed" || tripStatus === "failed" || itineraryStatus === "failed";
  const status: GuestItineraryStatus = final && days.length ? "ready" : failed ? "failed" : "building";
  const destination = clip(input.destination, 160);
  const title = clip(full?.trip_title, 180) || clip(input.tripTitle, 180) || (destination ? `${destination} itinerary` : "Your free itinerary");
  const summary = clip(full?.destination_summary, 500) || (destination ? `Free itinerary for ${destination}.` : "Your free itinerary is on this page.");

  return {
    title,
    summary,
    disclaimer: GUEST_FREE_ITINERARY_DISCLAIMER,
    status,
    days,
    continuesBehindAccount: GUEST_ACCOUNT_WALL
  };
}
