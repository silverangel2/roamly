/**
 * Roamly Concierge — per-person itinerary customization stage.
 *
 * Runs AFTER itinerary generation, BEFORE the itinerary is shown/saved.
 * Deterministic: same input in → same output out. Zero LLM calls, zero
 * network, zero price edits.
 *
 * What it does:
 *   - pace_adjustment : lighten an over-stuffed day / insert a rest window
 *   - reorder_day     : keep arrival day light
 *   - swap_pick       : re-rank flexible items by traveler interests
 *   - pattern_pick    : surface an existing advance-booking recommendation
 *                       backed by enough trips (presented, never invented)
 *
 * HARD GUARDS (Junel's standing Roamly rules — violating one fails the build):
 *   1. Priority order: confirmed booking > explicit hard requirement >
 *      recommendation > affiliate optimization. Anchors are NEVER moved,
 *      removed, reordered, or overridden.
 *   2. Money is read-only. The module contains no writer for any price or
 *      provenance field (CONFIRMED / LIVE_SEARCH / ESTIMATED / UNKNOWN).
 *      A post-pass invariant (assertPricesUntouched) throws on ANY drift,
 *      and the outer catch then returns the original itinerary reference —
 *      so generator behavior without the Concierge is byte-identical.
 *   3. Entitlements untouched. This module never imports billing and has no
 *      concept of the free-itinerary grant.
 *   4. COLD-START HONESTY: a pattern is invisible unless it is backed by at
 *      least 3 DISTINCT trips (finite sourceTripCount >= 3 AND
 *      sampleCount >= 3). One trip is an anecdote, not a pattern. This is
 *      deliberately stricter than the generator's anecdotal fallback: until
 *      migration 20261015000100 is applied, pattern rows carry no
 *      source_trip_count and the Concierge makes zero suggestions.
 *   5. Aggregate-only learning. Patterns are aggregates by construction;
 *      the Concierge never reads traveler_profiles, traveler_memory,
 *      traveler_preference_events, or any user-identifiable store.
 *
 * Ship path: lib/roamly/concierge/travelerConcierge.ts (this file).
 */

import type {
  RoamlyActivitySeed,
  RoamlyDayPlan,
  RoamlyItinerary
} from "@/lib/itinerary";
import type { ExplicitTravelRequirement, TripPlannerPayload } from "@/lib/trip-planner";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logSuggestionsFireAndForget } from "@/lib/roamly/concierge/conciergeSuggestions";
import { isPublishableSuccessfulTripPattern, type SuccessfulTripExperiencePattern } from "@/lib/roamly/successfulTripExperiencePatterns";
import {
  commentBlockedPhrases,
  commentFoodDetails,
  commentHardRequirementTexts,
  commentInterestBoosts,
  commentRequiresLateStart,
  readPlanComments,
  type PlanComment,
  type UnreadComment
} from "@/lib/roamly/concierge/planCommentReader";

/** Cold-start bar: distinct trips that must stand behind a cited pattern. */
export const CONCIERGE_MIN_DISTINCT_TRIPS = 3;
/** Pattern averages are 1..5 satisfaction scales; 4.0+ counts as "high". */
export const CONCIERGE_HIGH_AVERAGE = 4.0;

export type ConciergeSuggestionKind = "reorder_day" | "swap_pick" | "pace_adjustment" | "pattern_pick";

export type ConciergeTravelerSignals = {
  /** e.g. "Relaxed" | "Balanced" | "Packed" (paceOptions). */
  pace?: string | null;
  /** e.g. ["Food", "Museums"] (tripInterests). */
  interests?: string[];
  /** CAD-anchored band: "budget" | "midrange" | "premium" | "luxury". */
  budgetBand?: string | null;
  travelersCount?: number | null;
  travelStyle?: string | null;
};

