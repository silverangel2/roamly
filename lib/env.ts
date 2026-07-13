const requiredServerVariables = [
  "OPENAI_API_KEY",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "SUPABASE_SERVICE_ROLE_KEY"
] as const;

const requiredPublicVariables = [
  "NEXT_PUBLIC_APP_URL",
  "NEXT_PUBLIC_SUPABASE_URL"
] as const;

export function getMissingEnvironmentVariables() {
  const missing: string[] = [...requiredServerVariables, ...requiredPublicVariables].filter((key) => !process.env[key]);

  if (!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY && !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    missing.push("NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  }

  return missing;
}

export const roamlyConfig = {
  appName: process.env.NEXT_PUBLIC_ROAMLY_APP_NAME || "Roamly",
  appUrl: process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
  currency: "cad",
  itineraryUnlockPriceCents: 499,
  trackingAddonPriceCents: 399,
  tripBundlePriceCents: 799,
  itineraryUnlockPriceId:
    process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID ||
    process.env.ROAMLY_STRIPE_ITINERARY_UNLOCK_PRICE_ID ||
    process.env.ROAMLY_STRIPE_ACTIVATED_TRIP_PRICE_ID ||
    "",
  trackingAddonPriceId:
    process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID ||
    process.env.ROAMLY_STRIPE_TRACKING_ADDON_PRICE_ID ||
    "",
  tripBundlePriceId:
    process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID ||
    process.env.ROAMLY_STRIPE_TRIP_BUNDLE_PRICE_ID ||
    "",
  vapidPublicKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || "",
  notificationCronSecret: process.env.ROAMLY_NOTIFICATION_CRON_SECRET || "",
  affiliates: {
    enabled: process.env.ROAMLY_AFFILIATES_ENABLED === "true",
    hotelProvider: process.env.ROAMLY_HOTEL_AFFILIATE_PROVIDER || "",
    flightProvider: process.env.ROAMLY_FLIGHT_AFFILIATE_PROVIDER || "",
    attractionsProvider: process.env.ROAMLY_ATTRACTIONS_AFFILIATE_PROVIDER || ""
  }
};
