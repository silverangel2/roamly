import "server-only";
import { buildAmazonSearchUrl, getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { resolveHouseAdLanding } from "@/lib/houseAds";

/**
 * Server-side landing resolution for house ad clicks.
 *
 * Default landings come from lib/houseAds.ts. One override: the gadget
 * card cross-promotes ReviewIntel by default, but if Roamly's own Amazon
 * affiliate gate is enabled in this environment (ROAMLY_AMAZON_ENABLED
 * plus ROAMLY_AMAZON_ASSOCIATE_TAG), the same card earns directly through
 * Roamly's existing tagged Amazon search builder instead.
 */
export function resolveHouseAdClickLanding(id: string): string | null {
  if (id === "gadget-earbuds" && getAmazonAffiliateConfig().enabled) {
    return buildAmazonSearchUrl("wireless earbuds");
  }
  return resolveHouseAdLanding(id);
}
