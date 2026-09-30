import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defineMoneyFinding, runMoneyChecks } from "./specialist-money-check-utils.mjs";

/**
 * MARKETING_GROWTH specialist money checks — turn autopost output into app
 * trials. Guards the money-critical invariants of the social automation
 * engine (lib/roamly/socialAutomation.ts + lib/roamly/socialCaptions.ts): every Roamly post must link to /plan with attribution, carry a
 * call to action, disclose affiliate links, and pass the quality gate.
 * Never invents metrics — all checks are structural.
 */

const engineSources = ["../lib/roamly/socialAutomation.ts", "../lib/roamly/socialCaptions.ts"];
const engine = (
  await Promise.all(engineSources.map((file) => readFile(new URL(file, import.meta.url), "utf8")))
).join("\n");

await runMoneyChecks(
  "MARKETING_GROWTH",
  "Turn autopost output into app trials: hooks, CTAs, hashtags, and link discipline in the social automation engine.",
  [
    defineMoneyFinding(
      "autopost-roamly-links-to-plan",
      "high",
      "A Roamly post that does not link to /plan cannot convert a viewer into a trial.",
      () => {
        assert.match(engine, /brand === "reviewintel" \? "\/" : "\/plan"/, "draft links must point Roamly posts at /plan and ReviewIntel posts at /");
        assert.match(engine, /url\.searchParams\.set\("utm_source", "facebook"\)/, "draft links must carry utm_source for attribution");
        assert.match(engine, /url\.searchParams\.set\("utm_medium", "organic_social"\)/, "draft links must carry utm_medium for attribution");
        assert.match(engine, /url\.searchParams\.set\("utm_campaign", "autopost"\)/, "draft links must carry utm_campaign for attribution");
      }
    ),
    defineMoneyFinding(
      "autopost-cta-required",
      "high",
      "Posts without a call to action get scrolled past; the quality gate must reject them.",
      () => {
        assert.match(engine, /Call to action is missing/, "quality gate must penalize drafts with no call to action");
        assert.match(engine, /!draft\.callToAction \|\| !draft\.caption\.includes\(draft\.callToAction\)/, "CTA must appear in the caption text, not just metadata");
      }
    ),
    defineMoneyFinding(
      "autopost-affiliate-disclosure",
      "high",
      "Undisclosed affiliate links risk platform penalties that shut down the whole channel.",
      () => {
        assert.match(engine, /Affiliate disclosure: we may earn from qualifying links/, "affiliate disclosure copy must exist");
        assert.match(engine, /Affiliate disclosure is missing/, "quality gate must penalize affiliate links without disclosure");
      }
    ),
    defineMoneyFinding(
      "autopost-no-duplicate-content",
      "medium",
      "Repeated hooks and captions train the audience to ignore the page and hurt reach.",
      () => {
        assert.match(engine, /Duplicate hook, caption, concept, or hashtag set/, "quality gate must penalize duplicate content");
        assert.match(engine, /existingDuplicateHashes/, "queue generation must check new drafts against recent history");
      }
    ),
    defineMoneyFinding(
      "autopost-no-unsupported-claims",
      "medium",
      "Fake-discount or guaranteed-viral wording destroys trust and invites takedowns.",
      () => {
        assert.match(engine, /Unsupported promotional claim detected/, "quality gate must penalize unsupported promotional claims");
        assert.match(engine, /guaranteed\|viral\|limited time\|act now\|fake discount/, "claim denylist must cover the obvious trust-killers");
      }
    ),
    defineMoneyFinding(
      "autopost-hashtag-discipline",
      "low",
      "Hashtag stuffing looks spammy; the gate caps them so posts stay readable.",
      () => {
        assert.match(engine, /Too many hashtags/, "quality gate must penalize hashtag stuffing");
      }
    )
  ]
);
