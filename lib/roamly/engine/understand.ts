import { fmt, normText, parseHhmm, parseNumberWords } from "@/lib/roamly/engine/util";
import type { EngineDay, EngineItem } from "@/lib/roamly/engine/util";

/*
 * understand — understanding dispatcher support (Phase 2 port of
 * the shadow zero-engine's understand.mjs).
 *
 * Rule-based constraint extraction from the traveler's written
 * request, plus the requirements checker that grades extraction
 * against the structured ground-truth spec and grades the finished
 * itinerary against the constraints. Anything the rules cannot
 * resolve is logged to UNRESOLVED (the Sophie-escalation queue in
 * embryo) — never guessed.
 *
 * Production adapter (DESIGN-PRODUCTION Phase 2): production intake
 * is STRUCTURED first — `constraintsFromStructured` maps the intake
 * fields straight onto the same constraint shape, and text
 * extraction remains the fallback for free-text requests. Unresolved
 * cases persist through an INJECTED SINK (the Phase 7 outbox shape)
 * instead of dying in a returned array: `extractConstraints` accepts
 * an optional sink and reports every unresolved entry to it, in
 * order, while still returning the shadow's array for parity.
 */

const TIME_WORDS: Record<string, string> = {
  six: "06:00",
  seven: "07:00",
  nine: "09:00",
  ten: "10:00",
  eight: "08:00",
  eleven: "11:00",
  twelve: "12:00"
};
const MINUTE_WORDS: Record<string, number> = {
  fifteen: 15,
  thirty: 30,
  "forty-five": 45,
  "forty five": 45
};

/** Parse the time phrase after "no starts before …" as a WHOLE:
 *  "eight thirty" is 08:30, "eight" is 08:00, "8:30" / "08:30" /
 *  "8" are their clock times. (Europe test, 2026-11-08: the old
 *  single-word capture read "eight thirty" as 08:00 — the minutes
 *  were silently dropped, so the traveller's 08:30 earliest start
 *  reached the solver as 08:00 and the day-3 rest marker was
 *  stamped 08:00 against their own stated constraint.) */
function parseEarliestStartPhrase(phrase: string): string | null {
  const p = phrase.trim().replace(/\s+/g, " ");
  const digit = p.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (digit) {
    const h = Number(digit[1]);
    const m = digit[2] ? Number(digit[2]) : 0;
    if (h > 23 || m > 59) return null;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  }
  const parts = p.split(" ");
  const hour = TIME_WORDS[parts[0]];
  if (!hour) return null;
  const minuteWord = parts.slice(1).join(" ");
  const minutes = minuteWord ? MINUTE_WORDS[minuteWord] : 0;
  if (minutes === undefined) return null;
  return `${hour.slice(0, 2)}:${String(minutes).padStart(2, "0")}`;
}
const DIET_RULES: [string, RegExp][] = [
  ["vegetarian", /\bvegetarian\b/],
  ["vegan", /\bvegan\b/],
  ["gluten free", /gluten\s*free/],
  ["peanuts", /peanut/],
  ["nuts", /\bnuts?\b/],
  ["eggs", /\beggs?\b/],
  ["shellfish", /shellfish/],
  ["lactose", /lactose/],
  ["dairy free", /dairy\s*free/],
  ["halal", /\bhalal\b/]
];
const ACCESS_RULES: [string, RegExp][] = [
  ["elevator", /elevator|lift/],
  ["ground floor", /ground floor/],
  ["crib", /\bcrib\b/],
  ["step free", /step\s*free/],
  ["few stairs", /few stairs|as few stairs/],
  ["stroller", /stroller/],
  ["quiet streets", /quiet streets/],
  ["gentle paths", /gentle paths|steep hikes/],
  ["short flat trails", /short flat trails|flat trails/]
];

export interface RestConstraint {
  type: "afternoon" | "morning";
  text: string;
}

export interface ExtractedConstraints {
  dietary: string[];
  access: string[];
  earliestStart?: string | null;
  rest?: RestConstraint | null;
  budgetAmount?: number | null;
  maxWalkKm?: number;
  placeItems?: string[];
  /** Must-see DESIRES stated in prose ("we would love a morning at
   *  a local food market", "plus time in one museum") — asks shaped
   *  as kinds of places, neither structured requirements nor
   *  "include … please" place items. Ship defect #3 (2026-10-22):
   *  the Paris E2E request stated its must-sees exactly this way
   *  and they were silently dropped — extraction now finds them,
   *  the solver matches them like any must-see, and an unmatched
   *  desire is NAMED in the day words (namedMustSeeMiss), never
   *  silently lost. */
  mustSeeDesires?: string[];
  unresolved: string[];
}

