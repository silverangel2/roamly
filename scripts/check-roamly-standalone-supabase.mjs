import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();

const requiredColumns = {
  roamly_profiles: [
    "id",
    "user_id",
    "email",
    "full_name",
    "avatar_url",
    "auth_provider",
    "first_seen_at",
    "last_seen_at",
    "metadata",
    "created_at",
    "updated_at"
  ],
  roamly_trips: [
    "id",
    "user_id",
    "title",
    "destination",
    "destination_name",
    "destination_country",
    "destination_region",
    "destination_city",
    "origin",
    "start_date",
    "end_date",
    "days_count",
    "travelers_count",
    "budget_amount",
    "budget_currency",
    "budget_includes_flights",
    "budget_includes_hotel",
    "travel_style",
    "interests",
    "accommodation_preference",
    "transportation_preference",
    "special_notes",
    "status",
    "is_activated",
    "activated_at",
    "itinerary_status",
    "itinerary_locked",
    "itinerary_locked_at",
    "itinerary_generated_at",
    "itinerary_unlock_source",
    "itinerary_payment_status",
    "stripe_checkout_session_id",
    "stripe_payment_intent_id",
    "tracking_unlocked",
    "tracking_unlock_source",
    "tracking_paid_at",
    "tracking_stripe_checkout_session_id",
    "tracking_stripe_payment_intent_id",
    "latest_price_discovery_id",
    "live_companion_unlocked",
    "live_companion_unlocked_at",
    "live_companion_source",
    "travel_country_info",
    "packing_checklist",
    "document_checklist",
    "countdown_started_at",
    "trip_companion_status",
    "metadata",
    "created_at",
    "updated_at"
  ],
  roamly_itineraries: ["id", "trip_id", "user_id", "ai_summary", "full_json", "preview_json", "created_at", "updated_at"],
  roamly_itinerary_days: [
    "id",
    "trip_id",
    "day_number",
    "date",
    "title",
    "summary",
    "morning_plan",
    "afternoon_plan",
    "evening_plan",
    "food_suggestions",
    "transport_notes",
    "estimated_cost",
    "created_at",
    "updated_at"
  ],
  roamly_trip_activities: [
    "id",
    "trip_id",
    "day_number",
    "time_label",
    "title",
    "description",
    "location_name",
    "estimated_cost",
    "category",
    "map_query",
    "status",
    "checked_in_at",
    "completed_at",
    "metadata",
    "created_at",
    "updated_at"
  ],
  roamly_trip_checklists: ["id", "trip_id", "user_id", "item", "category", "is_done", "created_at"],
  roamly_trip_usage: ["id", "user_id", "usage_date", "itinerary_generations", "created_at", "updated_at"],
  roamly_trip_payments: [
    "id",
    "user_id",
    "trip_id",
    "stripe_session_id",
    "stripe_payment_intent",
    "amount",
    "currency",
    "status",
    "created_at"
  ],
  roamly_admin_settings: ["id", "key", "value", "updated_at"],
  roamly_trip_days: ["id", "trip_id", "day_number", "date", "title", "summary", "created_at"],
  roamly_activities: [
    "id",
    "trip_id",
    "trip_day_id",
    "title",
    "description",
    "category",
    "address",
    "city",
    "region",
    "country",
    "latitude",
    "longitude",
    "radius_meters",
    "scheduled_start",
    "scheduled_end",
    "sort_order",
    "status",
    "checked_in_at",
    "completed_at",
    "created_at",
    "updated_at",
    "metadata"
  ],
  roamly_trip_events: [
    "id",
    "user_id",
    "trip_id",
    "activity_id",
    "event_type",
    "event_title",
    "event_body",
    "latitude",
    "longitude",
    "distance_meters",
    "created_at",
    "metadata"
  ],
  roamly_location_settings: [
    "id",
    "user_id",
    "location_tracking_enabled",
    "notification_enabled",
    "last_permission_state",
    "last_seen_latitude",
    "last_seen_longitude",
    "last_seen_at",
    "created_at",
    "updated_at"
  ],
  roamly_app_events: [
    "id",
    "created_at",
    "user_id",
    "visitor_key",
    "event_type",
    "path",
    "url",
    "title",
    "referrer",
    "referrer_host",
    "device_type",
    "platform",
    "browser",
    "country",
    "region",
    "city",
    "metadata"
  ],
  roamly_user_entitlements: ["id", "user_id", "free_itinerary_used_at", "free_itinerary_trip_id", "created_at", "updated_at"],
  roamly_itinerary_purchases: [
    "id",
    "user_id",
    "trip_id",
    "purchase_type",
    "amount_cents",
    "currency",
    "stripe_checkout_session_id",
    "stripe_payment_intent_id",
    "status",
    "created_at",
    "paid_at",
    "metadata"
  ],
  roamly_price_discoveries: [
    "id",
    "user_id",
    "trip_id",
    "origin",
    "destination",
    "start_date",
    "end_date",
    "days_count",
    "travelers_count",
    "budget_amount",
    "budget_currency",
    "budget_includes_flights",
    "budget_includes_hotel",
    "flight_estimate_cents",
    "hotel_estimate_cents",
    "activities_estimate_cents",
    "food_estimate_cents",
    "local_transport_estimate_cents",
    "buffer_estimate_cents",
    "total_estimate_cents",
    "remaining_budget_cents",
    "committed_budget_cents",
    "total_budget_cents",
    "includes_flights",
    "includes_hotel",
    "estimated_flight_min_cents",
    "estimated_flight_max_cents",
    "estimated_hotel_min_cents",
    "estimated_hotel_max_cents",
    "estimated_activities_min_cents",
    "estimated_activities_max_cents",
    "estimated_food_min_cents",
    "estimated_food_max_cents",
    "estimated_transport_min_cents",
    "estimated_transport_max_cents",
    "estimated_total_min_cents",
    "estimated_total_max_cents",
    "remaining_budget_min_cents",
    "remaining_budget_max_cents",
    "budget_status",
    "coverage_note",
    "sources",
    "source_summary",
    "metadata",
    "created_at"
  ],
  roamly_bookings: [
    "id",
    "user_id",
    "trip_id",
    "booking_type",
    "provider_name",
    "title",
    "confirmation_number",
    "booking_status",
    "amount_cents",
    "currency",
    "start_date",
    "end_date",
    "start_time",
    "end_time",
    "address",
    "city",
    "region",
    "country",
    "latitude",
    "longitude",
    "raw_extracted_text",
    "extraction_confidence",
    "screenshot_url",
    "metadata",
    "created_at",
    "updated_at"
  ],
  roamly_trip_companion_events: [
    "id",
    "user_id",
    "trip_id",
    "booking_id",
    "event_type",
    "title",
    "body",
    "scheduled_for",
    "completed_at",
    "status",
    "metadata",
    "created_at"
  ],
  roamly_push_subscriptions: ["id", "user_id", "endpoint", "p256dh", "auth", "user_agent", "enabled", "created_at", "updated_at"],
  roamly_notifications: [
    "id",
    "user_id",
    "trip_id",
    "event_id",
    "type",
    "title",
    "body",
    "action_url",
    "status",
    "scheduled_for",
    "sent_at",
    "read_at",
    "push_status",
    "push_error",
    "email_sent_at",
    "email_status",
    "email_error",
    "metadata",
    "created_at"
  ],
  roamly_email_logs: [
    "id",
    "user_id",
    "trip_id",
    "notification_id",
    "to_email",
    "subject",
    "provider",
    "status",
    "provider_message_id",
    "error",
    "metadata",
    "created_at",
    "sent_at"
  ],
  roamly_market_prices: [
    "id",
    "category",
    "provider",
    "source",
    "origin",
    "destination",
    "city",
    "country",
    "start_date",
    "end_date",
    "travelers",
    "rooms",
    "room_type",
    "title",
    "price_amount",
    "price_min",
    "price_max",
    "currency",
    "price_type",
    "confidence",
    "booking_url",
    "normal_search_url",
    "affiliate_url",
    "search_key",
    "searched_at",
    "expires_at",
    "metadata",
    "created_at"
  ]
};

