import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildPreviewFromItinerary,
  createMapLink,
  type RoamlyItinerary,
  type RoamlyPreview
} from "@/lib/itinerary";

export type RoamlyTripRecord = {
  id: string;
  user_id: string;
  title: string | null;
  destination: string;
  destination_name?: string | null;
  destination_country?: string | null;
  destination_region?: string | null;
  destination_city?: string | null;
  origin?: string | null;
  start_date: string | null;
  end_date: string | null;
  days_count: number | null;
  travelers_count?: number | null;
  budget_amount: number | null;
  budget_currency: string;
  budget_includes_flights?: boolean | null;
  budget_includes_hotel?: boolean | null;
  travel_style: string | null;
  interests: string[] | null;
  accommodation_preference: string | null;
  transportation_preference: string | null;
  special_notes: string | null;
  status: string;
  is_activated: boolean;
  activated_at: string | null;
  itinerary_status?: string | null;
  itinerary_locked?: boolean | null;
  itinerary_locked_at?: string | null;
  itinerary_generated_at?: string | null;
  itinerary_unlock_source?: string | null;
  itinerary_payment_status?: string | null;
  stripe_checkout_session_id?: string | null;
  stripe_payment_intent_id?: string | null;
  tracking_unlocked?: boolean | null;
  live_companion_unlocked?: boolean | null;
  live_companion_unlocked_at?: string | null;
  live_companion_source?: string | null;
  trip_companion_status?: string | null;
  travel_country_info?: Record<string, unknown> | null;
  packing_checklist?: unknown[] | null;
  document_checklist?: unknown[] | null;
  latest_price_discovery_id?: string | null;
  tracking_unlock_source?: string | null;
  tracking_paid_at?: string | null;
  tracking_stripe_checkout_session_id?: string | null;
  tracking_stripe_payment_intent_id?: string | null;
  created_at: string;
  updated_at: string;
  metadata?: Record<string, unknown> | null;
};

export type ItineraryRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  ai_summary: string | null;
  full_json: RoamlyItinerary;
  preview_json: RoamlyPreview;
  created_at: string;
  updated_at: string;
};

export type DayRecord = {
  id: string;
  trip_id: string;
  day_number: number;
  date: string | null;
  title: string | null;
  summary: string | null;
  morning_plan: string | null;
  afternoon_plan: string | null;
  evening_plan: string | null;
  food_suggestions: string | null;
  transport_notes: string | null;
  estimated_cost: number | null;
};

export type ActivityRecord = {
  id: string;
  trip_id: string;
  day_number: number;
  time_label: string | null;
  title: string;
  description: string | null;
  location_name: string | null;
  estimated_cost: number | null;
  category: string | null;
  map_query: string | null;
  status: "planned" | "active" | "nearby" | "checked_in" | "completed" | "skipped" | "missed";
  checked_in_at?: string | null;
  completed_at?: string | null;
};

export type ChecklistRecord = {
  id: string;
  trip_id: string;
  user_id: string;
  item: string;
  category: string | null;
  is_done: boolean;
};

export type TripBundle = {
  trip: RoamlyTripRecord;
  itinerary: ItineraryRecord | null;
  days: DayRecord[];
  activities: ActivityRecord[];
  checklist: ChecklistRecord[];
};

export function isMissingTableError(message?: string | null) {
  return Boolean(
    message &&
      (message.includes("roamly_") ||
        message.includes("schema cache") ||
        message.toLowerCase().includes("does not exist"))
  );
}

