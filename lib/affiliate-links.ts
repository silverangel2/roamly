import { getRoamlyBookingLinks } from "@/lib/roamly/affiliateLinks";
import type { RoamlyTripRecord } from "@/lib/trips";

export function getBookingLinks(trip: Pick<RoamlyTripRecord, "destination" | "origin">) {
  return getRoamlyBookingLinks({ destination: trip.destination, origin: trip.origin });
}
