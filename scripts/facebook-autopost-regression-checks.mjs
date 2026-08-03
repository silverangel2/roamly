import { readFileSync } from "fs";

function read(path) {
  return readFileSync(path, "utf8");
}

function assert(condition, message) {
  if (!condition) {
    console.error(`FAIL: ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${message}`);
  }
}

const automation = read("lib/roamly/socialAutomation.ts");
const generator = read("lib/roamly/socialReelGenerator.ts");
const cron = read("app/api/cron/roamly-social-autopost/route.ts");
const controls = read("components/admin/social/FacebookAutomationControls.tsx");
const automationPage = read("app/admin/social/automation/page.tsx");
const runtimeProof = read("scripts/facebook-reel-runtime-proof.mjs");

assert(/const FACEBOOK_BRANDS = \["roamly", "reviewintel"\]/.test(automation), "both Roamly and ReviewIntel brands are registered");
assert(/return "reel";/.test(automation), "automatic Facebook queue generation is Reel-only");
assert(/Automatic Facebook publishing is Reel-only/.test(automation), "non-Reel queue items are blocked instead of falling back");
assert(/blockedFallback/.test(automation), "blocked fallback is recorded in Meta response metadata");
assert(/facebookBrandConfig\(brand\)/.test(automation) || /facebookBrandConfig\(normalizedBrand\)/.test(automation), "Meta calls resolve brand-specific page config");
assert(/REVIEWINTEL_META_PAGE_ID/.test(automation), "ReviewIntel has its own Page ID env wiring");
assert(/ROAMLY_META_PAGE_ID/.test(automation), "Roamly keeps its own Page ID env wiring");
assert(/generateFreshSocialReelVideo/.test(automation), "publish path generates a fresh Reel video");
assert(/video_generated/.test(automation), "generated video proof stage is logged");
assert(/meta_upload_complete/.test(automation), "Meta upload proof stage is logged");
assert(/meta_publish_complete/.test(automation), "Meta final publish proof stage is logged");
assert(/automaticRetryLimit/.test(automation) && /nextAttempt <= retryLimit/.test(automation), "retry logic remains bounded by settings");
assert(/manualReviewRequired/.test(automation) && /!settings\.manualReviewRequired/.test(automation), "manual approval flow is respected before publishing");
assert(/@ffmpeg-installer\/ffmpeg/.test(generator), "Reel generator uses deterministic ffmpeg binary");
assert(/width = 1080/.test(generator) && /height = 1920/.test(generator), "generated video is vertical 9:16");
assert(/proof_reel/.test(cron), "protected runtime proof action is available");
assert(/runFacebookAutomationForAllBrands/.test(cron), "cron default can run both brands");
assert(/force: true/.test(cron), "runtime proof uses the explicit force publish path");
assert(/queue_status: "archived"/.test(cron) && /Proof Reel was not published/.test(cron), "failed runtime proof queue items are archived");
assert(/body: JSON\.stringify\(\{ action, brand, confirm/.test(controls), "admin control actions send the selected brand");
assert(/body: JSON\.stringify\(\{ action: "save_settings", brand, settings/.test(controls), "admin settings saves send the selected brand");
assert(/getFacebookAutomationSummaries/.test(automationPage) && /brand: "reviewintel"/.test(automationPage), "automation page exposes ReviewIntel controls");
assert(/redactedEnvValue/.test(runtimeProof) && /sensitive\|redacted\|secret\|token\|private/.test(runtimeProof), "runtime proof ignores redacted env placeholders");
assert(/cleanEnvValue/.test(automation) && /sensitive\|redacted\|secret\|token\|private/.test(automation), "automation config ignores redacted env placeholders");

if (process.exitCode) {
  process.exit(process.exitCode);
}
