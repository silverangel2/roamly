import { extractConstraints } from "@/lib/roamly/engine/understand";
import { deriveMustSees } from "@/lib/roamly/engine/generate";
import { fuzzyPlaceWinner } from "@/lib/roamly/engine/placeNameMatch";
import { applyMustDoVerdicts } from "@/lib/roamly/mustDoReconciliation";
import { normText, type EnginePack } from "@/lib/roamly/engine/util";
import type { RoamlyActivitySeed, RoamlyItinerary } from "@/lib/itinerary";
import type { TripPlannerPayload } from "@/lib/trip-planner";

/*
 * Staged-path must-do verification (2026-10-31, Banff safeguards
 * round, Safeguard 3).
 *
 * The staged-AI path carried the traveler's request text
 * (payload.specialNotes) into its prompts as prose only
 * (stagedItineraryGeneration.ts outlinePrompt / dayBatchPrompt):
 * a stated must-do there was a suggestion to a model, never a
 * checked requirement, so a related attraction could silently
 * stand in for the requested experience in the saved itinerary —
 * the same substitution the zero-engine fix (2026-10-30) closed on
 * the engine path.
 *
 * This module is the staged path's deterministic verification
 * pass. It runs at the LAST structured checkpoint before
 * persistence: the end of assembleItinerary in
 * stagedItineraryGeneration.ts, through which every
 * persistItinerary / final save flows. Days there are structured
 * RoamlyDayPlan records with structured live_timeline activities,
 * so the check is fully deterministic — no model, no free text.
 *
 * Semantics are the zero-engine's, reused not forked:
 * - Extraction and must-see derivation are the engine's own
 *   extractConstraints + deriveMustSees, which attach the
 *   head-noun requirement (mustSeeRequirement in understand.ts)
 *   to every derived must-see. (deriveMustSees needs a pack only
 *   for its pattern ladder, which this pass does not use — the
 *   satisfaction test below is the requirement test, so the pack
 *   is an empty one for the destination. Labels, dedupe and
 *   requirements are the engine's exact output.)
 * - Satisfaction mirrors solver.ts requirementMet: an activity
 *   satisfies a must-do only when it NAMES the requested
 *   experience/kind itself (its title / location contains a
 *   required pattern) or carries its kind (the staged activity's
 *   kind-bearing fields — category / item_type / affiliate
 *   category — carry a required kind). A related place that
 *   matches only the label's context words does NOT satisfy.
 * - Pure named-place labels (no head noun at all) carry the
 *   place-name anchor from mustSeeRequirement (2026-11-08, Europe
 *   test): satisfied only by an activity that names the place,
 *   otherwise UNMET and named — here exactly as in the solver.
 *   Labels with neither a head noun nor a named place carry no
 *   requirement and remain EXEMPT (the historical behaviour).
 * - Typo tolerance (2026-11-09): when the exact name test fails
 *   for a pure name-anchor must-do, the ONE fuzzy tier
 *   (engine/placeNameMatch.ts — the solver's own) may still
 *   satisfy it from a unique unmistakable near-match among the
 *   activities; kind requirements never fuzz, and anything less
 *   certain stays UNMET.
 * - An unsatisfied must-do is never dropped and never silently
 *   substituted: it is reported through the same honest surface
 *   the zero-engine uses — the namedMustSeeMiss sentence, appended
 *   to the first day's words. On the zero-engine path that
 *   sentence lands in day 1's narrative, which the conversion
 *   writes to RoamlyDayPlan.primary_plan; the staged path's
 *   equivalent field is the same primary_plan, so consumers see
 *   the flag the same way in the saved itinerary.
 */

/** One must-do's verification verdict against a staged itinerary. */
export interface StagedMustDoResult {
  id: string;
  label: string;
  status: "satisfied" | "unmet" | "exempt";
  /** For "unmet": the solver's honest reason wording. */
  reason?: string;
  /** For "satisfied": the title of the activity that names the
   *  requested experience/kind itself. */
  item?: string;
  /** The spec's pattern ladder + head-noun requirement, carried
   *  through so the annotation reconciliation
   *  (lib/roamly/mustDoReconciliation.ts) can judge each
   *  must_do_items entry against THIS must-do precisely. */
  patterns?: string[];
  requiredPatterns?: string[];
  requiredKinds?: string[];
  /** Carried from the spec: the requirement is a pure named-place
   *  anchor — the shape the typo-tolerance tier may serve. */
  requiredNameAnchor?: boolean;
}

