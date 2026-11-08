/**
 * TRIP BUILDER RULES ENGINE — the declarative question + rules layer
 * of Roamly Intelligence (Phase 0/1 foundation; DECISION-TREE.md is
 * the spec, ARCHITECTURE-ASSESSMENT.md the design record).
 *
 * SHAPE PROVENANCE (Phase 1 repo study; owner's standing free-repo
 * authorization, 2026-11-08):
 *   - The form of this module — questions and IF/THEN/ELSE rules as
 *     JSON-shaped DATA, a fixed named operator vocabulary, rules
 *     fully separated from any UI — is FORMOSAIC's shape
 *     (bghcore/formosaic, MIT — LICENSE file verified from the repo,
 *     2026-11-08). Ported as Roamly's own code in that shape; no
 *     Formosaic code is copied.
 *   - The guided-journey discipline — questions as data rendered
 *     through Roamly's own components, branching as schema
 *     properties — is TUTIM's pattern set (TutimIO/tutim; MIT per
 *     the project's npm metadata + README badge; no LICENSE file
 *     exists at the repo root, so Tutim is PATTERNS-ONLY here and
 *     no Tutim code is copied).
 *   - The flow model — an explicit loop over a declarative question
 *     set with the evaluated result as a first-class output — is
 *     the USDS Question Flow pattern (CC0).
 *
 * THE BOUNDARY LAW (owner): this module asks questions and
 * evaluates conditions. It NEVER decides whether a hotel is safe
 * or a flight is affordable. Travel semantics live in the domain
 * engines (transport today: lib/roamly/transportOptions.ts, whose
 * TRANSPORT_LOGIC_RULES stay the transport authority). Engines
 * hand this layer FACTS; this layer returns which questions are
 * visible, which named rules fire, what the next question is, and
 * whether the completion test passes. Effects are returned as
 * data for the caller to apply — nothing here mutates a trip.
 *
 * NOT WIRED INTO THE CUSTOMER FLOW. Engine + checks only
 * (test:trip-builder-rules); the flow rebuild follows the owner's
 * Phase 1 architecture inspection.
 */

// ---------------------------------------------------------------------------
// Conditions — Formosaic-shaped data: leaf tests + AND / OR / NOT.
// ---------------------------------------------------------------------------

/**
 * The operator vocabulary — fixed and named, Formosaic-style
 * (~20 operators, no free-form logic). A rule that cannot be said
 * in these operators is a rule that gets a new named operator
 * added here deliberately, never an inline function.
 */
export type BuilderRuleOperator =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte"
  | "between"
  | "in"
  | "notIn"
  | "contains"
  | "notContains"
  | "startsWith"
  | "endsWith"
  | "matches"
  | "isSet"
  | "isNotSet"
  | "isTrue"
  | "isFalse"
  | "isEmpty"
  | "isNotEmpty";

export const BUILDER_RULE_OPERATORS: readonly BuilderRuleOperator[] = [
  "eq",
  "neq",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "in",
  "notIn",
  "contains",
  "notContains",
  "startsWith",
  "endsWith",
  "matches",
  "isSet",
  "isNotSet",
  "isTrue",
  "isFalse",
  "isEmpty",
  "isNotEmpty"
] as const;

export type BuilderCondition =
  | { field: string; op: BuilderRuleOperator; value?: unknown }
  | { all: BuilderCondition[] }
  | { any: BuilderCondition[] }
  | { not: BuilderCondition };

/** The scope conditions read: question ids resolve against
 *  `answers`, engine facts against `facts` (dot paths). */
export interface BuilderScope {
  answers: Record<string, unknown>;
  facts: BuilderFacts;
}

/**
 * The facts the domain engines hand this layer. Every field is a
 * grounded output of an engine (transport, budget, stay, evidence)
 * — this module computes none of them. All optional: an absent
 * fact is an unknown, and conditions over unknowns are false
 * (except the explicit is* tests), never silently true.
 */
