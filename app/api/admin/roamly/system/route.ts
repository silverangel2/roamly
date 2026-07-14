import { NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";
import { isEmailConfigured } from "@/lib/roamly/email";
import { getRoamlyLaunchReadiness } from "@/lib/roamly/launchReadiness";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { getRoamlySocialEnvStatus } from "@/lib/roamly/social";
import { ensureRoamlyProfile, getRoamlyProfileTableStatus, getRoamlyUserAppStatus } from "@/lib/roamly/profile";

const tables = [
  "roamly_profiles",
  "roamly_trips",
  "roamly_trip_days",
  "roamly_activities",
  "roamly_trip_events",
  "roamly_location_settings",
  "roamly_app_events",
  "roamly_price_discoveries",
  "roamly_bookings",
  "companion_events",
  "companion_repair_proposals",
  "companion_repair_actions",
  "booking_segments",
  "roamly_push_subscriptions",
  "roamly_notifications",
  "roamly_companion_notification_deliveries"
];

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const tableChecks = await Promise.all(
    tables.map(async (table) => {
      const { error } = await guard.admin.from(table).select("id", { count: "exact", head: true });
      return { table, ok: !error, error: error?.message || null };
    })
  );
  const profileTableStatus = await getRoamlyProfileTableStatus(guard.admin);
  await ensureRoamlyProfile(guard.user, {}, guard.admin);
  const appStatus = await getRoamlyUserAppStatus(guard.user, guard.admin);

  const since = new Date();
  since.setHours(0, 0, 0, 0);

  const [
    recentEvents,
    locationEnabled,
    activeTrips,
    notifications,
    priceDiscoveries,
    pushSubscriptions,
    companionEvents,
    companionNotificationDeliveries,
    failedCompanionDeliveries,
    lastNotification,
    lastNotificationFailure,
    locationSettings,
    lastLocation
  ] = await Promise.all([
    guard.admin.from("roamly_trip_events").select("id", { count: "exact", head: true }),
    guard.admin
      .from("roamly_location_settings")
      .select("id", { count: "exact", head: true })
      .eq("location_tracking_enabled", true),
    guard.admin.from("roamly_trips").select("id", { count: "exact", head: true }).eq("status", "active"),
    guard.admin.from("roamly_notifications").select("id", { count: "exact", head: true }),
    guard.admin.from("roamly_price_discoveries").select("id", { count: "exact", head: true }),
    guard.admin.from("roamly_push_subscriptions").select("id", { count: "exact", head: true }).eq("enabled", true),
    guard.admin.from("companion_events").select("id", { count: "exact", head: true }),
    guard.admin
      .from("roamly_companion_notification_deliveries")
      .select("id", { count: "exact", head: true }),
    guard.admin
      .from("roamly_companion_notification_deliveries")
      .select("id", { count: "exact", head: true })
      .eq("status", "failed"),
    guard.admin.from("roamly_notifications").select("id,title,created_at,sent_at,push_status").order("created_at", { ascending: false }).limit(1).maybeSingle(),
    guard.admin
      .from("roamly_notifications")
      .select("id,title,created_at,push_error,push_status")
      .not("push_error", "is", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    guard.admin.from("roamly_location_settings").select("id", { count: "exact", head: true }),
    guard.admin
      .from("roamly_location_settings")
      .select("id,last_seen_at,last_permission_state")
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  return NextResponse.json({
    ok: true,
    diagnostics: {
      supabaseConfigured: true,
      sharedSupabaseAuthMode: true,
      sharedAuthCopy: "Roamly uses its own profile records even when Supabase Auth is shared.",
      roamlyProfileTableAvailable: profileTableStatus.available,
      currentUserAppStatus: appStatus,
      tables: tableChecks,
      recentEventsCount: recentEvents.count || 0,
      locationTrackingEnabledCount: locationEnabled.count || 0,
      activeTripCount: activeTrips.count || 0,
      notificationCount: notifications.count || 0,
      priceDiscoveryCount: priceDiscoveries.count || 0,
      pushSubscriptionCount: pushSubscriptions.count || 0,
      companionEventCount: companionEvents.count || 0,
      companionNotificationDeliveryCount:
        companionNotificationDeliveries.count || 0,
      failedCompanionDeliveryCount:
        failedCompanionDeliveries.count || 0,
      lastNotification: lastNotification.data || null,
      lastNotificationFailure: lastNotificationFailure.data || null,
      locationSettingsCount: locationSettings.count || 0,
      lastLocationUpdate: lastLocation.data || null,
      affiliates: getAffiliateReadiness(),
      email: isEmailConfigured(),
      social: getRoamlySocialEnvStatus(),
      launchReadiness: getRoamlyLaunchReadiness(getRoamlyAccessForUser(guard.user.email)),
      env: {
        stripeItineraryConfigured: Boolean(process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID || process.env.ROAMLY_STRIPE_ITINERARY_UNLOCK_PRICE_ID),
        stripeFeaturesConfigured: Boolean(process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID || process.env.ROAMLY_STRIPE_TRACKING_ADDON_PRICE_ID),
        stripeCompleteTripConfigured: Boolean(process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID || process.env.ROAMLY_STRIPE_TRIP_BUNDLE_PRICE_ID),
        openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
        notificationCronConfigured: Boolean(process.env.ROAMLY_NOTIFICATION_CRON_SECRET),
        generationCronConfigured: Boolean(process.env.ROAMLY_GENERATION_CRON_SECRET || process.env.CRON_SECRET),
        supportEmailConfigured: Boolean(process.env.ROAMLY_SUPPORT_EMAIL),
        fromEmailConfigured: Boolean(process.env.ROAMLY_FROM_EMAIL),
        socialCronConfigured: Boolean(process.env.ROAMLY_SOCIAL_CRON_SECRET)
      }
    }
  });
}