const RELATED_ONLY_REASON =
  "only related places match — the requested experience itself is not in the open data for this destination";
const NO_MATCH_REASON = "no matching candidate exists in the open data for this destination";

function emptyPackFor(destination: string): EnginePack {
  return {
    destination,
    country: "",
    center: { lat: 0, lon: 0 },
    counts: { total: 0, sights: 0, foods: 0, stays: 0, transport: 0 },
    stays: [],
    sights: [],
    excursions: [],
    foods: [],
    transport: [],
    weather: []
  };
}

/** An unresolved must-do placeholder (the travel-requirements
 *  repair re-states a hard request as an untimed item with no
 *  candidate identity and no location) names the REQUEST, not a
 *  place — it is the ask retained, not the experience delivered,
 *  so it can never satisfy its own must-do. */
function isUnresolvedMustDoPlaceholder(item: RoamlyActivitySeed): boolean {
  const mustDoish = item.plan_role === "must_do" || item.must_do === true;
  return mustDoish && !item.candidateId && !String(item.location_name || "").trim();
}

function activityNamesRequirement(item: RoamlyActivitySeed, requiredPatterns: string[]): boolean {
  const name = normText(`${item.title || ""} ${item.location_name || ""}`);
  return requiredPatterns.some((pattern) => {
    const needle = normText(pattern).trim();
    return needle.length > 0 && name.includes(needle);
  });
}

function activityCarriesKind(item: RoamlyActivitySeed, requiredKinds: string[], requiredPatterns: string[]): boolean {
  const carriers = [item.category, item.item_type, item.affiliate_category, item.travel_mode, item.transportMode]
    .map((value) => ` ${normText(value || "").replace(/[^a-z0-9]+/g, " ")} `)
    .join(" ");
  const kinds = [...new Set([...requiredKinds, ...requiredPatterns])];
  return kinds.some((kind) => {
    const needle = normText(kind).trim();
    return needle.length > 0 && carriers.includes(` ${needle} `);
  });
}

/** Context words of a label: its content tokens that are not the
 *  requirement itself. An activity matching only these is a
 *  RELATED place (the solver's relatedOnlyMatch signal). */
function labelContextTokens(label: string, requiredPatterns: string[]): string[] {
  const required = new Set(requiredPatterns.map((p) => normText(p).trim()));
  return [...new Set(normText(label).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !required.has(t)))];
}

/**
 * Verify every must-do derived from the traveler's request
 * against the final structured staged activities. Pure and
 * deterministic: same itinerary + payload in, same verdicts out.
 */