export type ConciergeInput = {
  itinerary: RoamlyItinerary;
  /** Generator payload — carries confirmedBookings + explicitRequirements. */
  payload?: TripPlannerPayload | null;
  /** Outline days (StagedTripOutlineDay[]) — used only for arrival/departure. */
  outlineDays?: Array<{ dayNumber: number; arrivalRequirements?: string[]; departureRequirements?: string[] }> | null;
  signals: ConciergeTravelerSignals;
  patterns: SuccessfulTripExperiencePattern[];
  /** Optional: used to stamp stable suggestion ids and the suggestion log. */
  tripId?: string | null;
  /**
   * Optional Supabase client for suggestion logging. When present, the
   * suggestions computed for this itinerary are logged fire-and-forget via
   * logSuggestionsFireAndForget — logging is advisory and never changes the
   * returned itinerary (audit 1C). Absent → logging skipped, honest note.
   */
  supabase?: SupabaseClient | null;
  /**
   * Free-text comments the traveler left on their own plan. An explicit
   * comment requirement is an EXPLICIT HARD REQUIREMENT: it outranks
   * recommendations and pattern picks, below only confirmed bookings.
   * A comment can veto a pattern suggestion; a pattern can never override
   * a comment. Comments that yield no signal surface in
   * output.unreadComments — never the void.
   */
  comments?: PlanComment[] | null;
  /** Internal: set by runEngines from the Comment Reader. Not an input. */
  commentReading?: import("@/lib/roamly/concierge/planCommentReader").CommentReading;
};

export type ConciergeSuggestion = {
  /** Stable, deterministic: tripId:kind:day:itemRef */
  id: string;
  kind: ConciergeSuggestionKind;
  dayNumber?: number;
  /** Stable identity of the affected item (item_id, else title). */
  itemRef?: string;
  /** Short traveler-facing title. */
  title: string;
  /** Plain-language reason a traveler understands in one read. */
  reason: string;
  /** Distinct trips backing the cited pattern. */
  patternBacking: number;
  patternKey?: string;
  /** true = applied to the returned itinerary; false = presented option. */
  applied: boolean;
};

export type ConciergeOutput = {
  itinerary: RoamlyItinerary;
  suggestions: ConciergeSuggestion[];
  /** Traveler-facing notes that are not itinerary edits. */
  notes: string[];
  /** Comments the reader could not classify — human eyes only. */
  unreadComments: UnreadComment[];
  /** Present only when the Concierge bailed out (fail-soft). */
  error?: string;
};

/* ── Pattern gating ─────────────────────────────────────────────── */

function distinctTrips(pattern: SuccessfulTripExperiencePattern): number | null {
  const trips = pattern.sourceTripCount;
  return typeof trips === "number" && Number.isFinite(trips) ? trips : null;
}

/**
 * A pattern may back a Concierge suggestion only when at least
 * CONCIERGE_MIN_DISTINCT_TRIPS distinct trips stand behind it.
 * Deliberately stricter than isPublishableSuccessfulTripPattern's
 * sampleCount-only fallback: with no finite source_trip_count the pattern
 * is invisible, not "probably fine".
 */
export function conciergePublishable(pattern: SuccessfulTripExperiencePattern): boolean {
  if (!isPublishableSuccessfulTripPattern(pattern, CONCIERGE_MIN_DISTINCT_TRIPS)) return false;
  const trips = distinctTrips(pattern);
  return trips !== null && trips >= CONCIERGE_MIN_DISTINCT_TRIPS;
}

function usablePatterns(patterns: SuccessfulTripExperiencePattern[]): SuccessfulTripExperiencePattern[] {
  return (Array.isArray(patterns) ? patterns : []).filter(conciergePublishable);
}

function patternTripCount(pattern: SuccessfulTripExperiencePattern): number {
  return distinctTrips(pattern) ?? pattern.sampleCount;
}

/* ── Anchor / money protection ──────────────────────────────────── */

const PROTECTED_ROLES = new Set(["protected_anchor", "must_do"]);
const PROTECTED_ITEM_TYPES = new Set(["booking", "travel", "transfer", "hotel"]);

