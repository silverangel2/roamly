/**
 * Traveler notes are constraints on hotels, flights, and activities.
 * They change what is searched and what is shown first.
 * They do not invent a hotel, a flight, an activity, or a festival.
 */

export type TravelerNoteDisplay = {
  text: string;
  constraints: string[];
  gaps: string[];
  hotel: string;
  flight: string;
  activity: string;
};

function clean(value: string | null | undefined) {
  return (value || "").trim();
}

export function travelerNoteDisplay(notes: string | null | undefined): TravelerNoteDisplay {
  const text = clean(notes);
  if (!text) return { text: "", constraints: [], gaps: [], hotel: "", flight: "", activity: "" };
  const constraints = [text];
  const gaps: string[] = [];
  let hotel = "Your note is applied to stay choices. It does not book a hotel.";
  let flight = "Your note is applied to how you get there. It does not book a flight.";
  let activity = "Your note is applied to what you do. It does not book an activity.";

  if (/\bhotel|stay|airbnb|neighborhood|property\b/i.test(text)) {
    hotel = "Stay choices use this note as a preference. Roamly does not turn it into a booked hotel.";
  }
  if (/\bflight|airline|seat|layover|airport|nonstop|direct\b/i.test(text)) {
    flight = "Getting-there choices use this note as a preference. Roamly does not turn it into a booked flight.";
  }
  if (/\bfestival|concert|event|nightlife\b/i.test(text)) {
    constraints.push("Hotels, flights, and activities are checked against this note before generic sightseeing.");
    hotel = "If an event is confirmed, stays are ranked toward that area. No festival hotel is invented.";
    flight = "Flight timing stays a recommendation until you book. This note does not add an airport stop.";
    activity = "Activities look for an official event on these dates first. Nothing is added unless a source confirms it.";
    gaps.push("A festival is not added unless a source confirms it.");
  }
  return { text, constraints, gaps, hotel, flight, activity };
}

/** Short preference string for hotel ranking. Empty when the note should not change the search. */
export function noteHotelPreference(notes: string | null | undefined) {
  const text = clean(notes);
  if (!text) return "";
  const bits: string[] = [];
  if (/\bfestival|concert|event|nightlife\b/i.test(text)) bits.push("event venue downtown");
  const area = text.match(/\b(old port|old montreal|downtown|plateau|walkable|waterfront|quiet|mile end)\b/i);
  if (area) bits.push(area[1]);
  return bits.join(" ").slice(0, 180);
}

export function noteMatchesChoice(notes: string | null | undefined, value: string | null | undefined) {
  const text = clean(notes).toLowerCase();
  const blob = clean(value).toLowerCase();
  if (!text || !blob) return false;
  if (/\bfestival|concert|event|nightlife\b/.test(text) && /\bfestival|concert|event|nightlife|venue|official events\b/.test(blob)) return true;
  const tokens = text.split(/[^a-z0-9]+/).filter((token) => token.length >= 5 && !["hotel", "flight", "notes", "there", "which", "about"].includes(token));
  return tokens.some((token) => blob.includes(token));
}

export function rankChoicesForNotes<T>(items: readonly T[], notes: string | null | undefined, label: (item: T) => string) {
  if (!clean(notes)) return [...items];
  return items
    .map((item, index) => ({ item, index, match: noteMatchesChoice(notes, label(item)) ? 0 : 1 }))
    .sort((a, b) => a.match - b.match || a.index - b.index)
    .map((entry) => entry.item);
}

export function readTripNoteText(trip: {
  special_notes?: string | null;
  metadata?: unknown;
  interests?: unknown;
}) {
  const metadata = trip.metadata && typeof trip.metadata === "object" && !Array.isArray(trip.metadata)
    ? trip.metadata as Record<string, unknown>
    : {};
  const planning = metadata.planning && typeof metadata.planning === "object" && !Array.isArray(metadata.planning)
    ? metadata.planning as Record<string, unknown>
    : {};
  const explicit = Array.isArray(planning.explicitRequirements) ? planning.explicitRequirements : [];
  const requests = explicit
    .map((item) => (item && typeof item === "object" && "request" in item && typeof item.request === "string" ? item.request.trim() : ""))
    .filter(Boolean);
  return [
    clean(trip.special_notes),
    clean(typeof planning.specialNotes === "string" ? planning.specialNotes : ""),
    clean(typeof planning.special_notes === "string" ? planning.special_notes : ""),
    clean(typeof metadata.specialNotes === "string" ? metadata.specialNotes : ""),
    clean(typeof metadata.special_notes === "string" ? metadata.special_notes : ""),
    clean(typeof planning.notes === "string" ? planning.notes : ""),
    ...requests
  ].filter(Boolean).filter((value, index, list) => list.indexOf(value) === index).join("\n");
}
