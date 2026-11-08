// Trip Builder rules engine (Phase 0/1 foundation, 2026-11-08).
// lib/roamly/tripBuilderRules.ts: questions + IF/THEN/ELSE rules as
// DATA (Formosaic's shape, ported; Tutim's guided-journey patterns),
// a fixed 20-operator vocabulary, rules separated from UI. The layer
// asks and evaluates — it never makes a travel decision. These
// checks pin:
//   - every operator, true and false cases;
//   - AND/OR/NOT composition;
//   - conditional questions: Q7a only when driving is in play, Q7b
//     only past the 8-hour rule, QC only when over budget, QF only
//     when the loop marks completion ready;
//   - the named rule table firing on engine facts (the Montreal
//     shape: T1 train no-service, T2 too-far, T3 flight-only; the
//     traveller's explicit drive answer disarming T2; QC's law B2);
//   - the question loop: QC before anything else when over budget,
//     definition order otherwise, QF when only confirmation is
//     missing, null when the completion test passes;
//   - the completion test's five conditions, named when unmet.
import assert from "node:assert/strict";

const rules = await import("../lib/roamly/tripBuilderRules.ts");
const {
  BUILDER_RULE_OPERATORS,
  TRIP_BUILDER_QUESTIONS,
  TRIP_BUILDER_RULES,
  evaluateBuilderCondition,
  deriveBuilderFacts,
  firedBuilderRules,
  visibleBuilderQuestions,
  builderCompletionTest,
  nextBuilderQuestion
} = rules;

let passed = 0;
let failed = 0;
function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`ok ${passed + failed} - ${name}`);
  } catch (err) {
    failed++;
    console.log(`not ok ${passed + failed} - ${name}`);
    console.log(`  ${String((err && err.message) || err).split("\n").join("\n  ")}`);
  }
}

const scope = (answers = {}, facts = {}) => ({ answers, facts });

// --- the operator vocabulary -------------------------------------------------

check("the vocabulary is exactly the 20 named operators", () => {
  assert.equal(BUILDER_RULE_OPERATORS.length, 20);
  assert.equal(new Set(BUILDER_RULE_OPERATORS).size, 20);
});

const opCases = [
  // [op, fieldValue, value, expected]
  ["eq", "drive", "drive", true],
  ["eq", "drive", "fly", false],
  ["eq", [1, 2], [1, 2], true],
  ["neq", "drive", "fly", true],
  ["neq", "drive", "drive", false],
  ["gt", 596, 480, true],
  ["gt", 300, 480, false],
  ["gte", 480, 480, true],
  ["gte", 479, 480, false],
  ["lt", 300, 480, true],
  ["lt", 596, 480, false],
  ["lte", 480, 480, true],
  ["lte", 481, 480, false],
  ["between", 500, [480, 600], true],
  ["between", 700, [480, 600], false],
  ["in", "fly", ["fly", "drive"], true],
  ["in", "train", ["fly", "drive"], false],
  ["notIn", "train", ["fly", "drive"], true],
  ["notIn", "fly", ["fly", "drive"], false],
  ["contains", ["a", "b"], "b", true],
  ["contains", ["a", "b"], "c", false],
  ["contains", "montreal", "tre", true],
  ["notContains", ["a"], "c", true],
  ["notContains", "montreal", "tre", false],
  ["startsWith", "montreal", "mon", true],
  ["startsWith", "montreal", "tre", false],
  ["endsWith", "montreal", "eal", true],
  ["endsWith", "montreal", "mon", false],
  ["matches", "saint john", "saint\\s", true],
  ["matches", "saint john", "^mon", false]
];
for (const [op, fieldValue, value, expected] of opCases) {
  check(`operator ${op} (${JSON.stringify(fieldValue)} vs ${JSON.stringify(value)}) = ${expected}`, () => {
    assert.equal(
      evaluateBuilderCondition({ field: "facts.x", op, value }, scope({}, { x: fieldValue })),
      expected
    );
  });
}

check("is* operators read presence and truth, never guess", () => {
  const s = scope({ Q7: "drive" }, { flag: true, off: false, nothing: null });
  assert.equal(evaluateBuilderCondition({ field: "answers.Q7", op: "isSet" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "answers.Q9", op: "isSet" }, s), false);
  assert.equal(evaluateBuilderCondition({ field: "answers.Q9", op: "isNotSet" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "facts.nothing", op: "isNotSet" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "facts.flag", op: "isTrue" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "facts.off", op: "isTrue" }, s), false);
  assert.equal(evaluateBuilderCondition({ field: "facts.off", op: "isFalse" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "facts.missing", op: "isFalse" }, s), false);
  assert.equal(evaluateBuilderCondition({ field: "answers.Q9", op: "isEmpty" }, s), true);
  assert.equal(evaluateBuilderCondition({ field: "answers.Q7", op: "isEmpty" }, s), false);
  assert.equal(evaluateBuilderCondition({ field: "answers.Q7", op: "isNotEmpty" }, s), true);
});