function hardRequirementTexts(payload?: TripPlannerPayload | null): string[] {
  const out: string[] = [];
  const collect = (requirements: ExplicitTravelRequirement[] | undefined) => {
    for (const requirement of requirements || []) {
      if (!requirement || requirement.priority !== "hard") continue;
      const text =
        requirement.type === "flight"
          ? [requirement.airline, requirement.airport].filter(Boolean).join(" ")
          : requirement.request;
      if (typeof text === "string" && text.trim()) {
        out.push(text.trim().toLowerCase());
      }
    }
  };
  collect(payload?.explicitRequirements);
  collect(payload?.constraints?.activity?.explicitRequestedActivities);
  collect(payload?.constraints?.activity?.mustDoActivities);
  return out;
}

function matchesHardRequirement(item: RoamlyActivitySeed, hardTexts: string[]): boolean {
  if (!hardTexts.length) return false;
  const haystack = `${item.title || ""} ${item.description || ""} ${item.location_name || ""}`.toLowerCase();
  return hardTexts.some((text) => text.length >= 4 && haystack.includes(text));
}

/** An item the Concierge may never move, reorder, or override. */
function isProtectedItem(item: RoamlyActivitySeed, hardTexts: string[]): boolean {
  if (!item || typeof item !== "object") return true;
  if (item.item_type && PROTECTED_ITEM_TYPES.has(item.item_type)) return true;
  if (item.plan_role && PROTECTED_ROLES.has(item.plan_role)) return true;
  if (item.must_do === true) return true;
  return matchesHardRequirement(item, hardTexts);
}

/** Items eligible for Concierge reshaping: activities/meals/rest, flexible. */
function isFlexibleItem(item: RoamlyActivitySeed, hardTexts: string[]): boolean {
  if (isProtectedItem(item, hardTexts)) return false;
  const role = item.plan_role;
  return role === undefined || role === "primary" || role === "supporting" || role === "meal" || role === "rest";
}

/** True when the traveler explicitly rejected this pick in a comment. */
function matchesBlockedPhrases(item: RoamlyActivitySeed, blocked: string[]): boolean {
  if (!blocked.length) return false;
  const haystack = `${item.title || ""} ${item.category || ""} ${item.description || ""} ${item.location_name || ""}`.toLowerCase();
  return blocked.some((phrase) => phrase.length >= 4 && haystack.includes(phrase));
}

/** Start hour (0-23) of a timeline item or booking candidate, if parseable. */
function startHourOf(value: { startTime?: string; event_start_time?: string; time_label?: string } | null | undefined): number | null {
  if (!value) return null;
  for (const text of [value.startTime, value.event_start_time, value.time_label]) {
    if (typeof text !== "string") continue;
    const match = text.match(/(\d{1,2}):(\d{2})/);
    if (!match) continue;
    const hour = Number(match[1]);
    if (Number.isFinite(hour) && hour >= 0 && hour < 24) return hour;
  }
  return null;
}

function itemRef(item: RoamlyActivitySeed): string {
  return item.item_id || item.candidateId || item.title || "item";
}

/* ── Money invariant ────────────────────────────────────────────── */

const PRICE_FIELDS = [
  "estimated_cost",
  "cost_status",
  "factualStatus",
  "price_confidence",
  "price_type",
  "market_confidence",
  "estimated_cost_min",
  "estimated_cost_max",
  "estimated_nightly_cost_min",
  "estimated_nightly_cost_max",
  "estimated_total_cost_min",
  "estimated_total_cost_max"
] as const;

