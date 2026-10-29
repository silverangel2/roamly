/**
 * Server-only trip-timezone resolution (timezone release-blocker round,
 * 2026-10-26). Extends the client-safe resolver in tripTimezone.ts with
 * the destination registry seeds in lib/roamly/engine/packs/destinations.ts
 * (Montreal, Quebec City, Halifax, Banff, Fredericton, Paris, Manila,
 * Boracay, …). This file MUST stay server-only: the seeds module pulls
 * in lib/roamly/engine/ids.ts (node:crypto) through its registry-ID
 * computation, which cannot bundle into client components. Server
 * pages (Live, Alerts, Country info, badge endpoint) resolve here;
 * client code (shell, Live client props) receives the resolved zone
 * from the page or uses the client-safe resolver — never this file.
 */
import { PRODUCTION_DESTINATION_SEEDS } from "@/lib/roamly/engine/packs/destinations";
import {
  resolveTripTimezone,
  type TripTimezoneInput,
  type TripTimezoneResolution
} from "@/lib/roamly/tripTimezone";

const SEED_ZONES = PRODUCTION_DESTINATION_SEEDS.map((seed) => ({
  displayName: seed.displayName,
  city: seed.displayName,
  label: `${seed.displayName}, ${seed.country}`,
  timeZone: seed.timeZone
}));

export function resolveTripTimezoneServer(input: TripTimezoneInput): TripTimezoneResolution {
  return resolveTripTimezone(input, SEED_ZONES);
}
