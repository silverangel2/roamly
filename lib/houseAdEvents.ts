import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { HOUSE_AD_SITE, type HouseAdEvent } from "@/lib/houseAds";

/**
 * Server-side writer for house_ad_events (see the migration in
 * supabase/migrations). Fail-soft by design: counting must never break a
 * page render or a click redirect, so an unwired local environment simply
 * records nothing and reports false.
 */
export async function recordHouseAdEvent(event: HouseAdEvent): Promise<boolean> {
  const client = createSupabaseAdminClient();
  if (!client) return false;
  try {
    const { error } = await client.from("house_ad_events").insert({
      site: HOUSE_AD_SITE,
      creative_id: event.creativeId,
      event_type: event.eventType,
      page_path: event.pagePath,
    });
    return !error;
  } catch {
    return false;
  }
}