function collectPricedNodes(itinerary: RoamlyItinerary): Map<string, string> {
  const nodes = new Map<string, string>();
  const days = Array.isArray(itinerary?.daily_itinerary) ? itinerary.daily_itinerary : [];
  days.forEach((day, dayIndex) => {
    const key = (item: Record<string, unknown>, path: string) => {
      const priced = PRICE_FIELDS.map((field) => `${field}=${JSON.stringify(item[field] ?? null)}`).join("|");
      nodes.set(path, priced);
    };
    (Array.isArray(day?.live_timeline) ? day.live_timeline : []).forEach((item) => {
      key(item as unknown as Record<string, unknown>, `day[${dayIndex}].timeline[${itemRef(item as RoamlyActivitySeed)}]`);
    });
    const suggestions = Array.isArray(itinerary?.booking_suggestions) ? itinerary.booking_suggestions : [];
    suggestions.forEach((suggestion, suggestionIndex) => {
      key(suggestion as unknown as Record<string, unknown>, `booking_suggestion[${suggestionIndex}]`);
    });
  });
  nodes.set("__budget_breakdown__", JSON.stringify(itinerary?.estimated_budget_breakdown ?? null));
  return nodes;
}

/**
 * Throws if ANY price or provenance value drifted between original and
 * customized itineraries. The Concierge reorders; it never reprices.
 */
function assertPricesUntouched(original: RoamlyItinerary, customized: RoamlyItinerary): void {
  const before = collectPricedNodes(original);
  const after = collectPricedNodes(customized);
  for (const [path, signature] of before) {
    if (!after.has(path)) continue; // moved items are checked by identity below
    if (after.get(path) !== signature) {
      throw new Error(`CONCIERGE_PRICE_DRIFT:${path}`);
    }
  }
  // Every original item must still exist (by stable identity); only
  // item_type "rest" items with no price may be added.
  const originalIds = new Set<string>();
  const collectIds = (itinerary: RoamlyItinerary) => {
    const ids = new Set<string>();
    for (const day of Array.isArray(itinerary?.daily_itinerary) ? itinerary.daily_itinerary : []) {
      for (const item of Array.isArray(day?.live_timeline) ? day.live_timeline : []) {
        ids.add(itemRef(item as RoamlyActivitySeed));
      }
    }
    return ids;
  };
  for (const id of collectIds(original)) originalIds.add(id);
  const afterIds = collectIds(customized);
  for (const id of originalIds) {
    if (!afterIds.has(id)) throw new Error(`CONCIERGE_ITEM_LOST:${id}`);
  }
  for (const day of Array.isArray(customized?.daily_itinerary) ? customized.daily_itinerary : []) {
    for (const item of Array.isArray(day?.live_timeline) ? day.live_timeline : []) {
      const seed = item as RoamlyActivitySeed;
      if (!originalIds.has(itemRef(seed))) {
        if (seed.item_type !== "rest") throw new Error(`CONCIERGE_ITEM_ADDED:${itemRef(seed)}`);
        if (seed.estimated_cost != null) throw new Error(`CONCIERGE_PRICE_ADDED:${itemRef(seed)}`);
      }
    }
  }
}

/* ── Helpers ────────────────────────────────────────────────────── */

function cloneDayPlan(day: RoamlyDayPlan): RoamlyDayPlan {
  return {
    ...day,
    live_timeline: Array.isArray(day.live_timeline) ? day.live_timeline.map((item) => ({ ...item })) : []
  };
}

function dayLoad(day: RoamlyDayPlan): number {
  return (Array.isArray(day.live_timeline) ? day.live_timeline : []).filter(
    (item) => item.item_type !== "rest" && item.item_type !== "reminder"
  ).length;
}

function arrivalDayNumbers(input: ConciergeInput): Set<number> {
  const days = new Set<number>();
  for (const outlineDay of Array.isArray(input.outlineDays) ? input.outlineDays : []) {
    if (Array.isArray(outlineDay.arrivalRequirements) && outlineDay.arrivalRequirements.length) {
      days.add(outlineDay.dayNumber);
    }
  }
  return days;
}

function suggestionId(tripId: string | null | undefined, kind: ConciergeSuggestionKind, dayNumber: number | undefined, itemRefValue: string | undefined): string {
  const trip = typeof tripId === "string" && tripId ? tripId : "anon";
  return `concierge:${trip}:${kind}:day${dayNumber ?? 0}:${itemRefValue || "none"}`;
}