export interface BuilderFacts {
  /** Transport engine (transportOptions.ts) */
  modeWithoutService?: string | null;
  driveMinutes?: number | null;
  driveConsidered?: boolean;
  driveExcludedTooFar?: boolean;
  flightUsable?: boolean;
  pickedModeHardExcluded?: boolean;
  flightBustsBudget?: boolean;
  driveFits?: boolean;
  multipleOptionsFit?: boolean;
  driveAwayOverride?: boolean;
  /** Budget validator (derived by deriveBuilderFacts when cents are given) */
  projectedTotalCents?: number;
  budgetCents?: number;
  overBudget?: boolean;
  budgetTight?: boolean;
  budgetRaised?: boolean;
  /** Hard constraints (Q9) — set by the caller's eligibility checks */
  hardConstraintBroken?: boolean;
  /** Stay / activities engines */
  stayPushesOver?: boolean;
  chosenStayUnavailable?: boolean;
  activityClosedOnDay?: boolean;
  /** Weather / safety / events / disruption engines */
  severeWeatherOutdoor?: boolean;
  demonstrationNearAttraction?: boolean;
  violenceNearStayCorroborated?: boolean;
  eventSpike?: boolean;
  freeEventMatchesInterests?: boolean;
  roadClosureOnRoute?: boolean;
  /** Set by the loop when builderCompletionTest's first four
   *  conditions hold — mirrors the QF gate for data-only renderers. */
  completionReady?: boolean;
  /** Bookings + evidence layer */
  bookingConflict?: boolean;
  sourcesDisagree?: boolean;
  alertExpired?: boolean;
  sourceUnavailable?: boolean;
}

/** Fill the two derived budget facts from the validator's cents so
 *  rule conditions stay declarative (B2/B3 thresholds live here,
 *  once — the tight threshold is the DECISION-TREE's 86%). */
export const BUILDER_BUDGET_TIGHT_RATIO = 0.86;

export function deriveBuilderFacts(facts: BuilderFacts): BuilderFacts {
  const out: BuilderFacts = { ...facts };
  if (typeof out.projectedTotalCents === "number" && typeof out.budgetCents === "number" && out.budgetCents > 0) {
    if (out.overBudget === undefined) out.overBudget = out.projectedTotalCents > out.budgetCents;
    if (out.budgetTight === undefined) {
      out.budgetTight = out.projectedTotalCents >= out.budgetCents * BUILDER_BUDGET_TIGHT_RATIO;
    }
  }
  return out;
}

function readPath(scope: BuilderScope, field: string): unknown {
  const parts = field.split(".");
  let current: unknown = scope as unknown;
  for (const part of parts) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }
  if (typeof a === "object") {
    const aKeys = Object.keys(a as Record<string, unknown>);
    const bKeys = Object.keys(b as Record<string, unknown>);
    if (aKeys.length !== bKeys.length) return false;
    return aKeys.every((key) =>
      deepEqual((a as Record<string, unknown>)[key], (b as Record<string, unknown>)[key])
    );
  }
  return false;
}

function isEmptyValue(value: unknown): boolean {
  if (value === undefined || value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === "object") return Object.keys(value as Record<string, unknown>).length === 0;
  return false;
}

function compareOrdered(fieldValue: unknown, value: unknown): number | null {
  if (typeof fieldValue === "number" && typeof value === "number") return fieldValue - value;
  if (typeof fieldValue === "string" && typeof value === "string") {
    return fieldValue < value ? -1 : fieldValue > value ? 1 : 0;
  }
  return null;
}

