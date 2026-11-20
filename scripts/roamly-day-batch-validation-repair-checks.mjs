// Day-batch validation repair proof (Sokoto 2026-11-20) — the retry loop
// was named "validation repair" (VALIDATION_REPAIR_ATTEMPT_LIMIT) but
// performed no repair: the AI retries never saw the validation errors
// and the engine retries were deterministic re-runs. Nov 20 Sokoto trip
// 1edda600: day 1 failed 5 attempts + day 3 failed 4 attempts with
// DAY_BATCH_VALIDATION_FAILED (malformed_output), 9 attempts, zero new
// information. Day 2 completed with activity "Slow walk through the old
// town"; day 3 kept repeating it. Day 1 failed on 'NaN:NaN' leg times.
// The validator was RIGHT in both cases — the fix feeds the exact errors
// into the retry prompt and samples hotter (0.7 vs the 0.35 default).
//
// PROOF STANDARD (Junel 2026-11-20: no weak code): this script must FAIL
// on the unfixed code and PASS on the fixed code. Negative control: run
// it against the main-HEAD copy of stagedItineraryGeneration.ts — the
// export + wiring assertions fail there, and the retry prompt carries no
// error string. Run: npm run test:day-batch-validation-repair
//
// Proof level: prompt + temperature + validator behavior, against the
// REAL validateDay / dayBatchPrompt / callJsonStage (loaded, not
// re-implemented), with a fake OpenAI client recording the temperature
// that reaches the model call. NOT proven here: that a live model
// actually produces a corrected day 3 from the repair prompt — that
// needs a live generation run (next cold-city generation or a re-drive).
// Harness note: values returned by the vm-loaded module live in the vm
// realm, so assert.deepEqual fails on identical array contents (different
// Array prototype) — array results are compared element-wise below.

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import ts from "typescript";
import vm from "node:vm";

const root = path.resolve(new URL("..", import.meta.url).pathname);
const require = createRequire(import.meta.url);
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// ---- source-contract: the one wiring must exist (fails on unfixed code) ----
const stagedSource = read("lib/roamly/stagedItineraryGeneration.ts");
assert.match(
  stagedSource,
  /export function validationRepairErrorsForAttempt/,
  "the repair decision must be an exported helper on the generation state"
);
assert.match(
  stagedSource,
  /const priorErrors = validationRepairErrorsForAttempt\(state, attemptCount\);/,
  "the advance flow must derive the retry errors from state before building the prompt"
);
assert.match(
  stagedSource,
  /priorErrors: priorErrors\.length \? priorErrors : undefined,/,
  "the advance flow must pass the recovered errors into dayBatchPrompt"
);
assert.match(
  stagedSource,
  /temperature: priorErrors\.length \? DAY_BATCH_VALIDATION_REPAIR_TEMPERATURE : undefined,/,
  "the advance flow must raise the temperature on a repair attempt"
);
assert.match(
  stagedSource,
  /temperature: params\.temperature \?\? \(params\.stage === "outline" \? 0\.25 : 0\.35\)/,
  "callJsonStage must honor an explicit temperature and keep the defaults otherwise"
);
assert.match(
  stagedSource,
  /batchErrors\.slice\(0, 4\)\.join\(" \| "\)/,
  "the throw site must join the batch errors with ' | ' so the split recovers them verbatim"
);
// The validator rules are NOT weakened by this fix.
assert.match(stagedSource, /must not repeat across days\./, "the cross-day repeat rule must still exist");
assert.match(
  stagedSource,
  /VALIDATION_REPAIR_ATTEMPT_LIMIT = Math\.max\(\n\s*BATCH_ATTEMPT_LIMIT,/,
  "the retry limit must be unchanged"
);

// ---- load the REAL modules (never a re-implementation) ----
const openAiCalls = [];
class FakeOpenAI {
  constructor(config) {
    this.config = config;
    this.chat = {
      completions: {
        create: async (body) => {
          openAiCalls.push(body);
          return {
            choices: [{ message: { content: '{"days":[]}' }, finish_reason: "stop" }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          };
        }
      }
    };
  }
}

function loadTsModule(entryFile) {
  const cache = new Map();
  function load(file) {
    const absolute = path.join(root, file);
    if (cache.has(absolute)) return cache.get(absolute).module.exports;
    const ext = path.extname(absolute);
    if (ext === ".json") return JSON.parse(fs.readFileSync(absolute, "utf8"));
    const source = fs.readFileSync(absolute, "utf8");
    const compiled = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
        esModuleInterop: true,
        resolveJsonModule: true
      }
    }).outputText;
    const sandbox = {
      exports: {},
      module: { exports: {} },
      console,
      require(id) {
        if (id === "server-only") return {};
        if (id === "openai") return { __esModule: true, default: FakeOpenAI };
        if (id.startsWith("@/")) {
          const local = id.slice(2);
          return load(local.match(/\.(ts|tsx|mjs|json)$/) ? local : `${local}.ts`);
        }
        if (id.startsWith(".")) {
          const resolved = path.join(path.dirname(file), id);
          return load(resolved.match(/\.(ts|tsx|mjs|json)$/) ? resolved : `${resolved}.ts`);
        }
        return require(id);
      },
      URL,
      URLSearchParams,
      process
    };
    cache.set(absolute, sandbox);
    sandbox.exports = sandbox.module.exports;
    vm.runInNewContext(compiled, sandbox, { filename: file });
    return sandbox.module.exports;
  }
  return load(entryFile);
}