function tripCountLabel(count: number): string {
  return `${count} trip${count === 1 ? "" : "s"}`;
}

/* Interest matching — keyword map over the repo's tripInterests list. */
const INTEREST_KEYWORDS: Record<string, string[]> = {
  Culture: ["culture", "cultural", "heritage", "historic", "history", "temple", "church", "mosque", "shrine", "palace", "castle", "old town"],
  Food: ["food", "restaurant", "cuisine", "dining", "tasting", "market", "street food", "brunch", "dinner", "lunch", "cafe", "bakery"],
  Nightlife: ["nightlife", "night", "bar", "club", "pub", "cocktail", "live music", "concert", "dj"],
  Nature: ["nature", "park", "garden", "forest", "waterfall", "lake", "mountain", "trail", "wildlife"],
  Shopping: ["shopping", "shop", "market", "mall", "souvenir", "boutique"],
  Museums: ["museum", "gallery", "exhibit", "art"],
  Beaches: ["beach", "coast", "seaside", "island", "snorkel", "surf"],
  Family: ["family", "kids", "children", "playground", "zoo", "aquarium"],
  Adventure: ["adventure", "hiking", "hike", "kayak", "rafting", "zipline", "climb", "dive", "diving", "safari", "trek"],
  Romance: ["romance", "romantic", "sunset", "couples", "honeymoon"],
  Business: ["business", "conference", "meeting", "cowork"],
  Diving: ["diving", "dive", "scuba", "snorkel"],
  Hiking: ["hiking", "hike", "trail", "trek", "summit"],
  Cafes: ["cafe", "coffee", "espresso", "tea house"],
  "Hidden gems": ["hidden", "local", "off the beaten", "secret", "neighborhood"]
};

function itemInterestScore(item: RoamlyActivitySeed, interests: string[]): number {
  const haystack = `${item.title || ""} ${item.category || ""} ${item.description || ""} ${item.location_name || ""}`.toLowerCase();
  let score = 0;
  for (const interest of interests) {
    const keywords = INTEREST_KEYWORDS[interest] || [interest.toLowerCase()];
    if (keywords.some((keyword) => keyword.length >= 3 && haystack.includes(keyword))) score += 1;
  }
  return score;
}

function isRelaxedPace(pace?: string | null): boolean {
  const normalized = (pace || "").toLowerCase();
  return normalized === "relaxed" || normalized === "slow" || normalized === "chill";
}

/* ── Suggestion engines (pure; all applied edits are reversible moves) ─ */

function enginePaceAdjustment(
  input: ConciergeInput,
  days: RoamlyDayPlan[],
  patterns: SuccessfulTripExperiencePattern[],
  hardTexts: string[],
  blocked: string[]
): ConciergeSuggestion[] {
  if (!isRelaxedPace(input.signals.pace)) return [];
  const backing = patterns.find((pattern) => (pattern.averageScheduleRealism ?? 0) >= CONCIERGE_HIGH_AVERAGE);
  if (!backing) return [];
  const suggestions: ConciergeSuggestion[] = [];
  const loads = days.map((day) => ({ day, load: dayLoad(day) }));
  const heaviest = loads.reduce((a, b) => (b.load > a.load ? b : a), loads[0]);
  const lightest = loads.reduce((a, b) => (b.load < a.load ? b : a), loads[0]);
  if (!heaviest || !lightest || heaviest.day === lightest.day || heaviest.load - lightest.load < 2) return [];
  const movableIndex = heaviest.day.live_timeline.findIndex(
    (item) =>
      isFlexibleItem(item, hardTexts) &&
      !matchesBlockedPhrases(item, blocked) &&
      (item.item_type === "activity" || item.item_type === "meal" || !item.item_type)
  );
  if (movableIndex < 0) return [];
  const [moved] = heaviest.day.live_timeline.splice(movableIndex, 1);
  lightest.day.live_timeline.push(moved);
  const tripId = input.tripId ?? null;
  suggestions.push({
    id: suggestionId(tripId, "pace_adjustment", lightest.day.day_number, itemRef(moved)),
    kind: "pace_adjustment",
    dayNumber: lightest.day.day_number,
    itemRef: itemRef(moved),
    title: `Eased day ${heaviest.day.day_number} into day ${lightest.day.day_number}`,
    reason: `Travelers on ${tripCountLabel(patternTripCount(backing))} similar trips said their days flowed better at a relaxed pace, so "${moved.title}" moved to a lighter day. Nothing you booked or asked for moved.`,
    patternBacking: patternTripCount(backing),
    patternKey: backing.patternKey,
    applied: true
  });
  return suggestions;
}