function applyOperator(op: BuilderRuleOperator, fieldValue: unknown, value: unknown): boolean {
  switch (op) {
    case "eq":
      return deepEqual(fieldValue, value);
    case "neq":
      return !deepEqual(fieldValue, value);
    case "gt": {
      const c = compareOrdered(fieldValue, value);
      return c !== null && c > 0;
    }
    case "gte": {
      const c = compareOrdered(fieldValue, value);
      return c !== null && c >= 0;
    }
    case "lt": {
      const c = compareOrdered(fieldValue, value);
      return c !== null && c < 0;
    }
    case "lte": {
      const c = compareOrdered(fieldValue, value);
      return c !== null && c <= 0;
    }
    case "between": {
      if (!Array.isArray(value) || value.length !== 2) return false;
      const lo = compareOrdered(fieldValue, value[0]);
      const hi = compareOrdered(fieldValue, value[1]);
      return lo !== null && hi !== null && lo >= 0 && hi <= 0;
    }
    case "in":
      return Array.isArray(value) && value.some((item) => deepEqual(fieldValue, item));
    case "notIn":
      return Array.isArray(value) && !value.some((item) => deepEqual(fieldValue, item));
    case "contains":
      if (Array.isArray(fieldValue)) return fieldValue.some((item) => deepEqual(item, value));
      if (typeof fieldValue === "string" && typeof value === "string") return fieldValue.includes(value);
      return false;
    case "notContains":
      if (Array.isArray(fieldValue)) return !fieldValue.some((item) => deepEqual(item, value));
      if (typeof fieldValue === "string" && typeof value === "string") return !fieldValue.includes(value);
      return false;
    case "startsWith":
      return typeof fieldValue === "string" && typeof value === "string" && fieldValue.startsWith(value);
    case "endsWith":
      return typeof fieldValue === "string" && typeof value === "string" && fieldValue.endsWith(value);
    case "matches":
      return typeof fieldValue === "string" && typeof value === "string" && new RegExp(value).test(fieldValue);
    case "isSet":
      return fieldValue !== undefined && fieldValue !== null;
    case "isNotSet":
      return fieldValue === undefined || fieldValue === null;
    case "isTrue":
      return fieldValue === true;
    case "isFalse":
      return fieldValue === false;
    case "isEmpty":
      return isEmptyValue(fieldValue);
    case "isNotEmpty":
      return !isEmptyValue(fieldValue);
    default:
      return false;
  }
}

/** Evaluate one declarative condition against answers + facts. */
export function evaluateBuilderCondition(condition: BuilderCondition, scope: BuilderScope): boolean {
  if ("all" in condition) return condition.all.every((child) => evaluateBuilderCondition(child, scope));
  if ("any" in condition) return condition.any.some((child) => evaluateBuilderCondition(child, scope));
  if ("not" in condition) return !evaluateBuilderCondition(condition.not, scope);
  return applyOperator(condition.op, readPath(scope, condition.field), condition.value);
}

// ---------------------------------------------------------------------------
// Questions — DECISION-TREE.md's definitions as data (Tutim's shape:
// the interview is one declarative config; branching is a property
// of the question, never screen code). Prompts are the face words.
// ---------------------------------------------------------------------------

export type BuilderQuestionInput =
  | "choice"
  | "choice-search"
  | "dates"
  | "stepper"
  | "amount"
  | "photo-cards"
  | "multi-choice"
  | "text"
  | "confirm";

export type BuilderQuestionStage = "core" | "refine" | "constraint" | "finalize";

export interface BuilderQuestionDef {
  id: string;
  prompt: string;
  input: BuilderQuestionInput;
  stage: BuilderQuestionStage;
  required: boolean;
  /** Absent = always visible. Present = visible ONLY IF it holds. */
  appearsWhen?: BuilderCondition;
  /** What this answer feeds (documentation of the completeness law). */
  feeds: string;
}

const DRIVE_CONSIDERED: BuilderCondition = {
  any: [
    { field: "answers.Q7", op: "eq", value: "drive" },
    { field: "facts.driveConsidered", op: "isTrue" }
  ]
};