/* Desire-phrased must-sees: tightly anchored on purpose. A bare
 * "love" never fires ("a couple who love the mountains" is a
 * self-description, not an ask — the golden pool contains exactly
 * that sentence and must not grow a must-see). A segment only
 * counts when it names a KIND of place or experience the engine
 * can match against a pack. */
const DESIRE_KIND_NOUN =
  /museum|market|garden|park|beach|castle|falls|waterfall|lighthouse|ferry|tour|walk|viewpoint|gallery|theatre|theater|cinema|zoo|aquarium|palace|cathedral|bridge|tower|harbour|harbor|trail|springs|gondola|marketplace|river|winery|brewery|distillery|library|stadium|mosque|temple|church/;

function desireSegments(chunk: string): string[] {
  return chunk
    .split(/\s*,\s*(?:plus\s+|and\s+)?|\s+and\s+|\s+plus\s+/)
    .map((s) => s.trim().replace(/\.$/, ""))
    .filter((s) => s.length >= 3 && DESIRE_KIND_NOUN.test(s.toLowerCase()));
}

/** Extract desire-phrased must-sees from a free-text request.
 *  Returns the desire labels in statement order (dedupe against
 *  place items / structured requirements happens in the caller's
 *  shared must-see derivation). Unresolvable desire phrasing is
 *  reported through `unresolved`, never guessed into a place. */