const staged = loadTsModule("lib/roamly/stagedItineraryGeneration.ts");
const itineraryExports = loadTsModule("lib/itinerary.ts");
for (const name of ["validateDay", "dayBatchPrompt", "callJsonStage", "validationRepairErrorsForAttempt"]) {
  assert.equal(typeof staged[name], "function", `the fix must export ${name} (missing on unfixed code)`);
}
assert.equal(typeof itineraryExports.stageBoundaryDayErrors, "function", "lib/itinerary.ts must export stageBoundaryDayErrors");

// ---- Sokoto fixtures (real values from daily-test-runs/2026-11-20/) ----
const REPEAT_TITLE = "Slow walk through the old town";
const REPEAT_ERROR = `activity ${REPEAT_TITLE} must not repeat across days.`;

// Day 2 as actually completed on the Sokoto trip (itinerary.json):
// one activity, the old-town walk, 09:00-11:00.
const sokotoDay2 = {
  day_number: 2,
  date: "2026-11-23",
  city: "Sokoto",
  title: "Travel, arrival, and first easy local stop",
  live_timeline: [
    {
      id: "day-2-item-1",
      title: REPEAT_TITLE,
      startTime: "09:00",
      endTime: "11:00",
      time_label: "09:00",
      item_type: "activity",
      category: "Activity",
      description: "Slow walk through the old town.",
      location_name: "Sokoto old town",
      estimated_cost: 0,
      map_query: "Sokoto old town walking route"
    }
  ]
};
// The prior-titles map, built exactly as the advance flow builds it:
// `${type}:${normalizedTextKey(title)}` -> day number, for activity/meal
// items of already-completed days.
const priorTitles = new Map([["activity:slow walk through the old town", 2]]);
assert.equal(
  sokotoDay2.live_timeline[0].title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(),
  "slow walk through the old town",
  "the fixture map key must be the normalized day-2 title"
);

function day3Candidate(firstTitle) {
  return {
    day_number: 3,
    date: "2026-11-24",
    city: "Sokoto",
    title: "Old town and cathedral",
    live_timeline: [
      {
        id: "day-3-item-1",
        title: firstTitle,
        startTime: "09:00",
        endTime: "11:00",
        time_label: "09:00",
        item_type: "activity",
        category: "Activity",
        description: "Morning walk.",
        location_name: "Sokoto old town",
        estimated_cost: 0,
        map_query: "Sokoto old town walking route"
      },
      {
        id: "day-3-item-2",
        title: "Sokoto Grand Mosque courtyard",
        startTime: "11:15",
        endTime: "12:15",
        time_label: "11:15",
        item_type: "activity",
        category: "Activity",
        description: "Courtyard visit.",
        location_name: "Sokoto Grand Mosque",
        estimated_cost: 0,
        map_query: "Sokoto Grand Mosque"
      },
      {
        id: "day-3-item-3",
        title: "Halal lunch at the central market",
        startTime: "12:30",
        endTime: "13:30",
        time_label: "12:30",
        item_type: "meal",
        category: "Meal",
        description: "Halal lunch.",
        location_name: "Sokoto central market",
        estimated_cost: 0,
        map_query: "Sokoto central market halal"
      },
      {
        id: "day-3-item-4",
        title: "Sokoto central market stroll",
        startTime: "14:00",
        endTime: "16:00",
        time_label: "14:00",
        item_type: "activity",
        category: "Activity",
        description: "Market stroll.",
        location_name: "Sokoto central market",
        estimated_cost: 0,
        map_query: "Sokoto central market"
      }
    ]
  };
}

