/**
 * tripGapWatcher.ts — server-side trip-gap detection and offer selection.
 *
 * For a paid/active (companion-eligible) trip, inspects booking segments and
 * detects gaps: flight booked but no hotel, hotel but no transfer,
 * international destination but no eSIM, no tours, no car, generic gear.
 *
 * Surfaces:
 *  - dismissible gap cards on the itinerary page (via the gaps API route)
 *  - the lane-A FYI email (detectAndOfferTripGaps: one offer per call)
 *  - Live Companion FYI pipe (in-app notification; upsell never pushes)
 *
 * Guardrails (Junel, HARD):
 *  - follow the traveler's own preferences (traveler_memory profile; never
 *    suggest against stated prefs) — enforced in tripGapCore.
 *  - one offer per gap; dismissed gaps stay dismissed (roamly_trip_gap_cards).
 *  - frequency caps in the FYI layer; this module never sends anything itself.
 *  - affiliate links are exactly the /finds cards' links (findsCommercialConfig
 *    + amazonAffiliate builder). Klook/KKday links are labeled as aid-tagged
 *    browse/search links, never exact products.
 *  - booking-honesty: never invent live availability, prices, or hotel identities.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGapOffer,
  detectTripGaps,
  type GapBookingInput,
  type GapOffer,
  type GapPreferenceInput,
  type TripGapType
} from "@/lib/roamly/tripGapCore";
import { buildTravelerPersonalizationContext } from "@/lib/roamly/travelerPersonalization";
import { getTravelerMemory } from "@/lib/roamly/travelerMemory";
import { buildAmazonSearchUrl } from "@/lib/roamly/amazonAffiliate";
import { getTripDestinationLabel } from "@/lib/roamly/tripMetadata";

export type GapWatcherTrip = {
  id: string;
  user_id: string;
  destination_name?: string | null;
  metadata?: unknown;
};

export type GapOfferResult =
  | { ok: true; offer: GapOffer | null; gap: TripGapType | null; gaps: TripGapType[] }
  | { ok: false; error: string };

export type TripGapCard = GapOffer & {
  gap: TripGapType;
  reason: string;
  dismissed: boolean;
};

type GapCardRow = {
  trip_id: string;
  gap_type: string;
  surfaced_at: string | null;
  dismissed_at: string | null;
  last_offered_at: string | null;
  offer_count: number | null;
};

function gapPreferenceInput(ctx: ReturnType<typeof buildTravelerPersonalizationContext>): GapPreferenceInput {
  return {
    accepted: ctx.accepted as Record<string, unknown>,
    inferred: ctx.inferred as Record<string, unknown>,
    enabled: ctx.enabled
  };
}

async function loadPreferences(supabase: SupabaseClient, userId: string): Promise<GapPreferenceInput> {
  try {
    const memory = await getTravelerMemory(supabase, userId);
    const profile = (memory as { profile?: { personalization_enabled?: boolean | null; confirmed_preferences?: Record<string, unknown> | null; inferred_preferences?: Record<string, unknown> | null } | null } | null)?.profile || null;
    return gapPreferenceInput(buildTravelerPersonalizationContext(profile));
  } catch {
    return { accepted: {}, inferred: {}, enabled: false };
  }
}

async function loadBookings(supabase: SupabaseClient, userId: string, tripId: string): Promise<GapBookingInput[]> {
  const result = await supabase
    .from("roamly_bookings")
    .select("booking_type,booking_status,origin,destination,provider_name")
    .eq("user_id", userId)
    .eq("trip_id", tripId);
  if (result.error) throw new Error(result.error.message);
  return ((result.data || []) as Array<Record<string, unknown>>).map((row) => ({
    bookingType: typeof row.booking_type === "string" ? row.booking_type : null,
    bookingStatus: typeof row.booking_status === "string" ? row.booking_status : null,
    origin: typeof row.origin === "string" ? row.origin : null,
    destination: typeof row.destination === "string" ? row.destination : null,
    provider: typeof row.provider_name === "string" ? row.provider_name : null
  }));
}

function planningMetadata(metadata: unknown) {
  const root = (metadata || {}) as Record<string, unknown>;
  const planning = (root.planning || root.trip_planning || {}) as Record<string, unknown>;
  return planning;
}

async function loadDismissedGaps(supabase: SupabaseClient, tripId: string): Promise<Set<string>> {
  try {
    const result = await supabase
      .from("roamly_trip_gap_cards")
      .select("gap_type")
      .eq("trip_id", tripId)
      .not("dismissed_at", "is", null);
    if (result.error) return new Set();
    return new Set(((result.data || []) as Array<{ gap_type: string }>).map((row) => String(row.gap_type)));
  } catch {
    return new Set(); // fail-soft: table missing => nothing dismissed
  }
}

async function recordGapSurfaced(
  supabase: SupabaseClient,
  tripId: string,
  gap: TripGapType
): Promise<void> {
  try {
    await supabase.from("roamly_trip_gap_cards").upsert(
      {
        trip_id: tripId,
        gap_type: gap,
        surfaced_at: new Date().toISOString(),
        last_offered_at: new Date().toISOString(),
        dismissed_at: null
      },
      { onConflict: "trip_id,gap_type", ignoreDuplicates: false }
    );
  } catch {
    // fail-soft: cards still render; surfacing just isn't persisted
  }
}

export async function getTripGapCards(params: {
  supabase: SupabaseClient;
  userId: string;
  trip: GapWatcherTrip;
}): Promise<TripGapCard[]> {
  const { supabase, userId, trip } = params;
  const [bookings, preferences, dismissed] = await Promise.all([
    loadBookings(supabase, userId, trip.id),
    loadPreferences(supabase, userId),
    loadDismissedGaps(supabase, trip.id)
  ]);
  const planning = planningMetadata(trip.metadata);
  const tripInput = {
    tripId: trip.id,
    destinationCountry:
      (typeof planning.destinationCountry === "string" && planning.destinationCountry) ||
      (typeof planning.destination_country === "string" && planning.destination_country) ||
      null,
    originCountry:
      (typeof planning.originCountry === "string" && planning.originCountry) ||
      (typeof planning.origin_country === "string" && planning.origin_country) ||
      null,
    destinationLabel: getTripDestinationLabel({ destination_name: trip.destination_name, metadata: trip.metadata })
  };
  const gaps = detectTripGaps({ trip: tripInput, bookings, preferences });
  const amazonSearch = (query: string) => {
    try {
      return buildAmazonSearchUrl(query);
    } catch {
      return `https://www.amazon.com/s?k=${encodeURIComponent(query)}`;
    }
  };
  return gaps.map((gap) => ({
    ...buildGapOffer(gap.type, tripInput, amazonSearch),
    gap: gap.type,
    reason: gap.reason,
    dismissed: dismissed.has(gap.type)
  }));
}

/**
 * Lane-A FYI entry point: returns the single highest-priority offer for this
 * trip right now (or null when there is nothing to offer). Dismissed gaps are
 * skipped; preference-suppressed gaps never appear (enforced in tripGapCore).
 * Records the surfacing so the itinerary page can show "already offered".
 */
