import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { buildRoamlyContentVariant } from "../lib/roamly/socialContentVariation.ts";

const hash = (value) => createHash("sha256").update(String(value).trim().toLowerCase()).digest("hex");

const oldFiniteCandidate = (index) => ({
  hook: `legacy hook ${index % 8}`,
  hashtags: `legacy-hashtags-${index % 5}`,
  concept: `roamly-legacy-${String(index).padStart(3, "0")}`
});

function addCandidateHashes(history, candidate) {
  history.add(hash(candidate.hook));
  history.add(hash(candidate.hashtags));
  history.add(hash(candidate.concept));
}

function generateLegacyCandidates(history, requested) {
  const accepted = [];
  let rejected = 0;
  for (let index = 0; index < requested * 4; index += 1) {
    const candidate = oldFiniteCandidate(index);
    const duplicate = [candidate.hook, candidate.hashtags, candidate.concept].some((value) => history.has(hash(value)));
    if (duplicate) {
      rejected += 1;
      continue;
    }
    accepted.push(candidate);
    addCandidateHashes(history, candidate);
    if (accepted.length === requested) break;
  }
  return { accepted, rejected };
}

function generateExpandedCandidates(history, requested) {
  const accepted = [];
  let rejected = 0;
  let index = 0;
  while (accepted.length < requested && index < requested * 4) {
    const variant = buildRoamlyContentVariant(index, "Lisbon");
    const candidate = {
      variantKey: variant.key,
      hook: variant.hook,
      body: variant.body,
      hashtags: variant.hashtagTerms.join("|"),
      concept: `roamly-travel-${variant.key}-${String(index).padStart(3, "0")}`
    };
    const duplicate = [candidate.hook, candidate.body, candidate.hashtags, candidate.concept]
      .some((value) => history.has(hash(value)));
    if (duplicate) {
      rejected += 1;
      index += 1;
      continue;
    }
    accepted.push(candidate);
    addCandidateHashes(history, candidate);
    history.add(hash(candidate.body));
    index += 1;
  }
  return { accepted, rejected, attempts: index };
}

const exhaustedHistory = new Set();
for (let index = 0; index < 120; index += 1) addCandidateHashes(exhaustedHistory, oldFiniteCandidate(index));

const beforeHistory = new Set(exhaustedHistory);
const before = generateLegacyCandidates(beforeHistory, 30);
assert.equal(before.accepted.length, 0, "the exhausted legacy rotation must reproduce zero accepted candidates");
assert.equal(before.rejected, 120, "the legacy attempt budget must be fully exhausted");

const cycleOne = generateExpandedCandidates(new Set(exhaustedHistory), 30);
assert.equal(cycleOne.accepted.length, 30, "expanded content must refill the first cycle");
assert.ok(cycleOne.accepted.every((candidate) => candidate.variantKey), "expanded candidates must carry a meaningful variant key");
assert.equal(new Set(cycleOne.accepted.map((candidate) => candidate.variantKey)).size, 30, "first-cycle variants must be distinct");
assert.equal(new Set(cycleOne.accepted.map((candidate) => candidate.body)).size, 30, "first-cycle copy must be distinct");

const twoCycleHistory = new Set(exhaustedHistory);
const firstCycle = generateExpandedCandidates(twoCycleHistory, 30);
const secondCycle = generateExpandedCandidates(twoCycleHistory, 30);
assert.equal(firstCycle.accepted.length, 30, "historical exhausted state must accept cycle one");
assert.equal(secondCycle.accepted.length, 30, "historical exhausted state must accept cycle two");
assert.ok(secondCycle.rejected > 0, "cycle two must respect prior-cycle duplicate history");
assert.ok(secondCycle.attempts > 30, "cycle two must skip prior-cycle candidates before accepting new ones");
assert.equal(
  new Set([...firstCycle.accepted, ...secondCycle.accepted].map((candidate) => candidate.concept)).size,
  60,
  "multiple cycles must retain distinct concepts"
);

assert.ok(!cycleOne.accepted.some((candidate) => candidate.variantKey.includes("reviewintel")), "Roamly variants must not mix ReviewIntel content");

const automation = fs.readFileSync("lib/roamly/socialAutomation.ts", "utf8") + "\n" + fs.readFileSync("lib/roamly/socialCaptions.ts", "utf8");
assert.match(automation, /const contentVariant = brand === "roamly"/);
assert.match(automation, /contentVariant\?\.key/);
assert.match(automation, /qualityCheck\(draftBase, duplicateHashes\)/);
assert.match(automation, /while \(drafts\.length < count && safety < count \* 4\)/);
assert.match(automation, /selectedMediaAssetId: campaignPhoto\?\.id \|\| null/);

console.log(JSON.stringify({
  before: { requested: 30, generated: 0, accepted: before.accepted.length, rejected: before.rejected },
  after: {
    requested: 30,
    generated: cycleOne.accepted.length,
    accepted: cycleOne.accepted.length,
    rejected: cycleOne.rejected,
    attempts: cycleOne.attempts,
    secondCycleAccepted: secondCycle.accepted.length,
    secondCycleRejected: secondCycle.rejected,
    meaningfulVariants: new Set(cycleOne.accepted.map((candidate) => candidate.variantKey)).size
  }
}, null, 2));
console.log("Facebook content exhaustion regression checks passed.");
