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
  nine: "09:00",
  ten: "10:00",
  eight: "08:00",
  eleven: "11:00"
};
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
  unresolved: string[];
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

  const startMatch = lower.match(/no starts before (\w+)/);
  if (startMatch)
    c.earliestStart = TIME_WORDS[startMatch[1]] || (/\d/.test(startMatch[1]) ? startMatch[1] : null);
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

  const includeMatch = text.match(/include (.+?) please/i);
  if (includeMatch) {
    c.placeItems = includeMatch[1]
      .replace(/^also\s+/i, "")
      .split(/,?\s+and\s+|\s*,\s*/)
      .map((s) => s.trim())
      .filter(Boolean);
  } else unresolved.push('place-items: no "include … please" clause found');

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
