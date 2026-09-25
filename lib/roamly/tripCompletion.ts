// @ts-expect-error The direct Node regression check loads TypeScript source without the bundler.
import { timezoneFromTripMetadata, tripWindowState } from "./liveCompanion.ts";

export function isCanonicalCompletedTrip(params: {
  status?: unknown;
  startDate?: string | null;
  endDate?: string | null;
  metadata?: unknown;
  now?: string | Date;
}) {
  if (String(params.status || "").trim().toLowerCase() !== "completed") return false;
  return tripWindowState({
    startDate: params.startDate,
    endDate: params.endDate,
    timezone: timezoneFromTripMetadata(params.metadata),
    now: params.now || new Date()
  }) === "completed_trip";
}