export const TRIP_BUILDER_QUESTIONS: readonly BuilderQuestionDef[] = [
  { id: "Q1", prompt: "Where are you leaving from?", input: "choice-search", stage: "core", required: true, feeds: "Routing, drive distance, all transport costing" },
  { id: "Q2", prompt: "Where are you going?", input: "choice-search", stage: "core", required: true, feeds: "Every engine's geography" },
  { id: "Q3", prompt: "When are you going?", input: "dates", stage: "core", required: true, feeds: "Pricing, availability, events window, weather horizon" },
  { id: "Q4", prompt: "Are your dates flexible?", input: "choice", stage: "core", required: true, feeds: "Constraint levers (dates become changeable in the over-budget conversation)" },
  { id: "Q5", prompt: "Who's going?", input: "stepper", stage: "core", required: true, feeds: "Per-person costs (flights, food, activities); driving is per-vehicle" },
  { id: "Q6", prompt: "What's your total budget?", input: "amount", stage: "core", required: true, feeds: "The validator; the internal split; every suggestion" },
  { id: "Q7", prompt: "How will you get there?", input: "photo-cards", stage: "core", required: true, feeds: "Transport engine; the single biggest split line" },
  {
    id: "Q7a",
    prompt: "Your car",
    input: "choice",
    stage: "core",
    required: true,
    appearsWhen: DRIVE_CONSIDERED,
    feeds: "Fuel cost (NRCan class consumption × live gas price)"
  },
  {
    id: "Q7b",
    prompt: "Driving is too long for one day. Drive anyway?",
    input: "choice",
    stage: "core",
    required: true,
    // ONLY IF the drive breaks the 8-hour rule AND driving is in play.
    // The face fills the prompt's duration from the transport fact;
    // the definition carries the condition, not the number.
    appearsWhen: {
      all: [{ field: "facts.driveMinutes", op: "gt", value: 480 }, DRIVE_CONSIDERED]
    },
    feeds: "Overrides TOO_FAR_TO_DRIVE (the traveller's explicit answer disarms the hard rule)"
  },
  { id: "Q8", prompt: "Where will you stay?", input: "choice", stage: "core", required: true, feeds: "Accommodation engine; stay split line" },
  { id: "Q9", prompt: "Anything we must plan around?", input: "multi-choice", stage: "core", required: true, feeds: "Hard constraints → eligibility. An option that breaks one is excluded, never just ranked down" },
  { id: "Q10", prompt: "Anything you must not miss?", input: "text", stage: "core", required: false, feeds: "Must-do protection: locked in the optimizer" },
  { id: "Q11", prompt: "Already booked anything?", input: "choice", stage: "core", required: true, feeds: "Booking priority: confirmed bookings outrank every suggestion (Gmail Recon only)" },
  { id: "Q12", prompt: "What do you love doing?", input: "multi-choice", stage: "refine", required: false, feeds: "Ranking only — never eligibility" },
  { id: "Q13", prompt: "What pace feels right?", input: "choice", stage: "refine", required: false, feeds: "Day density in generation" },
  { id: "Q14", prompt: "Food — anything to know?", input: "multi-choice", stage: "refine", required: false, feeds: "Food split + picks" },
  {
    id: "QC",
    prompt: "Your trip is over your budget. What would you like to change?",
    input: "choice",
    stage: "constraint",
    required: true,
    // ONLY IF the projected total exceeds the budget, at any stage.
    appearsWhen: { field: "facts.overBudget", op: "isTrue" },
    feeds: "Concrete levers, each recalculated: cheaper stay / fewer paid activities / different transport / different dates (ONLY IF Q4 ≠ Fixed) / bigger budget (edit Q6)"
  },
  {
    id: "QF",
    prompt: "Shall we build this trip?",
    input: "confirm",
    stage: "finalize",
    required: true,
    // ONLY IF the completion test passes — the loop offers QF when
    // builderCompletionTest's first four conditions hold; visibility
    // here mirrors that gate for renderers that ask the data only.
    appearsWhen: { field: "facts.completionReady", op: "isTrue" },
    feeds: "Generation. Nothing finalizes before this"
  }
] as const;

// ---------------------------------------------------------------------------
// Rules — DECISION-TREE.md's named table as data. Kind: hard =
// eligibility (excludes), ranking = orders, law = always-on budget
// discipline, reaction = engine event response, evidence = the
// verification layer's discipline. The `effect` text is the spec's
// "Then" column; applying an effect is the caller's domain work.
// ---------------------------------------------------------------------------

export type BuilderRuleKind = "hard" | "ranking" | "law" | "reaction" | "evidence";

export interface BuilderRuleDef {
  id: string;
  name: string;
  kind: BuilderRuleKind;
  /** "always" for laws that hold on every evaluation. */
  when: BuilderCondition | "always";
  effect: string;
}

const fact = (field: string): BuilderCondition => ({ field: `facts.${field}`, op: "isTrue" });