// Day 1 as it failed on the Sokoto trip: a leg time of 'NaN:NaN'.
const nanDay = {
  day_number: 1,
  date: "2026-11-22",
  city: "Sokoto",
  title: "Arrival and first walk",
  live_timeline: [
    {
      id: "day-1-item-1",
      title: "Old town morning walk",
      startTime: "NaN:NaN",
      endTime: "10:30",
      time_label: "NaN:NaN",
      item_type: "activity",
      category: "Activity",
      description: "Morning walk.",
      location_name: "Sokoto old town",
      estimated_cost: 0,
      map_query: "Sokoto old town"
    }
  ]
};

const sokotoPayload = {
  destination: "Sokoto",
  destinationCity: "Sokoto",
  origin: "Saint John",
  tripType: "single_city",
  language: "en",
  travelStyle: "relaxed",
  pace: "gentle",
  walkingTolerance: "low",
  interests: ["old town", "cathedral"],
  accessibilityNeeds: "elevator",
  dietaryPreference: "halal",
  specialNotes: "We are a couple traveling with our baby for a relaxed four day break. Keep every day gentle, with no starts before nine and one full rest afternoon in the middle. Halal restaurants, budget under $1,700, old-town walk and central cathedral.",
  confirmedBookings: [],
  daysCount: 4,
  startDate: "2026-11-22",
  endDate: "2026-11-25",
  priceDiscovery: null
};
const sokotoOutline = {
  tripSummary: "Sokoto relaxed break for a couple with a baby",
  hotelAreaRecommendation: "Sokoto",
  importantConstraints: [],
  days: [
    {
      dayNumber: 3,
      date: "2026-11-24",
      theme: "Old town and cathedral",
      geographicArea: "Sokoto",
      priorityActivities: [],
      arrivalRequirements: [],
      departureRequirements: [],
      nextStartRequirement: ""
    }
  ]
};
const baseState = {
  priceDiscovery: null,
  confirmedBookings: [],
  personalization: { enabled: false, aggregateGuidance: [] },
  lastError: null,
  lastErrorCode: null
};
// Exactly what the advance flow's catch stores after a failed batch:
// the throw site's message (batchErrors joined with " | ") + the code.
const failedState = {
  ...baseState,
  lastError: REPEAT_ERROR,
  lastErrorCode: "DAY_BATCH_VALIDATION_FAILED"
};
const promptParams = {
  payload: sokotoPayload,
  outline: sokotoOutline,
  days: sokotoOutline.days,
  previousEndingLocation: "Sokoto old town",
  nextStartRequirement: "",
  usedAttractions: [],
  state: baseState
};

// Values returned by the vm-loaded module live in the vm realm: their
// Array prototype differs from this realm's, so assert.deepEqual would
// fail on identical contents. Compare element-wise instead.
function assertStringArrayEqual(actual, expected, message) {
  assert.equal(
    actual.length,
    expected.length,
    `${message} (length ${actual.length} vs ${expected.length}: ${JSON.stringify(actual)})`
  );
  expected.forEach((item, index) => assert.equal(actual[index], item, `${message} (element ${index})`));
}

// ---- (a) Sokoto replay: the repeat fails, the repair carries the error ----
// The REAL validator reproduces the Sokoto day-3 failure.
const repeatErrors = staged.validateDay(day3Candidate(REPEAT_TITLE), 3, priorTitles);
assertStringArrayEqual(
  repeatErrors,
  [REPEAT_ERROR],
  "Sokoto day-3 repeat must fail validation with the exact repeat error"
);
// The repair decision recovers the exact errors from the generation state.
const repairErrors = staged.validationRepairErrorsForAttempt(failedState, 2);
assertStringArrayEqual(
  repairErrors,
  [REPEAT_ERROR],
  "attempt 2 after DAY_BATCH_VALIDATION_FAILED must recover the exact batch errors from state.lastError"
);
// A multi-error message splits back into each error, in order, max 4.
assertStringArrayEqual(
  staged.validationRepairErrorsForAttempt(
    { ...baseState, lastError: `${REPEAT_ERROR} | Batch missing Day 3.`, lastErrorCode: "DAY_BATCH_VALIDATION_FAILED" },
    3
  ),
  [REPEAT_ERROR, "Batch missing Day 3."],
  "a joined multi-error message must split back into each error in order"
);
// The retry prompt carries the exact error string verbatim.
const repairPrompt = staged.dayBatchPrompt({ ...promptParams, priorErrors: repairErrors });
assert.ok(
  repairPrompt.includes(REPEAT_ERROR),
  "the retry prompt must contain the exact validation error string (unfixed code: absent)"
);
assert.ok(
  repairPrompt.includes("Fix exactly these and nothing else"),
  "the retry prompt must tell the model to fix exactly these errors"
);
// The repair temperature is raised above the 0.35 default.
assert.equal(staged.DAY_BATCH_VALIDATION_REPAIR_TEMPERATURE, 0.7, "repair temperature must be 0.7");
assert.ok(
  staged.DAY_BATCH_VALIDATION_REPAIR_TEMPERATURE > 0.35,
  "repair temperature must exceed the 0.35 day-batch default"
);

