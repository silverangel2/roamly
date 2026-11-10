import { namedMustSeeMiss } from "@/lib/roamly/engine/understand";
import { fuzzyPlaceWinner } from "@/lib/roamly/engine/placeNameMatch";
import { normText } from "@/lib/roamly/engine/util";
import type { RoamlyActivitySeed, RoamlyDayPlan, RoamlyItinerary } from "@/lib/itinerary";

/*
 * Must-do annotation reconciliation (2026-10-31, Roamly release-
 * blocker closure, Workstream 2).
 *
 * The must-do fixes closed the SOLVER/VERIFICATION substitution:
 * a must-do whose head-noun requirement no activity meets is
 * honestly UNMET and named via namedMustSeeMiss. But the day
 * document carries a second, independent claim that was never
 * reconciled with that verdict: the must-do ANNOTATIONS —
 * RoamlyDayPlan.must_do_items (a list of activity titles) and the
 * per-activity flags it is built from (live_timeline items with
 * plan_role "must_do" / must_do true, mirrored in
 * protected_anchors). On the real saved run that motivated this
 * fix, a requested ride must-do is flagged unmet, yet the related
 * summit attraction the ride serves still sits in day 1's
 * must_do_items with must_do flags set: the annotation presents
 * the related place as satisfying the very request the honest
 * gap sentence says is unmet.
 *
 * How must_do_items is built (traced):
 * - Zero-engine (lib/roamly/engine/generate.ts,
 *   engineDayToRoamlyDayPlan): must_do_items = titles of engine
 *   items where isMustDo(item) — role "mustsee", protected, or the
 *   item's candidate key is in the caller-supplied mustSeeKeys —
 *   and each such item is ALSO stamped plan_role "must_do" /
 *   must_do true in live_timeline; protected_anchors is
 *   [stay anchor, ...must_do_items]. Entries are activity TITLES
 *   (strings); there is no must-do id on an entry — the link from
 *   an annotation to a must-do is the activity's identity (its
 *   title / location / kind fields) evaluated against the
 *   must-do's requirement, exactly the solver's satisfaction test.
 * - Staged-AI (lib/itinerary.ts, annotateDayPlan — called by
 *   repairItineraryForTravelRequirements, which
 *   stagedItineraryGeneration.assembleItinerary runs BEFORE the
 *   verification pass): must_do_items = titles of live_timeline
 *   items flagged plan_role "must_do" / must_do true, however the
 *   staged days acquired the flag (model output or the repair's
 *   protected must-do handling). Same title-only shape.
 *
 * Reconciliation rule (precise per must-do, never blanket):
 * an annotation (a must_do_items / protected_anchors entry, or a
 * timeline item's must-do flag) is stripped ONLY when the activity
 * it names is a RELATED place for an UNMET must-do — its name
 * matches that must-do label's context words but does NOT name
 * the requested experience/kind itself (the solver's
 * relatedOnlyMatch signal) — AND the activity does not satisfy
 * any SATISFIED must-do (name/kind test, or being that must-do's
 * satisfying item) and does not match any EXEMPT (proper-noun)
 * must-do's patterns. A satisfied must-do keeps its annotation; a
 * mixed day keeps the satisfied one's and loses only the unmet
 * one's. The activity itself is never dropped, moved or renamed:
 * a stripped timeline item simply loses its must-do flag
 * (plan_role "must_do" -> "primary", must_do -> false) and stays
 * in the day as an ordinary stop. Because annotateDayPlan rebuilds
 * must_do_items from those flags, a later repair pass over a
 * reconciled document cannot resurrect the stripped annotation.
 *
 * Unresolved must-do placeholders (the repair's retained ask: a
 * must-do-flagged item with no candidate identity and no location)
 * are NOT stripped — the placeholder is the request retained, not
 * a place presented as satisfying it, and its own uncertainty text
 * already says it is unconfirmed.
 */