export function verifyStagedMustDos(
  itinerary: RoamlyItinerary,
  payload: TripPlannerPayload
): StagedMustDoResult[] {
  // The zero-engine builds its request text exactly this way
  // (deriveSolveContext in generate.ts): specialNotes + interests.
  const requestText = [payload.specialNotes || "", ...(payload.interests || [])].join("\n").trim();
  const extracted = extractConstraints(requestText);
  const destination = payload.destination || payload.destinationCity || "";
  const specs = deriveMustSees(payload, extracted, emptyPackFor(destination));

  const activities = (itinerary.daily_itinerary || [])
    .flatMap((day) => day.live_timeline || [])
    .filter((item) => !isUnresolvedMustDoPlaceholder(item));

  return specs.map((spec) => {
    const requiredPatterns = (spec.requiredPatterns || []).map((p) => normText(p).trim()).filter(Boolean);
    const requiredKinds = spec.requiredKinds || [];
    if (!requiredPatterns.length && !requiredKinds.length) {
      // Proper-noun-only label: no head-noun requirement — exempt,
      // exactly as in the solver (hasRequirement === false).
      return {
        id: spec.id,
        label: spec.label,
        status: "exempt" as const,
        patterns: spec.patterns || [],
        requiredPatterns,
        requiredKinds,
        requiredNameAnchor: spec.requiredNameAnchor
      };
    }
    // A leg (transfer / travel item) is movement TOWARD a place:
    // its title/location naming the destination no more satisfies
    // a must-do than the solver's pool matching a place's name
    // would — the leg's destination is context. A leg satisfies
    // only when the leg itself IS the requested kind (a ferry
    // crossing carries the ferry kind in its mode), which the
    // kind test captures. Non-leg activities satisfy by naming
    // the experience/kind or by carrying its kind.
    let satisfying = activities.find((item) => {
      const isLeg = item.item_type === "transfer" || item.item_type === "travel";
      return (
        (!isLeg && activityNamesRequirement(item, requiredPatterns)) ||
        activityCarriesKind(item, requiredKinds, requiredPatterns)
      );
    });
    if (!satisfying && spec.requiredNameAnchor && !requiredKinds.length && requiredPatterns.length) {
      // Typo tolerance (owner requirement, 2026-11-09), the same
      // ONE tier the solver consults (placeNameMatch.ts): the
      // staged model wrote the place under its true name while
      // the traveller's ask carries a misspelling, so the exact
      // name test above missed the very activity that delivers
      // the ask. A unique, unmistakable near-match among the
      // non-leg activities satisfies; anything less certain
      // leaves the must-do honestly unmet below. Pure name-anchor
      // asks only — kind requirements never fuzz.
      const named = activities.filter((item) => item.item_type !== "transfer" && item.item_type !== "travel");
      const winner = fuzzyPlaceWinner(
        requiredPatterns,
        named.map((item) => ({ name: `${item.title || ""} ${item.location_name || ""}`, item }))
      );
      if (winner) satisfying = winner.item;
    }
    if (satisfying) {
      return {
        id: spec.id,
        label: spec.label,
        status: "satisfied" as const,
        item: satisfying.title,
        patterns: spec.patterns || [],
        requiredPatterns,
        requiredKinds,
        requiredNameAnchor: spec.requiredNameAnchor
      };
    }
    const context = labelContextTokens(spec.label, requiredPatterns);
    const relatedOnly = activities.some((item) => {
      const name = normText(`${item.title || ""} ${item.location_name || ""}`);
      return context.some((token) => name.includes(token));
    });
    return {
      id: spec.id,
      label: spec.label,
      status: "unmet" as const,
      reason: relatedOnly ? RELATED_ONLY_REASON : NO_MATCH_REASON,
      patterns: spec.patterns || [],
      requiredPatterns,
      requiredKinds,
      requiredNameAnchor: spec.requiredNameAnchor
    };
  });
}

/**
 * The verification pass applied to a staged itinerary before it is
 * persisted: satisfied and exempt must-dos leave the itinerary
 * byte-for-byte unchanged; each unmet must-do is named in the
 * first day's primary_plan via the zero-engine's honest sentence
 * (namedMustSeeMiss) AND its must-do annotations are reconciled
 * (Workstream 2, 2026-10-31): an activity the repair pass stamped
 * as a must-do (must_do_items entry / live_timeline must-do flag /
 * protected_anchors entry) that is only a RELATED place for an
 * unmet must-do loses that annotation, so the document never
 * presents a related attraction as satisfying a request its own
 * gap sentence calls unmet. The shared reconciliation lives in
 * lib/roamly/mustDoReconciliation.ts (applyMustDoVerdicts) — the
 * zero-engine assembly applies the identical pass. Never drops an
 * activity, never substitutes one, never invents one.
 */
export function applyStagedMustDoVerification(
  itinerary: RoamlyItinerary,
  payload: TripPlannerPayload
): RoamlyItinerary {
  const results = verifyStagedMustDos(itinerary, payload);
  if (!results.some((r) => r.status === "unmet") || !itinerary.daily_itinerary?.length) return itinerary;
  const destination =
    payload.destination || payload.destinationCity || itinerary.daily_itinerary[0]?.city || "";
  return applyMustDoVerdicts(itinerary, results, destination);
}