function engineArrivalLightening(
  input: ConciergeInput,
  days: RoamlyDayPlan[],
  patterns: SuccessfulTripExperiencePattern[],
  hardTexts: string[],
  blocked: string[]
): ConciergeSuggestion[] {
  const arrivalDays = arrivalDayNumbers(input);
  if (!arrivalDays.size) return [];
  const backing = patterns.find((pattern) => (pattern.averageSatisfaction ?? 0) >= CONCIERGE_HIGH_AVERAGE);
  if (!backing) return [];
  const suggestions: ConciergeSuggestion[] = [];
  const loads = days.map((day) => dayLoad(day));
  const median = [...loads].sort((a, b) => a - b)[Math.floor(loads.length / 2)] ?? 0;
  for (const day of days) {
    if (!arrivalDays.has(day.day_number)) continue;
    if (dayLoad(day) <= median) continue;
    const movableIndex = day.live_timeline.findIndex(
      (item) =>
        isFlexibleItem(item, hardTexts) &&
        !matchesBlockedPhrases(item, blocked) &&
        (item.item_type === "activity" || item.item_type === "meal" || !item.item_type)
    );
    if (movableIndex < 0) continue;
    const lightest = days.filter((d) => d !== day).reduce((a, b) => (dayLoad(b) < dayLoad(a) ? b : a), days.find((d) => d !== day) || day);
    if (!lightest || lightest === day) continue;
    const [moved] = day.live_timeline.splice(movableIndex, 1);
    lightest.live_timeline.push(moved);
    const tripId = input.tripId ?? null;
    suggestions.push({
      id: suggestionId(tripId, "reorder_day", lightest.day_number, itemRef(moved)),
      kind: "reorder_day",
      dayNumber: lightest.day_number,
      itemRef: itemRef(moved),
      title: `Kept arrival day ${day.day_number} light`,
      reason: `Trips like yours (${tripCountLabel(patternTripCount(backing))}) started slower on landing day and rated the trip higher, so "${moved.title}" moved to day ${lightest.day_number}. Your arrival plans stay exactly where they were.`,
      patternBacking: patternTripCount(backing),
      patternKey: backing.patternKey,
      applied: true
    });
    break;
  }
  return suggestions;
}