export function extractMustSeeDesires(requestText: string, unresolved?: string[]): string[] {
  const out: string[] = [];
  const sentences = String(requestText || "").split(/(?<=[.!?])\s+/);
  for (const rawSentence of sentences) {
    const sentence = rawSentence.trim();
    if (!sentence) continue;
    const love = sentence.match(/(?:^|\b)(?:we\s+)?(?:would love|we'd love|love to have|love to visit|love to see|love to spend)\s+(.+)$/i);
    if (love) {
      const segments = desireSegments(love[1]);
      if (segments.length) out.push(...segments);
      else if (unresolved) unresolved.push(`must-see-desires: desire phrasing found but no place kind recognized in "${love[1].trim()}"`);
      continue;
    }
    const plus = sentence.match(/^plus\s+(.+)$/i);
    if (plus && DESIRE_KIND_NOUN.test(plus[1].toLowerCase())) out.push(...desireSegments(plus[1]));
  }
  return [...new Set(out.map((s) => s.trim()))].filter(Boolean).slice(0, 6);
}

/* Must-do HEAD nouns (2026-10-30, Banff gondola defect): a stated
 * must-do names an EXPERIENCE or KIND of place plus, often, a place
 * it happens at — "the gondola ride up Sulphur Mountain", "the ferry
 * ride across to Levis". The capitalized words are CONTEXT (where);
 * a lowercase kind noun is the ASK itself (what). A candidate that
 * matches only the context — the station at the top of the mountain,
 * reached by the very ride that was asked for — is a RELATED
 * attraction, not the must-do, and must never silently satisfy it.
 * The requirement derived here is what the solver enforces: a
 * candidate counts only when it names the head noun itself or is of
 * the head noun's kind. Labels whose only kind nouns are proper
 * nouns ("Montmorency Falls") carry no requirement — the proper
 * name IS the ask, and the existing pattern ladder governs. */
const MUST_SEE_HEAD_NOUNS: ReadonlySet<string> = new Set([
  "museum", "market", "garden", "park", "beach", "castle", "falls", "waterfall",
  "lighthouse", "ferry", "tour", "walk", "viewpoint", "gallery", "theatre",
  "theater", "cinema", "zoo", "aquarium", "palace", "cathedral", "bridge",
  "tower", "harbour", "harbor", "trail", "springs", "gondola", "marketplace",
  "river", "winery", "brewery", "distillery", "library", "stadium", "mosque",
  "temple", "church", "funicular", "tram", "cruise", "boat", "kayak", "canoe",
  "train"
]);

/** Head-noun -> solver kind, for the nouns whose kind the engine
 *  already speaks (plus gondola, whose candidates — when the data
 *  carries the ride at all — are typed for the lift itself). */
const MUST_SEE_HEAD_KINDS: Record<string, string> = {
  falls: "falls",
  waterfall: "falls",
  lighthouse: "lighthouse",
  ferry: "ferry",
  market: "market",
  museum: "museum",
  gondola: "gondola"
};

export interface MustSeeRequirement {
  /** Head nouns a satisfying candidate's NAME must contain (any). */
  patterns: string[];
  /** Kinds a satisfying candidate may carry instead of the name. */
  kinds: string[];
  /** True only when the requirement is the pure named-place
   *  anchor below: the patterns are the place's own proper-noun
   *  name, not head nouns. This is the one requirement shape the
   *  typo-tolerance tier (placeNameMatch.ts) may serve — a
   *  misspelled NAME can land on its nearest real place, while a
   *  head noun is a category word and is never fuzzed (a "hot
   *  springs" ask must not drift onto a creek named "Spring"). */
  nameAnchor?: boolean;
}

/** Derive the head-noun requirement from a must-do label: the
 *  lowercase (non-proper-noun) kind nouns in statement order.
 *
 *  Modifier rule (2026-11-01, Halifax ferry defect): when a label
 *  carries a head noun the engine can type-check (a MUST_SEE_HEAD_KINDS
 *  noun — ferry, museum, falls, lighthouse, market, gondola), THAT
 *  noun is the operative ask and the label's other head nouns are its
 *  modifiers/context. "One harbour ferry ride" asks for a FERRY;
 *  "harbour" only says which ferry. Letting the modifier satisfy the
 *  requirement on its own re-opened the related-attraction
 *  substitution this requirement exists to close: the solver matched
 *  the ferry must-see to "Indian Harbour Light" — a lighthouse
 *  excursion whose name contains "harbour" (6 letters, beating
 *  "ferry" at 5 in the solver's longest-pattern scoring) — reported
 *  it "scheduled", and the actual ferry ride vanished from the plan
 *  (Phase 5 harness, halifax-coastal: the day-2 ferry day became an
 *  excursion day and the budget golden moved 288 -> 294 on the
 *  changed item mix). The pattern ladder already treats bare
 *  "harbour" exactly this way — tier-3 context that never rides
 *  along when a kind word names the ask (generate.ts
 *  mustSeePatterns). A label with NO type-checkable head noun keeps
 *  every head noun it has (hot springs, funicular): there the nouns
 *  are all the requirement can honestly state. */
/** Sentence-openers that are never the place itself, for the
 *  named-place anchor below. */
const NON_PLACE_OPENERS: ReadonlySet<string> = new Set([
  "the", "a", "an", "one", "visit", "visiting", "see", "explore",
  "tour", "day", "trip", "take", "go", "going", "morning",
  "afternoon", "evening", "full"
]);

/** The proper-noun tokens of a label — the named place itself. */
function properNounAnchors(label: string): string[] {
  const out: string[] = [];
  const tokens = String(label || "").split(/[^A-Za-z0-9'’-]+/).filter(Boolean);
  tokens.forEach((raw, i) => {
    if (!/^[A-Z]/.test(raw) || raw.length < 3) return;
    const w = raw.toLowerCase();
    if (i === 0 && NON_PLACE_OPENERS.has(w)) return;
    if (!out.includes(w)) out.push(w);
  });
  return out;
}

export function mustSeeRequirement(label: string): MustSeeRequirement {
  const headNouns: string[] = [];
  for (const raw of String(label || "").split(/[^A-Za-z0-9'’-]+/)) {
    if (!raw || /^[A-Z]/.test(raw)) continue; // proper noun = context
    const w = raw.toLowerCase();
    if (MUST_SEE_HEAD_NOUNS.has(w) && !headNouns.includes(w)) headNouns.push(w);
  }
  const typed = headNouns.filter((w) => MUST_SEE_HEAD_KINDS[w]);
  const patterns = typed.length ? typed : headNouns;
  const kinds = [...new Set(patterns.map((p) => MUST_SEE_HEAD_KINDS[p]).filter(Boolean))];
  if (!patterns.length) {
    // Pure named-place ask (Europe test, 2026-11-08): the label
    // carries NO head noun at all — "a day trip to Versailles if it
    // fits the plan" — so the proper noun is not context, it IS the
    // ask. With no requirement, the pattern ladder's fallback
    // tokens did the satisfying: "plan" (from the conditional
    // clause) substring-matched "Histoire des Plantes", the solver
    // reported the day trip "scheduled" against a plant museum,
    // and the ask vanished with no unmet note. Anchor the
    // requirement on the place's own name: a candidate satisfies
    // the must-see only when it names that place; anything else
    // leaves the must-see honestly unmet, to be named in the day
    // words — built, or the honest reason, never a silent drop.
    // A capitalized kind noun still never becomes a KIND
    // requirement (kinds stay empty) — the anchor is a name test,
    // not a kind test.
    const anchors = properNounAnchors(label);
    if (anchors.length) return { patterns: anchors, kinds: [], nameAnchor: true };
  }
  return { patterns, kinds };
}

/** The honest sentence the day words carry when a must-see (from
 *  any source) could not be matched to a real place in the pack:
 *  the miss is named, never silently dropped and never invented
 *  around. Pure and deterministic — the composer appends it
 *  verbatim. */
export function namedMustSeeMiss(label: string, destination: string): string {
  const clean = label.trim().replace(/^one\s+/i, "a ").replace(/\.$/, "");
  return `One honest gap: you asked for ${clean}. The open place data for ${destination} has no verified match for it, so it is named here instead of being invented.`;
}

/** The injected persistence seam for unresolved cases (Phase 7's
 *  outbox shape: a kind + detail, appended in order). */
export interface UnresolvedSink {
  record(entry: { kind: string; detail: string }): void;
}

export function extractConstraints(
  requestText: string,
  sink?: UnresolvedSink | null
): ExtractedConstraints {
  const text = String(requestText || "");
  const lower = normText(text);
  const unresolved: string[] = [];
  const c: ExtractedConstraints = { dietary: [], access: [], unresolved };

  const startMatch = lower.match(
    /no starts before ([a-z]+(?:\s+(?:thirty|fifteen|forty[-\s]five))?|\d{1,2}(?::\d{2})?)/
  );
  if (startMatch) c.earliestStart = parseEarliestStartPhrase(startMatch[1]);
  if (!c.earliestStart) unresolved.push('earliest-start: no "no starts before …" clause found');

  if (/rest afternoon/.test(lower)) c.rest = { type: "afternoon", text: "one full rest afternoon in the middle" };
  else if (/slow morning|nothing booked/.test(lower)) c.rest = { type: "morning", text: "one slow morning with nothing booked" };
  else unresolved.push("rest: no rest clause recognized");

  const money = lower.match(/budget under ([a-z\s]+?) dollars/);
  if (money) {
    const v = parseNumberWords(money[1]);
    if (v) c.budgetAmount = v;
    else unresolved.push(`budget: could not parse "${money[1].trim()}"`);
  } else unresolved.push('budget: no "budget under … dollars" clause found');

  for (const [label, rx] of DIET_RULES) if (rx.test(lower)) c.dietary.push(label);
  for (const [label, rx] of ACCESS_RULES) if (rx.test(lower)) c.access.push(label);
  if (/avoid long walks|short and flat|never walk too far/.test(lower)) c.maxWalkKm = 1.0;
  else if (/walks between stops/.test(lower)) c.maxWalkKm = 1.5;

  // Place items are stated two natural ways: "… include a visit
  // to the Colosseum please" and "Please include a visit to the
  // Colosseum." Until Stage 7 (2026-11-11) only the first order
  // matched — the please-first form, the most natural way to write
  // the sentence, derived NO must-see and the named place competed
  // as an ordinary sight (the Colosseum tight-run watch: a 3-day
  // short ask missed it while the "include … please"-ordered long
  // ask scheduled it; day count was not the discriminator). Both
  // orders now derive, through the same cleanup and splitting.
  const includeMatch =
    text.match(/include (.+?) please/i) ||
    text.match(/please,?\s+include\s+(.+?)(?=\.|\n|$)/i);
  if (includeMatch) {
    c.placeItems = includeMatch[1]
      .replace(/^also\s+/i, "")
      .replace(/\s+please$/i, "")
      .split(/,?\s+and\s+|\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else unresolved.push('place-items: no "include … please" clause found');

  const desires = extractMustSeeDesires(text, unresolved);
  if (desires.length) c.mustSeeDesires = desires;

  if (sink) {
    for (const u of unresolved) {
      const kind = u.split(":")[0] || "unresolved";
      sink.record({ kind, detail: u });
    }
  }
  return c;
}

/* ------------------------------------------------------------------ */
/* Structured-intake adapter (production path)                         */
/* ------------------------------------------------------------------ */

export interface StructuredIntake {
  earliestStart?: string | null;
  restType?: "afternoon" | "morning" | null;
  restText?: string | null;
  budgetAmount?: number | null;
  dietary?: string[];
  access?: string[];
  maxWalkKm?: number | null;
  placeItems?: string[];
  mustSeeDesires?: string[];
}

/**
 * Map structured intake fields onto the constraint shape — no text
 * parsing, nothing to leave unresolved: what the traveler stated in
 * fields IS the constraint set. (Text extraction stays the fallback
 * for free-text requests.)
 */
export function constraintsFromStructured(intake: StructuredIntake): ExtractedConstraints {
  const c: ExtractedConstraints = {
    dietary: [...(intake.dietary || [])],
    access: [...(intake.access || [])],
    unresolved: []
  };
  if (intake.earliestStart != null) c.earliestStart = intake.earliestStart;
  if (intake.restType != null)
    c.rest = { type: intake.restType, text: intake.restText || "" };
  if (intake.budgetAmount != null) c.budgetAmount = intake.budgetAmount;
  if (intake.maxWalkKm != null) c.maxWalkKm = intake.maxWalkKm;
  if (intake.placeItems != null) c.placeItems = [...intake.placeItems];
  if (intake.mustSeeDesires != null) c.mustSeeDesires = [...intake.mustSeeDesires];
  return c;
}

/* ------------------------------------------------------------------ */
/* Ground truth + agreement                                            */
/* ------------------------------------------------------------------ */

/** The structured request spec a pool entry / intake record carries. */
export interface SpecEntry {
  request?: {
    earliestStart?: string;
    rest?: string;
    dietary?: string;
    access?: string[];
    placeItems?: string[];
  };
  budgetAmount?: number | null;
}

export interface TruthConstraints {
  earliestStart: string | null;
  rest: RestConstraint | null;
  budgetAmount: number | null;
  dietary: string[];
  access: string;
  placeItems: string[];
}

/** Canonical constraints from the entry's structured spec (ground truth). */
export function specConstraints(entry: SpecEntry): TruthConstraints {
  const spec = entry.request || {};
  return {
    earliestStart: spec.earliestStart || null,
    rest: spec.rest
      ? { type: /morning/.test(spec.rest) ? "morning" : "afternoon", text: spec.rest }
      : null,
    budgetAmount: entry.budgetAmount ?? null,
    dietary: DIET_RULES.filter(([, rx]) => rx.test(normText(spec.dietary || ""))).map(([label]) => label),
    access: (spec.access || []).join(" "),
    placeItems: spec.placeItems || []
  };
}

export interface AgreementRow {
  id: string;
  extracted: string;
  truth: string;
  agree: boolean;
}

export function agreementReport(
  extracted: ExtractedConstraints,
  truth: TruthConstraints
): AgreementRow[] {
  const rows: AgreementRow[] = [];
  const cmp = (id: string, a: unknown, b: unknown): void => {
    const render = (x: unknown): string => JSON.stringify(x) ?? "undefined";
    rows.push({ id, extracted: render(a), truth: render(b), agree: JSON.stringify(a) === JSON.stringify(b) });
  };
  cmp("earliest-start", extracted.earliestStart ?? null, truth.earliestStart);
  cmp("rest-type", extracted.rest?.type ?? null, truth.rest?.type ?? null);
  cmp("budget", extracted.budgetAmount ?? null, truth.budgetAmount);
  cmp("dietary", [...(extracted.dietary || [])].sort(), [...(truth.dietary || [])].sort());
  cmp("place-items-count", (extracted.placeItems || []).length, (truth.placeItems || []).length);
  return rows;
}

/* ------------------------------------------------------------------ */
/* Requirements grading                                                */
/* ------------------------------------------------------------------ */

export interface RequirementCheck {
  id: string;
  kind: string;
  label?: string;
  patterns?: string[];
}

export interface RequirementVerdict {
  id: string;
  verdict: "KEPT" | "VIOLATED" | "UNVERIFIABLE";
  evidence: string;
}

export interface GradeItinerary {
  days?: (EngineDay & { narrative?: string | string[] })[];
}

/** Grade the finished itinerary against the ground-truth constraints. */
export function gradeRequirements(
  itinerary: GradeItinerary,
  truth: TruthConstraints,
  checks: RequirementCheck[] | null | undefined
): RequirementVerdict[] {
  const verdicts: RequirementVerdict[] = [];
  const days = itinerary.days || [];
  const allItems: (EngineItem & { day: number })[] = days.flatMap((d) =>
    d.items.map((i) => ({ ...i, day: d.dayNumber }))
  );
  const timed = allItems.filter((i) => i.start != null);

  if (truth.earliestStart) {
    const thr = parseHhmm(truth.earliestStart) ?? 0;
    const bad = timed.filter((i) => i.type !== "rest" && i.start < thr);
    verdicts.push({
      id: "earliest-start",
      verdict: bad.length ? "VIOLATED" : "KEPT",
      evidence: bad.length
        ? `${bad.length} item(s) start before ${truth.earliestStart}: ${bad.map((b) => `day ${b.day} ${fmt(b.start)} ${b.name || b.title}`).join("; ")}`
        : `all ${timed.filter((i) => i.type !== "rest").length} timed items start at or after ${truth.earliestStart}`
    });
  }
  if (truth.rest) {
    const mid = days[Math.floor(days.length / 2)];
    const restItem = mid?.items.find((i) => i.type === "rest");
    verdicts.push({
      id: "rest-block",
      verdict: restItem ? "KEPT" : "VIOLATED",
      evidence: restItem
        ? `day ${mid.dayNumber} carries an explicit rest block (${restItem.title}, ${fmt(restItem.start)}–${fmt(restItem.end)})`
        : `middle day (day ${mid?.dayNumber}) has no explicit rest block`
    });
  }
  const hay = days
    .flatMap((d) => [
      Array.isArray(d.narrative) ? d.narrative.join("\n") : d.narrative || "",
      ...d.items.flatMap((i) => [i.title || "", i.name || ""])
    ])
    .join("\n")
    .toLowerCase();
  for (const chk of checks || []) {
    if (chk.kind !== "keyword") continue;
    const hit = (chk.patterns || []).find((p) => hay.includes(String(p).toLowerCase()));
    verdicts.push({
      id: chk.id,
      verdict: hit ? "KEPT" : "VIOLATED",
      evidence: hit ? `itinerary mentions "${hit}" (${chk.label})` : `nothing in the itinerary matches ${chk.label}`
    });
  }
  const repeats: (string | undefined)[] = [];
  const seen = new Map<string, boolean>();
  for (const i of allItems) {
    if (i.type === "rest") continue;
    const k = (i.name || "").toLowerCase();
    if (seen.has(k)) repeats.push(i.name);
    seen.set(k, true);
  }
  verdicts.push({
    id: "no-repeat",
    verdict: repeats.length ? "VIOLATED" : "KEPT",
    evidence: repeats.length
      ? `repeated: ${repeats.join(", ")}`
      : "no place is scheduled twice across the trip"
  });

  const lunches = allItems.filter((i) => i.type === "food");
  if ((truth.dietary || []).length) {
    const strong = lunches.filter((i) => i.diet?.strong);
    const needsEggFree = truth.dietary.includes("eggs");
    const eggCovered = lunches.length > 0 && lunches.every((i) => i.diet?.veganOnly);
    if (needsEggFree && !eggCovered) {
      verdicts.push({
        id: "dietary",
        verdict: "UNVERIFIABLE",
        evidence: `egg-free can only be proven at vegan-only kitchens; ${lunches.filter((i) => i.diet?.veganOnly).length} of ${lunches.length} lunches qualify — the rest stay honestly unverified`
      });
    } else {
      verdicts.push({
        id: "dietary",
        verdict: strong.length === lunches.length && lunches.length ? "KEPT" : "UNVERIFIABLE",
        evidence: `${strong.length} of ${lunches.length} lunches carry explicit dietary tags in the data (${truth.dietary.join(", ")})`
      });
    }
  }
  verdicts.push({
    id: "budget-cap",
    verdict: "UNVERIFIABLE",
    evidence: `open data carries no prices: a cap of ${truth.budgetAmount} cannot be totaled or checked — never faked as met`
  });
  return verdicts;
}