export const TRIP_BUILDER_RULES: readonly BuilderRuleDef[] = [
  { id: "T1", name: "NO_SERVICE", kind: "hard", when: { field: "facts.modeWithoutService", op: "isSet" }, effect: "The mode named by the fact is excluded; one quiet line on the face (\"Train — no service on this route\")" },
  {
    id: "T2",
    name: "TOO_FAR_TO_DRIVE",
    kind: "hard",
    when: {
      all: [
        { field: "facts.driveMinutes", op: "gt", value: 480 },
        {
          not: {
            any: [
              { field: "answers.Q7", op: "isSet" },
              { field: "answers.Q7b", op: "eq", value: "yes" },
              { field: "facts.driveAwayOverride", op: "isTrue" }
            ]
          }
        }
      ]
    },
    effect: "Drive excluded as a suggestion; Q7b may override (traveller-overridable hard rule)"
  },
  { id: "T3", name: "FLIGHT_ONLY", kind: "hard", when: { all: [fact("driveExcludedTooFar"), fact("flightUsable")] }, effect: "Fly is the only suggestion" },
  {
    id: "T4",
    name: "TRAVELLER_PREFERENCE",
    kind: "ranking",
    when: {
      all: [{ field: "answers.Q7", op: "isSet" }, { not: fact("pickedModeHardExcluded") }]
    },
    effect: "The traveller's explicit pick is honoured above inferred preference"
  },
  { id: "T5", name: "BUDGET_LOW_DRIVE", kind: "ranking", when: { all: [fact("flightBustsBudget"), fact("driveFits")] }, effect: "Drive suggested (budget is tight by the trip's own fit formula AND drive is practical)" },
  { id: "T6", name: "BEST_BALANCE", kind: "ranking", when: fact("multipleOptionsFit"), effect: "Suggest the best balance of cost/time; reason stated in one line" },
  { id: "B1", name: "ONE_BUDGET", kind: "law", when: "always", effect: "The traveller sees ONE total. The split (transport / stay / food / activities / fees / contingency) is internal and always sums to the projection" },
  { id: "B2", name: "OVER_BUDGET", kind: "law", when: fact("overBudget"), effect: "Stop and run QC with concrete, recalculated alternatives. Never quietly trim the plan to fit" },
  { id: "B3", name: "TIGHT", kind: "ranking", when: fact("budgetTight"), effect: "Projection ≥ 86% of budget: say so plainly before confirm" },
  { id: "A1", name: "STAY_OVER", kind: "reaction", when: fact("stayPushesOver"), effect: "QC fires with the stay lever priced first" },
  { id: "A2", name: "STAY_GONE", kind: "reaction", when: fact("chosenStayUnavailable"), effect: "Next suitable option from the ≥3 compared; recalculate; say what changed" },
  { id: "C1", name: "CLOSED_DAY", kind: "reaction", when: fact("activityClosedOnDay"), effect: "Move the activity to an open day or replace it; recalculate" },
  { id: "W1", name: "WEATHER_OUTDOOR", kind: "reaction", when: fact("severeWeatherOutdoor"), effect: "Move indoors / reschedule; if on the drive day → re-run the transport rules (delay, or fly)" },
  { id: "S1", name: "DEMO_PEACEFUL", kind: "reaction", when: fact("demonstrationNearAttraction"), effect: "Investigate (proximity, timing, severity, corroboration, official instructions); reroute or retime; keep the attraction if accessible and safe. A peaceful rally is not automatically a threat" },
  { id: "S2", name: "VIOLENCE_NEAR_STAY", kind: "reaction", when: fact("violenceNearStayCorroborated"), effect: "Flag it, offer alternative accommodation, notify if the trip is active" },
  { id: "E1", name: "EVENT_SPIKE", kind: "reaction", when: fact("eventSpike"), effect: "Other neighbourhoods, transit comparison, alternate dates ONLY IF Q4 allows, recalculate" },
  { id: "E2", name: "EVENT_FREE", kind: "reaction", when: fact("freeEventMatchesInterests"), effect: "Suggest the free festival, adjust the day, recalculate" },
  { id: "F1", name: "ROAD_CLOSED", kind: "reaction", when: fact("roadClosureOnRoute"), effect: "Re-route; if driving becomes impractical, re-run T1–T6" },
  { id: "K1", name: "BOOKING_WINS", kind: "hard", when: fact("bookingConflict"), effect: "The confirmed booking stays; the suggestion moves" },
  { id: "X1", name: "CONFLICTING_NEWS", kind: "evidence", when: fact("sourcesDisagree"), effect: "Present as REPORTED/UNVERIFIED, never as settled; no plan change on uncorroborated news alone" },
  { id: "X2", name: "EXPIRED", kind: "evidence", when: fact("alertExpired"), effect: "The alert stops affecting the itinerary; the record stays, flagged EXPIRED" },
  { id: "X3", name: "NO_SOURCE", kind: "evidence", when: fact("sourceUnavailable"), effect: "Planning continues; the gap is disclosed (\"weather could not be verified\"), never silently passed over. Absence of alerts is never presented as proof of safety" }
] as const;