function engineInterestRerank(
  input: ConciergeInput,
  days: RoamlyDayPlan[],
  patterns: SuccessfulTripExperiencePattern[],
  hardTexts: string[],
  blocked: string[],
  lateStart: boolean,
  commentNote: () => string | null
): ConciergeSuggestion[] {
  const baseInterests = Array.isArray(input.signals.interests) ? input.signals.interests.filter(Boolean) : [];
  const boosted = commentInterestBoosts(input.commentReading ?? { signals: [], unread: [] });
  const interests = [...new Set([...baseInterests, ...boosted])];
  if (!interests.length) return [];
  const backing = patterns.find((pattern) => (pattern.averageSatisfaction ?? 0) >= CONCIERGE_HIGH_AVERAGE);
  if (!backing) return [];
  const suggestions: ConciergeSuggestion[] = [];
  for (const day of days) {
    const promotable = (item: RoamlyActivitySeed) => {
      if (!isFlexibleItem(item, hardTexts)) return false;
      if (matchesBlockedPhrases(item, blocked)) return false;
      if (lateStart) {
        const hour = startHourOf(item);
        if (hour !== null && hour < 9) return false;
      }
      return true;
    };
    const scored = day.live_timeline.map((item, index) => ({ item, index, score: itemInterestScore(item, interests) }));
    const flexible = scored.filter((entry) => promotable(entry.item) && entry.score > 0);
    if (!flexible.length) continue;
    // Stable re-rank: interest-matching flexible items float above
    // non-matching flexible items; protected items stay pinned.
    const flexibleIndexes = new Set(scored.map((entry, i) => (promotable(entry.item) ? i : -1)).filter((i) => i >= 0));
    const current = day.live_timeline;
    const flexibleItems = current.filter((_, i) => flexibleIndexes.has(i));
    const ranked = [...flexibleItems].sort((a, b) => itemInterestScore(b, interests) - itemInterestScore(a, interests));
    const unchanged = flexibleItems.every((item, i) => item === ranked[i]);
    if (unchanged) continue;
    let rankCursor = 0;
    const next = current.map((item, i) => (flexibleIndexes.has(i) ? ranked[rankCursor++] : item));
    day.live_timeline = next;
    const top = ranked[0];
    const foodDetails = commentFoodDetails(input.commentReading ?? { signals: [], unread: [] });
    const foodClause = foodDetails.length ? ` — you asked for more ${foodDetails[0]}` : "";
    const tripId = input.tripId ?? null;
    suggestions.push({
      id: suggestionId(tripId, "swap_pick", day.day_number, itemRef(top)),
      kind: "swap_pick",
      dayNumber: day.day_number,
      itemRef: itemRef(top),
      title: `Day ${day.day_number} now leads with "${top.title}"`,
      reason: `Travelers into ${interests.slice(0, 2).join(" and ")}${foodClause} on ${tripCountLabel(patternTripCount(backing))} similar trips enjoyed these most, so they moved earlier in the day — your fixed plans didn't shift.${commentNote() ?? ""}`,
      patternBacking: patternTripCount(backing),
      patternKey: backing.patternKey,
      applied: true
    });
  }
  return suggestions;
}

function enginePatternPick(
  input: ConciergeInput,
  patterns: SuccessfulTripExperiencePattern[],
  lateStart: boolean,
  blocked: string[],
  vetoNotes: string[]
): ConciergeSuggestion[] {
  const backing = patterns
    .filter((pattern) => (pattern.averageSatisfaction ?? 0) >= CONCIERGE_HIGH_AVERAGE)
    .sort((a, b) => patternTripCount(b) - patternTripCount(a))[0];
  if (!backing) return [];
  const suggestions: ConciergeSuggestion[] = [];
  const candidates = Array.isArray(input.itinerary.booking_suggestions) ? input.itinerary.booking_suggestions : [];
  const candidate = candidates.find((suggestion) => suggestion.advance_booking_recommended === true);
  if (!candidate) return [];
  // A comment vetoes a pattern suggestion; a pattern never overrides a comment.
  const candidateText = `${candidate.title || ""} ${candidate.description || ""}`.toLowerCase();
  if (blocked.some((phrase) => phrase.length >= 4 && candidateText.includes(phrase))) {
    vetoNotes.push(`Held back a suggestion for "${candidate.title}": your comment asked to skip it. Your words outrank the patterns.`);
    return [];
  }
  if (lateStart) {
    const hour = startHourOf(candidate);
    if (hour !== null && hour < 9) {
      vetoNotes.push(`Held back a suggestion for "${candidate.title}" starting at ${candidate.event_start_time || "early morning"}: your comment said no early starts. Your words outrank the patterns.`);
      return [];
    }
  }
  const tripId = input.tripId ?? null;
  suggestions.push({
    id: suggestionId(tripId, "pattern_pick", undefined, candidate.candidateId || candidate.title),
    kind: "pattern_pick",
    itemRef: candidate.candidateId || candidate.title,
    title: `Worth booking ahead: ${candidate.title}`,
    reason: `${tripCountLabel(patternTripCount(backing))} similar trips that locked in "${candidate.title}" early rated their trip higher. It's already on your list — this is just the nudge. No price changed.`,
    patternBacking: patternTripCount(backing),
    patternKey: backing.patternKey,
    applied: false
  });
  return suggestions;
}