// ---- (b) first attempts are byte-identical: no repair unless it earned it ----
assertStringArrayEqual(
  staged.validationRepairErrorsForAttempt(failedState, 1),
  [],
  "attempt 1 must not carry prior errors, even with a stale failure recorded"
);
assertStringArrayEqual(
  staged.validationRepairErrorsForAttempt(
    { ...baseState, lastError: "AI returned an empty response.", lastErrorCode: "AI_EMPTY_RESPONSE" },
    2
  ),
  [],
  "a non-validation failure must not feed errors into the prompt"
);
assertStringArrayEqual(
  staged.validationRepairErrorsForAttempt(
    { ...baseState, lastError: "", lastErrorCode: "DAY_BATCH_VALIDATION_FAILED" },
    2
  ),
  [],
  "an empty failure message must not feed errors into the prompt"
);
const basePrompt = staged.dayBatchPrompt(promptParams);
assert.ok(
  !basePrompt.includes("Previous attempt failed validation"),
  "the first-attempt prompt must contain no repair block"
);
// The ONLY difference between the repair prompt and the first-attempt
// prompt is the repair block itself.
const expectedBlock =
  `Previous attempt failed validation with these exact errors:\n- ${REPEAT_ERROR}\n` +
  "Fix exactly these and nothing else — keep everything else the same.\n";
assert.equal(
  repairPrompt,
  basePrompt.replace("Rules:\n- Generate exactly these day numbers only:", `${expectedBlock}Rules:\n- Generate exactly these day numbers only:`),
  "the repair prompt must differ from the first-attempt prompt ONLY by the repair block"
);

// ---- (c) the validator is NOT weakened: corrected output passes, bad timing still fails ----
// A corrected day 3 (different title) passes validation outright.
assertStringArrayEqual(
  staged.validateDay(day3Candidate("Sokoto old town gate walk"), 3, priorTitles),
  [],
  "a corrected day-3 (different title) must pass validation"
);
// Unparseable timing is still rejected by the day-batch validator...
assertStringArrayEqual(
  staged.validateDay(nanDay, 1),
  ["Old town morning walk is missing valid HH:mm start/end time."],
  "the day-batch validator must still reject NaN:NaN timing"
);
// ...and by the boundary validator (the timing rule: lib/itinerary.ts timelineChronologyErrors).
const boundaryErrors = itineraryExports.stageBoundaryDayErrors({
  priorDays: [],
  newDays: [nanDay],
  payload: sokotoPayload,
  totalDayCount: 4,
  includeTravelStructureChecks: false
});
assert.ok(
  boundaryErrors.some((error) => error.includes("has incomplete structured timing")),
  "the boundary validator must still reject NaN:NaN timing"
);

// ---- (d) the raised temperature actually reaches the model call ----
const provider = {
  provider: "openai",
  model: "gpt-4.1-mini",
  apiKey: "test-key",
  inputPricePer1M: 0.4,
  outputPricePer1M: 1.6
};
await staged.callJsonStage({
  stage: "day_batch",
  prompt: "{}",
  maxTokens: 100,
  timeoutMs: 5000,
  attemptNumber: 2,
  provider,
  temperature: staged.DAY_BATCH_VALIDATION_REPAIR_TEMPERATURE
});
assert.equal(openAiCalls.length, 1, "one model call must be recorded");
assert.equal(openAiCalls[0].temperature, 0.7, "a repair call must reach the model at temperature 0.7 (unfixed code: 0.35)");
await staged.callJsonStage({
  stage: "day_batch",
  prompt: "{}",
  maxTokens: 100,
  timeoutMs: 5000,
  attemptNumber: 1,
  provider
});
assert.equal(openAiCalls[1].temperature, 0.35, "a first-attempt day-batch call must stay at the 0.35 default");
await staged.callJsonStage({
  stage: "outline",
  prompt: "{}",
  maxTokens: 100,
  timeoutMs: 5000,
  attemptNumber: 1,
  provider
});
assert.equal(openAiCalls[2].temperature, 0.25, "an outline call must stay at the 0.25 default");

console.log("day-batch-validation-repair: Sokoto repeat reproduced + repair prompt carries exact error + 0.7 reaches model + first attempt byte-identical + validator unweakened");