export interface MustDoSpecLike {
  id: string;
  label: string;
  patterns?: string[];
  requiredPatterns?: string[];
  requiredKinds?: string[];
  /** Pure named-place anchor — the shape the typo-tolerance
   *  tier may serve (see evaluateMustDoVerdicts). */
  requiredNameAnchor?: boolean;
}

export interface MustDoVerdictLike {
  id: string;
  label: string;
  status: "satisfied" | "unmet" | "exempt";
  reason?: string;
  /** For "satisfied": title of the activity that satisfies it. */
  item?: string;
  patterns?: string[];
  requiredPatterns?: string[];
  requiredKinds?: string[];
  requiredNameAnchor?: boolean;
}

const RELATED_ONLY_REASON =
  "only related places match — the requested experience itself is not in the open data for this destination";
const NO_MATCH_REASON = "no matching candidate exists in the open data for this destination";

function isUnresolvedMustDoPlaceholder(item: RoamlyActivitySeed): boolean {
  const mustDoish = item.plan_role === "must_do" || item.must_do === true;
  return mustDoish && !item.candidateId && !String(item.location_name || "").trim();
}

function nameMatchesPatterns(name: string, patterns: string[]): boolean {
  return patterns.some((pattern) => {
    const needle = normText(pattern).trim();
    return needle.length > 0 && name.includes(needle);
  });
}

function itemNamesRequirement(item: RoamlyActivitySeed, requiredPatterns: string[]): boolean {
  const name = normText(`${item.title || ""} ${item.location_name || ""}`);
  return nameMatchesPatterns(name, requiredPatterns);
}

function itemCarriesKind(item: RoamlyActivitySeed, requiredKinds: string[], requiredPatterns: string[]): boolean {
  const carriers = [item.category, item.item_type, item.affiliate_category, item.travel_mode, item.transportMode]
    .map((value) => ` ${normText(value || "").replace(/[^a-z0-9]+/g, " ")} `)
    .join(" ");
  const kinds = [...new Set([...requiredKinds, ...requiredPatterns])];
  return kinds.some((kind) => {
    const needle = normText(kind).trim();
    return needle.length > 0 && carriers.includes(` ${needle} `);
  });
}

/** Satisfaction test, mirroring solver.ts requirementMet and the
 *  staged verification pass: a leg (transfer/travel item) satisfies
 *  only when the leg itself IS the requested kind; any other item
 *  satisfies by naming the experience/kind or carrying its kind. */
function itemSatisfies(item: RoamlyActivitySeed, verdict: MustDoVerdictLike): boolean {
  const requiredPatterns = (verdict.requiredPatterns || []).map((p) => normText(p).trim()).filter(Boolean);
  const requiredKinds = verdict.requiredKinds || [];
  if (!requiredPatterns.length && !requiredKinds.length) return false;
  const isLeg = item.item_type === "transfer" || item.item_type === "travel";
  return (
    (!isLeg && itemNamesRequirement(item, requiredPatterns)) ||
    itemCarriesKind(item, requiredKinds, requiredPatterns)
  );
}

/** Context words of a label: its content tokens that are not the
 *  requirement itself (the solver's relatedOnlyMatch signal). */
function labelContextTokens(label: string, requiredPatterns: string[]): string[] {
  const required = new Set(requiredPatterns.map((p) => normText(p).trim()));
  return [...new Set(normText(label).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !required.has(t)))];
}

function itemRelatedToUnmet(item: RoamlyActivitySeed, verdict: MustDoVerdictLike): boolean {
  const requiredPatterns = (verdict.requiredPatterns || []).map((p) => normText(p).trim()).filter(Boolean);
  if (itemSatisfies(item, verdict)) return false;
  const name = normText(`${item.title || ""} ${item.location_name || ""}`);
  return labelContextTokens(verdict.label, requiredPatterns).some((token) => name.includes(token));
}

function itemMatchesExempt(item: RoamlyActivitySeed, verdict: MustDoVerdictLike): boolean {
  const name = normText(`${item.title || ""} ${item.location_name || ""}`);
  const patterns = (verdict.patterns || []).map((p) => normText(p).trim()).filter((p) => p.length >= 3);
  return nameMatchesPatterns(name, patterns);
}