/* ── Public entry ───────────────────────────────────────────────── */

function runEngines(input: ConciergeInput): ConciergeOutput {
  const original = input.itinerary;
  if (!original || typeof original !== "object" || !Array.isArray(original.daily_itinerary)) {
    return { itinerary: original, suggestions: [], notes: [], unreadComments: [], error: "CONCIERGE_INVALID_ITINERARY" };
  }
  // Comment Reader: deterministic, never throws, never drops unclassifiable
  // comments (they surface in unreadComments).
  const reading = readPlanComments(input.comments);
  input.commentReading = reading;
  const patterns = usablePatterns(input.patterns);
  if (!patterns.length) {
    return { itinerary: original, suggestions: [], notes: commentAttributionNotes(reading), unreadComments: reading.unread };
  }
  const hardTexts = [...hardRequirementTexts(input.payload), ...commentHardRequirementTexts(reading)];
  const blocked = commentBlockedPhrases(reading);
  const lateStart = commentRequiresLateStart(reading);
  const vetoNotes: string[] = [];
  const commentNote = (): string | null =>
    reading.signals.some((signal) => signal.dimension === "interests" || signal.dimension === "food")
      ? ` (prompted by your comment)`
      : null;
  const days = original.daily_itinerary.map(cloneDayPlan);
  const suggestions: ConciergeSuggestion[] = [
    ...enginePaceAdjustment(input, days, patterns, hardTexts, blocked),
    ...engineArrivalLightening(input, days, patterns, hardTexts, blocked),
    ...engineInterestRerank(input, days, patterns, hardTexts, blocked, lateStart, commentNote),
    ...enginePatternPick(input, patterns, lateStart, blocked, vetoNotes)
  ];
  const customized: RoamlyItinerary = { ...original, daily_itinerary: days };
  assertPricesUntouched(original, customized);
  const notes = [...commentAttributionNotes(reading), ...vetoNotes];
  // Audit 1C: the suggestion log finally has a caller. Fire-and-forget by
  // design — a logging failure must never change what the traveler gets.
  logSuggestionsFireAndForget({
    supabase: input.supabase ?? null,
    tripId: input.tripId ?? null,
    userId: null,
    suggestions
  });
  return { itinerary: customized, suggestions, notes, unreadComments: reading.unread };
}

/** Plain-language attributions: which comments became hard requirements. */
function commentAttributionNotes(reading: { signals: Array<{ polarity: string; clause: string }> }): string[] {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const signal of reading.signals) {
    if (signal.polarity !== "hard_requirement") continue;
    const key = signal.clause;
    if (seen.has(key)) continue;
    seen.add(key);
    notes.push(`Your comment "${signal.clause}" is now a hard requirement on your plan — it outranks recommendations and patterns.`);
  }
  return notes;
}

/**
 * Customize an itinerary for one traveler. NEVER throws: on any error the
 * ORIGINAL itinerary reference is returned unchanged (generator behavior
 * with the Concierge absent is byte-identical to today).
 */
export function customizeItinerary(input: ConciergeInput): ConciergeOutput {
  try {
    return runEngines(input);
  } catch (error) {
    return {
      itinerary: input?.itinerary,
      suggestions: [],
      notes: [],
      unreadComments: [],
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/* ── Re-exported for tests / integration ────────────────────────── */

export { collectPricedNodes, assertPricesUntouched, isProtectedItem, isFlexibleItem, conciergePublishable as isConciergePublishable };
