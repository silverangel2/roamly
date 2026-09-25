export const GENERATION_TERMINAL_TRIP_STATUSES = new Set(["archived", "cancelled", "completed"]);

export type GenerationTripLifecycle = {
  status?: string | null;
  itinerary_status?: string | null;
};

export function generationTripIsTerminal(trip: GenerationTripLifecycle | null | undefined) {
  if (!trip) return true;
  return (
    GENERATION_TERMINAL_TRIP_STATUSES.has(String(trip.status || "").toLowerCase()) ||
    String(trip.itinerary_status || "").toLowerCase() === "cancelled"
  );
}