check("all / any / not compose", () => {
  const s = scope({ Q7: "drive" }, { driveMinutes: 596 });
  const cond = {
    all: [
      { field: "facts.driveMinutes", op: "gt", value: 480 },
      { not: { field: "answers.Q7", op: "eq", value: "fly" } },
      { any: [{ field: "answers.Q7", op: "eq", value: "drive" }, { field: "answers.Q7", op: "eq", value: "train" }] }
    ]
  };
  assert.equal(evaluateBuilderCondition(cond, s), true);
  assert.equal(evaluateBuilderCondition(cond, scope({ Q7: "fly" }, { driveMinutes: 596 })), false);
  assert.equal(evaluateBuilderCondition(cond, scope({ Q7: "drive" }, { driveMinutes: 300 })), false);
});

// --- the question definitions ------------------------------------------------

check("the definitions carry every DECISION-TREE question (Q1-Q14, Q7a, Q7b, QC, QF)", () => {
  const ids = TRIP_BUILDER_QUESTIONS.map((q) => q.id);
  for (const id of ["Q1", "Q2", "Q3", "Q4", "Q5", "Q6", "Q7", "Q7a", "Q7b", "Q8", "Q9", "Q10", "Q11", "Q12", "Q13", "Q14", "QC", "QF"]) {
    assert.ok(ids.includes(id), `missing question ${id}`);
  }
  // Questions are pure data: no functions hide anywhere in the
  // definitions, and a JSON round-trip preserves ids and prompts.
  const scan = (v) => {
    assert.notEqual(typeof v, "function");
    if (Array.isArray(v)) v.forEach(scan);
    else if (v && typeof v === "object") Object.values(v).forEach(scan);
  };
  scan(TRIP_BUILDER_QUESTIONS);
  scan(TRIP_BUILDER_RULES);
  const roundTripped = JSON.parse(JSON.stringify(TRIP_BUILDER_QUESTIONS));
  assert.equal(roundTripped.length, TRIP_BUILDER_QUESTIONS.length);
  roundTripped.forEach((q, i) => {
    assert.equal(q.id, TRIP_BUILDER_QUESTIONS[i].id);
    assert.equal(q.prompt, TRIP_BUILDER_QUESTIONS[i].prompt);
  });
});

check("the rule table carries all 22 named rules from DECISION-TREE", () => {
  const ids = TRIP_BUILDER_RULES.map((r) => r.id);
  for (const id of ["T1", "T2", "T3", "T4", "T5", "T6", "B1", "B2", "B3", "A1", "A2", "C1", "W1", "S1", "S2", "E1", "E2", "F1", "K1", "X1", "X2", "X3"]) {
    assert.ok(ids.includes(id), `missing rule ${id}`);
  }
});

check("Q7a (your car) appears ONLY IF driving is in play", () => {
  const ids = (answers, facts) => visibleBuilderQuestions(answers, facts).map((q) => q.id);
  assert.ok(!ids({}, {}).includes("Q7a"));
  assert.ok(ids({ Q7: "drive" }, {}).includes("Q7a"));
  assert.ok(ids({}, { driveConsidered: true }).includes("Q7a"));
  assert.ok(!ids({ Q7: "fly" }, {}).includes("Q7a"));
});

check("Q7b (drive anyway?) appears ONLY IF the drive breaks 8h and driving is in play", () => {
  const ids = (answers, facts) => visibleBuilderQuestions(answers, facts).map((q) => q.id);
  assert.ok(ids({ Q7: "drive" }, { driveMinutes: 596 }).includes("Q7b"));
  assert.ok(!ids({ Q7: "drive" }, { driveMinutes: 300 }).includes("Q7b"));
  assert.ok(!ids({ Q7: "fly" }, { driveMinutes: 596 }).includes("Q7b"));
});

check("QC appears ONLY IF over budget; QF ONLY IF the loop marks completion ready", () => {
  const ids = (answers, facts) => visibleBuilderQuestions(answers, facts).map((q) => q.id);
  assert.ok(!ids({}, {}).includes("QC"));
  assert.ok(ids({}, { projectedTotalCents: 150000, budgetCents: 120000 }).includes("QC"));
  assert.ok(!ids({}, { projectedTotalCents: 100000, budgetCents: 120000 }).includes("QC"));
  assert.ok(!ids({}, {}).includes("QF"));
  assert.ok(ids({}, { completionReady: true }).includes("QF"));
});

// --- the named rules firing ---------------------------------------------------

// Montreal <-> Saint John shape, straight from the transport engine's facts.
const montrealFacts = { modeWithoutService: "train", driveMinutes: 596, driveExcludedTooFar: true, flightUsable: true };
const firedIds = (answers, facts) => firedBuilderRules(answers, facts).map((r) => r.id);

