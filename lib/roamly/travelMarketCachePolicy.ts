import type { TravelMarketResult } from "@/lib/roamly/travelMarketSearch";

/** Booking.com Demand API prices and availability must be fetched live, never cached. */
export function isTravelMarketResultCacheable(result: Pick<TravelMarketResult, "source">) {
  return result.source !== "booking_demand";
}