export async function getTripBundle(
  supabase: SupabaseClient,
  userId: string,
  tripId: string
): Promise<{ data: TripBundle | null; error?: string }> {
  const { data: trip, error: tripError } = await supabase
    .from("roamly_trips")
    .select("*")
    .eq("id", tripId)
    .eq("user_id", userId)
    .maybeSingle();

  if (tripError) return { data: null, error: tripError.message };
  if (!trip) return { data: null, error: "Trip not found." };

  const [{ data: itinerary, error: itineraryError }, { data: days }, { data: activities }, { data: checklist }] =
    await Promise.all([
      supabase
        .from("roamly_itineraries")
        .select("*")
        .eq("trip_id", tripId)
        .eq("user_id", userId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase.from("roamly_itinerary_days").select("*").eq("trip_id", tripId).order("day_number"),
      supabase.from("roamly_trip_activities").select("*").eq("trip_id", tripId).order("day_number").order("created_at"),
      supabase.from("roamly_trip_checklists").select("*").eq("trip_id", tripId).eq("user_id", userId).order("created_at")
    ]);

  if (itineraryError && !itineraryError.message.includes("0 rows")) {
    return { data: null, error: itineraryError.message };
  }

  return {
    data: {
      trip: trip as RoamlyTripRecord,
      itinerary: (itinerary as ItineraryRecord | null) ?? null,
      days: (days as DayRecord[] | null) ?? [],
      activities: (activities as ActivityRecord[] | null) ?? [],
      checklist: (checklist as ChecklistRecord[] | null) ?? []
    }
  };
}

export async function syncGeneratedItinerary(
  supabase: SupabaseClient,
  params: {
    tripId: string;
    userId: string;
    itinerary: RoamlyItinerary;
    status?: "preview" | "generated" | "locked";
  }
) {
  const preview = buildPreviewFromItinerary(params.itinerary);

  const existing = await supabase
    .from("roamly_itineraries")
    .select("id")
    .eq("trip_id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();

  const payload = {
    trip_id: params.tripId,
    user_id: params.userId,
    ai_summary: params.itinerary.destination_summary,
    full_json: params.itinerary,
    preview_json: preview
  };

  const itineraryResult = existing.data?.id
    ? await supabase.from("roamly_itineraries").update(payload).eq("id", existing.data.id).select("id").single()
    : await supabase.from("roamly_itineraries").insert(payload).select("id").single();

  if (itineraryResult.error) return { error: itineraryResult.error.message };

  await Promise.all([
    supabase.from("roamly_itinerary_days").delete().eq("trip_id", params.tripId),
    supabase.from("roamly_trip_activities").delete().eq("trip_id", params.tripId),
    supabase.from("roamly_trip_checklists").delete().eq("trip_id", params.tripId).eq("user_id", params.userId),
    supabase.from("roamly_trip_days").delete().eq("trip_id", params.tripId).then((result) => {
      if (result.error && !isMissingTableError(result.error.message)) console.error(result.error.message);
      return result;
    }),
    supabase.from("roamly_activities").delete().eq("trip_id", params.tripId).then((result) => {
      if (result.error && !isMissingTableError(result.error.message)) console.error(result.error.message);
      return result;
    })
  ]);

  if (params.itinerary.daily_itinerary.length) {
    const daysResult = await supabase.from("roamly_itinerary_days").insert(
      params.itinerary.daily_itinerary.map((day) => ({
        trip_id: params.tripId,
        day_number: day.day_number,
        date: day.date || null,
        title: day.title,
        summary: [day.morning, day.afternoon, day.evening].filter(Boolean).join(" "),
        morning_plan: day.morning,
        afternoon_plan: day.afternoon,
        evening_plan: day.evening,
        food_suggestions: day.food.join(" | "),
        transport_notes: day.map_queries.slice(0, 2).join(" | "),
        estimated_cost: day.estimated_cost
      }))
    );
    if (daysResult.error) return { error: daysResult.error.message };
  }

  const activities = params.itinerary.daily_itinerary.flatMap((day) =>
    day.live_timeline.map((activity) => ({
      trip_id: params.tripId,
      day_number: day.day_number,
      time_label: activity.time_label,
      title: activity.title,
      description: activity.description,
      location_name: activity.location_name,
      estimated_cost: activity.estimated_cost,
      category: activity.category,
      map_query: activity.map_query,
      status: "planned"
    }))
  );

  if (activities.length) {
    const activityResult = await supabase.from("roamly_trip_activities").insert(activities);
    if (activityResult.error) return { error: activityResult.error.message };
  }

  const trackingDays = await supabase
    .from("roamly_trip_days")
    .insert(
      params.itinerary.daily_itinerary.map((day) => ({
        trip_id: params.tripId,
        day_number: day.day_number,
        date: day.date || null,
        title: day.title,
        summary: [day.morning, day.afternoon, day.evening].filter(Boolean).join(" ")
      }))
    )
    .select("id,day_number");

  if (trackingDays.error && !isMissingTableError(trackingDays.error.message)) {
    return { error: trackingDays.error.message };
  }

  const dayIdByNumber = new Map(
    ((trackingDays.data || []) as Array<{ id: string; day_number: number }>).map((day) => [day.day_number, day.id])
  );
  const trackingActivities = params.itinerary.daily_itinerary.flatMap((day) =>
    day.live_timeline.map((activity, index) => ({
      trip_id: params.tripId,
      trip_day_id: dayIdByNumber.get(day.day_number) || null,
      title: activity.title,
      description: activity.description,
      category: activity.category,
      address: activity.location_name,
      city: day.city || null,
      region: null,
      country: null,
      latitude: null,
      longitude: null,
      radius_meters: 250,
      scheduled_start: null,
      scheduled_end: null,
      sort_order: day.day_number * 100 + index,
      status: "planned",
      metadata: {
        time_label: activity.time_label,
        estimated_cost: activity.estimated_cost,
        map_query: activity.map_query
      }
    }))
  );

  if (trackingActivities.length) {
    const trackingActivityResult = await supabase.from("roamly_activities").insert(trackingActivities);
    if (trackingActivityResult.error && !isMissingTableError(trackingActivityResult.error.message)) {
      return { error: trackingActivityResult.error.message };
    }
  }

  if (params.itinerary.packing_checklist.length) {
    const checklistResult = await supabase.from("roamly_trip_checklists").insert(
      params.itinerary.packing_checklist.map((item) => ({
        trip_id: params.tripId,
        user_id: params.userId,
        item,
        category: "Packing",
        is_done: false
      }))
    );
    if (checklistResult.error) return { error: checklistResult.error.message };
  }

  const tripUpdate = await supabase
    .from("roamly_trips")
    .update({
      title: params.itinerary.trip_title,
      status: params.status || "preview",
      destination_name: params.itinerary.trip_title
    })
    .eq("id", params.tripId)
    .eq("user_id", params.userId);

  if (tripUpdate.error) return { error: tripUpdate.error.message };

  return { error: null };
}

export async function getTodayUsage(supabase: SupabaseClient, userId: string) {
  const today = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("roamly_trip_usage")
    .select("id,itinerary_generations")
    .eq("user_id", userId)
    .eq("usage_date", today)
    .maybeSingle();

  return {
    today,
    count: typeof data?.itinerary_generations === "number" ? data.itinerary_generations : 0,
    id: data?.id as string | undefined,
    error: error?.message
  };
}

export async function getWeeklyUsage(supabase: SupabaseClient, userId: string) {
  const now = new Date();
  const periodEnd = now.toISOString().slice(0, 10);
  const periodStartDate = new Date(now);
  periodStartDate.setUTCDate(periodStartDate.getUTCDate() - 6);
  const periodStart = periodStartDate.toISOString().slice(0, 10);

  const { data, error } = await supabase
    .from("roamly_trip_usage")
    .select("itinerary_generations,usage_date")
    .eq("user_id", userId)
    .gte("usage_date", periodStart)
    .lte("usage_date", periodEnd);

  return {
    periodStart,
    periodEnd,
    count: ((data || []) as Array<{ itinerary_generations: number | null }>).reduce(
      (sum, row) => sum + (row.itinerary_generations || 0),
      0
    ),
    error: error?.message
  };
}

export async function incrementTodayUsage(supabase: SupabaseClient, userId: string) {
  const usage = await getTodayUsage(supabase, userId);
  if (usage.id) {
    return supabase
      .from("roamly_trip_usage")
      .update({ itinerary_generations: usage.count + 1 })
      .eq("id", usage.id)
      .eq("user_id", userId);
  }

  return supabase.from("roamly_trip_usage").insert({
    user_id: userId,
    usage_date: usage.today,
    itinerary_generations: 1
  });
}

export function groupActivitiesByDay(activities: ActivityRecord[]) {
  return activities.reduce<Record<number, ActivityRecord[]>>((acc, activity) => {
    acc[activity.day_number] ||= [];
    acc[activity.day_number].push(activity);
    return acc;
  }, {});
}

export function tripMapLinks(queries: string[]) {
  return queries.map((query) => ({ query, href: createMapLink(query) }));
}
