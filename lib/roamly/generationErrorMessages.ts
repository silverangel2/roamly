// Safe, user-facing messages for itinerary-generation failures.
//
// The guest route (app/api/trips/guest-itinerary/route.ts) shows
// payload.message to the guest when present and falls back to the
// generic "Roamly could not start a free itinerary right now." when it
// is absent. Before 2026-11-25 three generateTripForActor error returns
// carried no message at all (validation string, trip-save failure,
// unhandled catch), so every one of those failures reached the guest as
// the generic line with no detail and no retry — the 2026-11-25 QA dead
// end (Paris x2, London x1, 19:30-19:40 UTC, transient DB-path stall).
//
// These lines are the only text that may reach the guest from those
// branches: plain words, an invitation to try again, never raw DB or
// runtime text (no error codes, no PostgREST messages, no stack).
// Validation failures use their own already-user-facing text as the
// message instead of a constant below.

export const GENERATION_TRIP_SAVE_FAILED_MESSAGE =
  "Roamly could not save your trip just now. Please try again in a moment.";

export const GENERATION_START_FAILED_MESSAGE =
  "Roamly could not start itinerary generation. Please try again in a moment.";
