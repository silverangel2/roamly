import { getRoamlyBookingLinks } from "@/lib/roamly/affiliateLinks";
import { getTripDestinationLabel, getTripOriginLabel } from "@/lib/roamly/tripMetadata";
import type { RoamlyTripRecord } from "@/lib/trips";

export function getBookingLinks(trip: Pick<RoamlyTripRecord, "destination" | "destination_name" | "origin" | "metadata">) {
  return getRoamlyBookingLinks({
    destination: getTripDestinationLabel(trip),
    origin: getTripOriginLabel(trip)
  });
}