function itemKeepsAnnotation(item: RoamlyActivitySeed, verdicts: MustDoVerdictLike[]): boolean {
  return verdicts.some((v) => {
    if (v.status === "satisfied") return v.item === item.title || itemSatisfies(item, v);
    if (v.status === "exempt") return itemMatchesExempt(item, v);
    return false;
  });
}

function shouldStripItem(item: RoamlyActivitySeed, verdicts: MustDoVerdictLike[]): boolean {
  if (isUnresolvedMustDoPlaceholder(item)) return false;
  if (itemKeepsAnnotation(item, verdicts)) return false;
  return verdicts.some((v) => v.status === "unmet" && itemRelatedToUnmet(item, v));
}

/** Title-only form of the strip test, for must_do_items /
 *  protected_anchors entries (plain title strings). */
function shouldStripTitle(title: string, verdicts: MustDoVerdictLike[]): boolean {
  const pseudo: RoamlyActivitySeed = {
    title,
    location_name: title,
    description: "",
    estimated_cost: null,
    category: "Attraction",
    map_query: title,
    item_type: "activity",
    time_label: ""
  };
  if (itemKeepsAnnotation(pseudo, verdicts)) return false;
  return verdicts.some((v) => v.status === "unmet" && itemRelatedToUnmet(pseudo, v));
}

/**
 * Evaluate must-do specs against an itinerary's structured
 * activities — the same satisfaction semantics as solver.ts and
 * stagedMustDoVerification.verifyStagedMustDos, shared so the
 * zero-engine assembly checkpoint judges its document with the
 * identical test the staged pass uses.
 */
export function evaluateMustDoVerdicts(itinerary: RoamlyItinerary, specs: MustDoSpecLike[]): MustDoVerdictLike[] {
  const activities = (itinerary.daily_itinerary || [])
    .flatMap((day) => day.live_timeline || [])
    .filter((item) => !isUnresolvedMustDoPlaceholder(item));
  return specs.map((spec) => {
    const requiredPatterns = (spec.requiredPatterns || []).map((p) => normText(p).trim()).filter(Boolean);
    const requiredKinds = spec.requiredKinds || [];
    const base: MustDoVerdictLike = {
      id: spec.id,
      label: spec.label,
      status: "exempt",
      patterns: spec.patterns || [],
      requiredPatterns,
      requiredKinds,
      requiredNameAnchor: spec.requiredNameAnchor
    };
    if (!requiredPatterns.length && !requiredKinds.length) return base;
    const probe: MustDoVerdictLike = { ...base, status: "unmet" };
    let satisfying = activities.find((item) => itemSatisfies(item, probe));
    if (!satisfying && spec.requiredNameAnchor && !requiredKinds.length && requiredPatterns.length) {
      // Typo tolerance (owner requirement, 2026-11-09), the same
      // ONE tier the solver and the staged verification consult
      // (engine/placeNameMatch.ts): the exact satisfaction test
      // failed only because the traveller's spelling differs from
      // the record's true name. A unique unmistakable near-match
      // among the non-leg activities satisfies; anything less
      // certain leaves the verdict UNMET. The annotation strip
      // tests (itemSatisfies / itemRelatedToUnmet) stay exact —
      // fuzz never rescues a related place from being stripped,
      // and never strips anything itself.
      const named = activities.filter((item) => item.item_type !== "transfer" && item.item_type !== "travel");
      const winner = fuzzyPlaceWinner(
        requiredPatterns,
        named.map((item) => ({ name: `${item.title || ""} ${item.location_name || ""}`, item }))
      );
      if (winner) satisfying = winner.item;
    }
    if (satisfying) return { ...base, status: "satisfied" as const, item: satisfying.title };
    const relatedOnly = activities.some((item) => itemRelatedToUnmet(item, probe));
    return { ...base, status: "unmet" as const, reason: relatedOnly ? RELATED_ONLY_REASON : NO_MATCH_REASON };
  });
}

