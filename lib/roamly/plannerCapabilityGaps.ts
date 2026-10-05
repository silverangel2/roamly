/**
 * Preferences the planner UI must not pretend to apply.
 * Existing TripPlannerPayload fields stay in the form. These do not.
 */
export const PLANNER_BACKEND_CAPABILITY_GAPS = [
  "Hotel brand or loyalty program",
  "Airline alliance, fare class, or seat assignment",
  "Structured cuisine filters beyond the dietary note",
  "A required neighborhood or specific property",
  "Child ages beyond adult, child, and infant counts",
  "Visa or passport status as a generation input",
  "Free-text notes as a hard filter on hotel, flight, or activity inventory",
  "Confirming a festival is happening when a note says “if any”"
] as const;