/** Rules whose conditions hold right now, in table order. The
 *  caller applies the effects in its own domain — feasibility
 *  beats budget because the table is ordered hard-first. */
export function firedBuilderRules(answers: Record<string, unknown>, facts: BuilderFacts): BuilderRuleDef[] {
  const scope: BuilderScope = { answers, facts: deriveBuilderFacts(facts) };
  return TRIP_BUILDER_RULES.filter((rule) => rule.when === "always" || evaluateBuilderCondition(rule.when, scope));
}

// ---------------------------------------------------------------------------
// The question loop (DECISION-TREE.md): answers are the only state.
// ---------------------------------------------------------------------------

export function isBuilderAnswered(answers: Record<string, unknown>, questionId: string): boolean {
  return !isEmptyValue(answers[questionId]);
}

export function visibleBuilderQuestions(
  answers: Record<string, unknown>,
  facts: BuilderFacts
): BuilderQuestionDef[] {
  const scope: BuilderScope = { answers, facts: deriveBuilderFacts(facts) };
  return TRIP_BUILDER_QUESTIONS.filter(
    (question) => question.appearsWhen === undefined || evaluateBuilderCondition(question.appearsWhen, scope)
  );
}

export interface BuilderCompletion {
  pass: boolean;
  /** Named unmet conditions, in the spec's order. Empty when pass. */
  unmet: string[];
}

/**
 * The completion test — ALL five must hold before QF is offered:
 * 1. every required question answered (QF itself excluded);
 * 2. no hard constraint broken — including the Q7b gate: a >8h
 *    drive chosen without the traveller's explicit override is a
 *    broken constraint, not a preference;
 * 3. projected total ≤ budget — or a QC lever was picked, or the
 *    traveller consciously raised the budget;
 * 4. no unresolved conflict between a confirmed booking and the plan;
 * 5. the traveller confirms (QF answered).
 */
export function builderCompletionTest(
  answers: Record<string, unknown>,
  facts: BuilderFacts
): BuilderCompletion {
  const derived = deriveBuilderFacts(facts);
  const unmet: string[] = [];

  const visible = visibleBuilderQuestions(answers, derived);
  const missingRequired = visible.filter(
    (question) => question.required && question.id !== "QF" && !isBuilderAnswered(answers, question.id)
  );
  if (missingRequired.length) unmet.push(`required-answers:${missingRequired.map((q) => q.id).join(",")}`);

  const longDriveUngated =
    typeof derived.driveMinutes === "number" &&
    derived.driveMinutes > 480 &&
    answers.Q7 === "drive" &&
    answers.Q7b !== "yes" &&
    derived.driveAwayOverride !== true;
  if (derived.hardConstraintBroken === true || longDriveUngated) unmet.push("hard-constraints");

  if (derived.overBudget === true && !isBuilderAnswered(answers, "QC") && derived.budgetRaised !== true) {
    unmet.push("over-budget");
  }

  if (derived.bookingConflict === true) unmet.push("booking-conflict");

  if (answers.QF !== true) unmet.push("not-confirmed");

  return { pass: unmet.length === 0, unmet };
}

/**
 * The loop's next move, in the spec's order: an over-budget trip
 * asks QC before anything else; otherwise the most important
 * unresolved question (definition order = importance order);
 * when only confirmation is missing, QF; when the completion
 * test passes, null — build the trip.
 */
export function nextBuilderQuestion(
  answers: Record<string, unknown>,
  facts: BuilderFacts
): BuilderQuestionDef | null {
  const derived = deriveBuilderFacts(facts);
  const completion = builderCompletionTest(answers, derived);
  if (completion.pass) return null;

  const byId = new Map(TRIP_BUILDER_QUESTIONS.map((question) => [question.id, question]));

  if (derived.overBudget === true && !isBuilderAnswered(answers, "QC")) {
    return byId.get("QC") ?? null;
  }

  const visible = visibleBuilderQuestions(answers, derived);
  const next = visible.find(
    (question) => question.id !== "QF" && question.id !== "QC" && !isBuilderAnswered(answers, question.id)
  );
  if (next) return next;

  if (completion.unmet.length === 1 && completion.unmet[0] === "not-confirmed") {
    return byId.get("QF") ?? null;
  }
  return null;
}