/**
 * Strip must-do annotations that present a related place as
 * satisfying an UNMET must-do. Returns the SAME object when
 * nothing changes (satisfied/exempt-only itineraries are
 * byte-for-byte untouched).
 */
export function reconcileMustDoAnnotations(itinerary: RoamlyItinerary, verdicts: MustDoVerdictLike[]): RoamlyItinerary {
  if (!verdicts.some((v) => v.status === "unmet")) return itinerary;
  let changed = false;
  const days = (itinerary.daily_itinerary || []).map((day): RoamlyDayPlan => {
    const protectedAnchorTitles = new Set(
      (day.live_timeline || []).filter((item) => item.plan_role === "protected_anchor").map((item) => item.title)
    );
    let dayChanged = false;
    const timeline = (day.live_timeline || []).map((item) => {
      const flagged = item.plan_role === "must_do" || item.must_do === true;
      if (!flagged || !shouldStripItem(item, verdicts)) return item;
      dayChanged = true;
      return {
        ...item,
        must_do: false,
        ...(item.plan_role === "must_do" ? { plan_role: "primary" as const } : {})
      };
    });
    // Titles this day actually annotates as must-dos (the list
    // itself, plus flagged timeline items). protected_anchors is a
    // MIXED list — the stay anchor / confirmed bookings ride in it
    // beside the must-do titles (the zero-engine conversion builds
    // it as [stay anchor, ...mustDo]) — so an anchors entry is only
    // a must-do annotation, and only strippable, when it is one of
    // those annotated titles. A stay whose name merely shares a
    // context word with an unmet label (a "Mountain …" lodge vs a
    // mountain-ride ask) is not presenting itself as satisfying
    // anything and is never stripped.
    const annotatedTitles = new Set<string>([
      ...(day.must_do_items || []),
      ...(day.live_timeline || [])
        .filter((item) => item.plan_role === "must_do" || item.must_do === true)
        .map((item) => item.title)
    ]);
    const filterList = (list: string[] | undefined, onlyAnnotated: boolean): string[] | undefined => {
      if (!list) return list;
      const kept = list.filter((entry) => {
        if (onlyAnnotated && (protectedAnchorTitles.has(entry) || !annotatedTitles.has(entry))) return true;
        return !shouldStripTitle(entry, verdicts);
      });
      if (kept.length !== list.length) dayChanged = true;
      return kept;
    };
    const mustDoItems = filterList(day.must_do_items, false);
    const protectedAnchors = filterList(day.protected_anchors, true);
    if (!dayChanged) return day;
    changed = true;
    return { ...day, live_timeline: timeline, must_do_items: mustDoItems, protected_anchors: protectedAnchors };
  });
  return changed ? { ...itinerary, daily_itinerary: days } : itinerary;
}

/**
 * The full verification surface shared by both generation paths:
 * reconcile the annotations, then name each unmet must-do in the
 * first day's primary_plan via namedMustSeeMiss (appended once —
 * a document that already carries the sentence is not duplicated).
 */
export function applyMustDoVerdicts(
  itinerary: RoamlyItinerary,
  verdicts: MustDoVerdictLike[],
  destination: string
): RoamlyItinerary {
  const reconciled = reconcileMustDoAnnotations(itinerary, verdicts);
  const unmet = verdicts.filter((v) => v.status === "unmet");
  if (!unmet.length || !reconciled.daily_itinerary?.length) return reconciled;
  const sentences = unmet.map((v) => namedMustSeeMiss(v.label, destination));
  const [first, ...rest] = reconciled.daily_itinerary;
  const existing = String(first.primary_plan || "").trim();
  const fresh = sentences.filter((s) => !existing.includes(s));
  if (!fresh.length) return reconciled;
  return {
    ...reconciled,
    daily_itinerary: [
      { ...first, primary_plan: existing ? `${existing} ${fresh.join(" ")}` : fresh.join(" ") },
      ...rest
    ]
  };
}