function describeError(error) {
  return [error.code, error.message].filter(Boolean).join(" ");
}

if (!supabaseUrl || !serviceRoleKey) {
  console.error("Missing required env vars:");
  if (!supabaseUrl) console.error("- NEXT_PUBLIC_SUPABASE_URL");
  if (!serviceRoleKey) console.error("- SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const missingTables = [];
const missingColumns = [];
const otherErrors = [];

for (const [table, columns] of Object.entries(requiredColumns)) {
  const tableCheck = await supabase.from(table).select("id", { head: true }).limit(1);
  if (tableCheck.error) {
    missingTables.push(`${table}: ${describeError(tableCheck.error)}`);
    continue;
  }

  for (const column of columns) {
    const columnCheck = await supabase.from(table).select(column, { head: true }).limit(1);
    if (columnCheck.error) {
      const message = describeError(columnCheck.error);
      if (message.toLowerCase().includes("column") || message.includes("PGRST204") || message.includes("42703")) {
        missingColumns.push(`${table}.${column}: ${message}`);
      } else {
        otherErrors.push(`${table}.${column}: ${message}`);
      }
    }
  }
}

if (missingTables.length || missingColumns.length || otherErrors.length) {
  console.error("Roamly standalone Supabase schema is not ready.");
  if (missingTables.length) {
    console.error("\nMissing tables:");
    for (const item of missingTables) console.error(`- ${item}`);
  }
  if (missingColumns.length) {
    console.error("\nMissing columns:");
    for (const item of missingColumns) console.error(`- ${item}`);
  }
  if (otherErrors.length) {
    console.error("\nOther schema check errors:");
    for (const item of otherErrors) console.error(`- ${item}`);
  }
  process.exit(1);
}

console.log(`Roamly standalone Supabase schema is ready at ${new URL(supabaseUrl).host}.`);
console.log(`Checked ${Object.keys(requiredColumns).length} tables.`);