check("Montreal shape: T1 (no service), T2 (too far), T3 (flight only) fire; B1 always holds", () => {
  const fired = firedIds({}, montrealFacts);
  assert.ok(fired.includes("T1") && fired.includes("T2") && fired.includes("T3"));
  assert.ok(fired.includes("B1"));
  assert.ok(!fired.includes("T5"));
});

check("the traveller's explicit drive answer disarms T2 and fires T4", () => {
  const fired = firedIds({ Q7: "drive" }, montrealFacts);
  assert.ok(!fired.includes("T2"));
  assert.ok(fired.includes("T4"));
});

check("the Q7b override answer also disarms T2", () => {
  assert.ok(!firedIds({ Q7b: "yes" }, montrealFacts).includes("T2"));
});

check("B2 (over budget) fires from derived cents; B3 (tight) at >=86%", () => {
  assert.ok(firedIds({}, { projectedTotalCents: 150000, budgetCents: 120000 }).includes("B2"));
  assert.ok(!firedIds({}, { projectedTotalCents: 100000, budgetCents: 120000 }).includes("B2"));
  assert.ok(firedIds({}, { projectedTotalCents: 104000, budgetCents: 120000 }).includes("B3"));
  assert.ok(!firedIds({}, { projectedTotalCents: 100000, budgetCents: 120000 }).includes("B3"));
  const derived = deriveBuilderFacts({ projectedTotalCents: 150000, budgetCents: 120000 });
  assert.equal(derived.overBudget, true);
});

// --- the loop -----------------------------------------------------------------

// Q9's "nothing to plan around" is the explicit answer ["none"] —
// an empty array is unanswered, and the engine never assumes it.
const coreAnswers = { Q1: "saint john", Q2: "montreal", Q3: ["2026-12-10", "2026-12-13"], Q4: "fixed", Q5: 2, Q6: 120000, Q7: "fly", Q8: "hotel", Q9: ["none"], Q11: "no" };

check("the loop walks in definition order from an empty interview", () => {
  assert.equal(nextBuilderQuestion({}, {})?.id, "Q1");
  assert.equal(nextBuilderQuestion({ Q1: "saint john" }, {})?.id, "Q2");
  assert.equal(nextBuilderQuestion({ Q1: "a", Q2: "b", Q3: ["x", "y"], Q4: "fixed", Q5: 2, Q6: 100 }, {})?.id, "Q7");
});

check("over budget, the loop asks QC before anything else", () => {
  const facts = { projectedTotalCents: 150000, budgetCents: 120000 };
  assert.equal(nextBuilderQuestion({ Q1: "a" }, facts)?.id, "QC");
  // A picked lever lets the loop move on.
  assert.equal(nextBuilderQuestion({ Q1: "a", QC: "cheaper-stay" }, facts)?.id, "Q2");
});

check("optional questions are still offered (Q10 before QF); when only confirmation is missing, QF; when complete, null", () => {
  assert.equal(nextBuilderQuestion({ ...coreAnswers }, {})?.id, "Q10");
  const full = { ...coreAnswers, Q10: "old port", Q12: ["food"], Q13: "balanced", Q14: ["none"] };
  assert.equal(nextBuilderQuestion(full, {})?.id, "QF");
  assert.equal(nextBuilderQuestion({ ...full, QF: true }, {}), null);
});

// --- the completion test --------------------------------------------------------

check("completion test names every unmet condition", () => {
  const empty = builderCompletionTest({}, {});
  assert.equal(empty.pass, false);
  assert.ok(empty.unmet.some((u) => u.startsWith("required-answers:")));
  assert.ok(empty.unmet.includes("not-confirmed"));
});

check("completion passes only when all five conditions hold", () => {
  assert.deepEqual(builderCompletionTest({ ...coreAnswers, QF: true }, {}), { pass: true, unmet: [] });
  const conflict = builderCompletionTest({ ...coreAnswers, QF: true }, { bookingConflict: true });
  assert.deepEqual(conflict.unmet, ["booking-conflict"]);
  const over = builderCompletionTest({ ...coreAnswers, QF: true }, { projectedTotalCents: 150000, budgetCents: 120000 });
  assert.ok(over.unmet.includes("over-budget"));
  const overLever = builderCompletionTest({ ...coreAnswers, QC: "cheaper-stay", QF: true }, { projectedTotalCents: 150000, budgetCents: 120000 });
  assert.equal(overLever.pass, true);
});

check("a >8h drive picked without the Q7b override is a broken hard constraint", () => {
  // Driving answers include Q7a (your car) — it is required once
  // driving is picked, and the engine is right to demand it.
  const answers = { ...coreAnswers, Q7: "drive", Q7a: "sedan", QF: true };
  const gated = builderCompletionTest(answers, { driveMinutes: 596 });
  assert.ok(gated.unmet.includes("hard-constraints"));
  const overridden = builderCompletionTest({ ...answers, Q7b: "yes" }, { driveMinutes: 596 });
  assert.equal(overridden.pass, true);
});

console.log(`\n${failed === 0 ? "PASS" : "FAIL"}: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