export async function detectAndOfferTripGaps(params: {
  supabase: SupabaseClient;
  userId: string;
  trip: GapWatcherTrip;
}): Promise<GapOfferResult> {
  try {
    const cards = await getTripGapCards(params);
    const visible = cards.filter((card) => !card.dismissed);
    const gaps = visible.map((card) => card.gap);
    const first = visible[0];
    if (!first) return { ok: true, offer: null, gap: null, gaps };
    await recordGapSurfaced(params.supabase, params.trip.id, first.gap);
    const offer: GapOffer = {
      type: first.type,
      eyebrow: first.eyebrow,
      title: first.title,
      description: first.description,
      href: first.href,
      ctaLabel: first.ctaLabel,
      providerLabel: first.providerLabel,
      widget: first.widget,
      amazonQuery: first.amazonQuery,
      disclosure: first.disclosure
    };
    return { ok: true, offer, gap: first.gap, gaps };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Gap watcher failed." };
  }
}

export async function dismissTripGap(params: {
  supabase: SupabaseClient;
  userId: string;
  tripId: string;
  gapType: TripGapType;
}): Promise<{ ok: boolean; error?: string }> {
  // Ownership check: the trip must belong to the user.
  const tripResult = await params.supabase
    .from("roamly_trips")
    .select("id")
    .eq("id", params.tripId)
    .eq("user_id", params.userId)
    .maybeSingle();
  if (tripResult.error) return { ok: false, error: tripResult.error.message };
  if (!tripResult.data) return { ok: false, error: "Trip not found." };
  try {
    const result = await params.supabase.from("roamly_trip_gap_cards").upsert(
      {
        trip_id: params.tripId,
        gap_type: params.gapType,
        dismissed_at: new Date().toISOString()
      },
      { onConflict: "trip_id,gap_type", ignoreDuplicates: false }
    );
    if (result.error) return { ok: false, error: result.error.message };
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Dismiss failed." };
  }
}

export type { GapCardRow };
