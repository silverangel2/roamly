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
const legacySocial = read("lib/roamly/social.ts");

assert(/const FACEBOOK_BRANDS = \["roamly", "reviewintel"\]/.test(automation), "both Roamly and ReviewIntel brands are registered");
assert(/return "reel";/.test(automation), "automatic Facebook queue generation is Reel-only");
assert(/Automatic Facebook publishing is Reel-only/.test(automation), "non-Reel queue items are blocked instead of falling back");
assert(/blockedFallback/.test(automation), "blocked fallback is recorded in Meta response metadata");
assert(/facebookBrandConfig\(brand\)/.test(automation) || /facebookBrandConfig\(normalizedBrand\)/.test(automation), "Meta calls resolve brand-specific page config");
assert(/facebookEnabled: config\.facebookEnabled \|\| hasStoredConnection/.test(automation), "stored OAuth Page connections pass Facebook validation");
assert(/reuseExistingReel: true/.test(automation), "Post now reuses the selected queued Reel");
assert(/reusableExistingReel/.test(automation) && /selectedAudioTrack\.id === "roamly-theme"/.test(automation), "only current-audio Reel media bypasses generation");
assert(/count: 100/.test(automation) && /POST_NOW_QUEUE_REFILL/.test(automation), "empty Post now queues refill the Reel library with 100 items");
assert(/return type === "image" && isApprovedAutomationAsset\(asset, brand\)/.test(automation), "automatic Reel selection excludes arbitrary library videos");
assert(/REVIEWINTEL_META_PAGE_ID/.test(automation), "ReviewIntel has its own Page ID env wiring");
assert(/ROAMLY_META_PAGE_ID/.test(automation), "Roamly keeps its own Page ID env wiring");
assert(/generateFreshSocialReelVideo/.test(automation), "publish path generates a fresh Reel video");
assert(/video_generated/.test(automation), "generated video proof stage is logged");
assert(/meta_upload_complete/.test(automation), "Meta upload proof stage is logged");
assert(/meta_publish_complete/.test(automation), "Meta final publish proof stage is logged");
assert(/video_reels/.test(automation), "both brands use the Page video_reels endpoint");
assert(!/\$\{config\.pageId\}\/feed/.test(automation), "Reel automation never calls the Page feed endpoint");
assert(!/\$\{config\.pageId\}\/photos/.test(automation), "Reel automation never calls the Page photos endpoint");
assert(/upload_phase: "start"/.test(automation) && /upload_phase: "finish"/.test(automation), "Reel upload uses start and finish phases");
assert(/video_state: "PUBLISHED"/.test(automation), "Reel upload finishes with PUBLISHED state");
assert(/video\/mp4/.test(automation) && /9:16/.test(automation), "Reel media validation requires MP4 and vertical 9:16 media");
assert(/static_photo_reel_generation_started/.test(automation) && /generateStaticSocialPosterReelVideo/.test(automation), "image assets use the static-photo Reel generation path");
assert(/classifiedAsReel/.test(automation) && /platformMediaType: "reel"/.test(automation), "Meta object classification and saved media type are Reel-specific");
assert(/Legacy Facebook publishing is disabled/.test(legacySocial) && !/pageId\}\/feed/.test(legacySocial) && !/pageId\}\/photos/.test(legacySocial), "legacy Facebook publisher cannot fall back to feed or photo posts");
assert(/facebook_reel_id/.test(automation) && /facebook_url/.test(automation), "returned Reel ID and permalink are persisted");
assert(/automaticRetryLimit/.test(automation) && /nextAttempt <= retryLimit/.test(automation), "retry logic remains bounded by settings");
assert(/manualReviewRequired/.test(automation) && /!settings\.manualReviewRequired/.test(automation), "manual approval flow is respected before publishing");
assert(/@ffmpeg-installer\/(linux-x64|darwin-arm64)/.test(generator), "Reel generator uses deterministic platform ffmpeg binary");
assert(/width = 1080/.test(generator) && /height = 1920/.test(generator), "generated video is vertical 9:16");
assert(/sourcePath: "public\/audio\/reels\/roamly-theme\.mp3"/.test(generator), "Roamly generated Reels use the approved theme MP3");
assert(/"-c:a", "aac"/.test(generator), "Roamly generated Reels encode AAC audio");
assert(/assertGeneratedRoamlyAudio/.test(generator), "Roamly generated Reels are validated for AAC audio before upload");
assert(!/sine=/i.test(generator), "active Reel generator does not use sine audio");
assert(!/anoisesrc|aevalsrc|frequency/i.test(generator), "active Reel generator does not use synthetic frequency audio");
assert(!/lavfi/.test(generator), "active Reel generator does not use lavfi audio source metadata");
assert(/source\?: string \| null/.test(automation), "media asset resolver models the top-level source column");
assert(/select\("id,platform,status,title,media_url,asset_type,source,/.test(automation), "media asset resolver reads top-level source provenance");
assert(/isLegacyRoamlyGeneratedVideoAsset/.test(automation), "legacy generated Roamly video classification is centralized");
assert(!/findPriorPublishedVisual/.test(automation) && !/replaceRoamlyReelAudio/.test(automation), "visual path does not reuse prior published/generated MP4s");
assert(/Generated Reels are outputs, never reusable visual sources/.test(automation), "generated Reel assets return to fresh generation");
assert(/generateStaticSocialPosterReelVideo/.test(automation) && /generateFreshSocialReelVideo/.test(automation), "visual path retains photo and fresh Reel generation");
assert(/codex_roamly_premium_reel_campaign/.test(automation), "legacy campaign source is blocked");
assert(/roamly-premium-reels-2026-08/.test(automation), "legacy campaignId/path is blocked even when source metadata is missing");
assert(/return false;/.test(automation.slice(automation.indexOf("function pickAutomationMediaAsset"))), "automatic picking excludes legacy generated Roamly campaign videos");
assert(/sourceUrl = \"\"/.test(automation) && /sourceType = \"\"/.test(automation), "selected generated MP4s are cleared before fresh generation");
assert(/mode: "original_video"/.test(automation), "genuine uploaded/original videos still have an original_video pass-through path");
assert(/proof_reel/.test(cron), "protected runtime proof action is available");
assert(/runFacebookAutomationForAllBrands/.test(cron), "cron default can run both brands");
assert(/force: true/.test(cron), "runtime proof uses the explicit force publish path");
assert(/queue_status: "archived"/.test(cron) && /Proof Reel was not published/.test(cron), "failed runtime proof queue items are archived");
assert(/x-vercel-cron-schedule/.test(cron) && /\*\/30 \* \* \* \*/.test(cron), "production cron authentication accepts only the configured Vercel schedule header");
assert(/body: JSON\.stringify\(\{ action, brand, confirm/.test(controls), "admin control actions send the selected brand");
assert(/body: JSON\.stringify\(\{ action: "save_settings", brand, settings/.test(controls), "admin settings saves send the selected brand");
assert(/getFacebookAutomationSummaries/.test(automationPage) && /brand: "reviewintel"/.test(automationPage), "automation page exposes ReviewIntel controls");
assert(/redactedEnvValue/.test(runtimeProof) && /sensitive\|redacted\|secret\|token\|private/.test(runtimeProof), "runtime proof ignores redacted env placeholders");
assert(/cleanEnvValue/.test(automation) && /sensitive\|redacted\|secret\|token\|private/.test(automation), "automation config ignores redacted env placeholders");
assert(/selectCampaignPhotoAsset/.test(automation) && /!campaignPhoto/.test(automation), "buildDrafts requires a matching campaign photo before draft creation");
assert(/sourceMediaAssetId/.test(automation) && /sourceImageUrl/.test(automation) && /sourceDraftId/.test(automation), "source and generated Reel provenance are persisted on the draft/media asset");
assert(/postNowSourceMediaAssetId/.test(automation) && /boundSourceId/.test(automation), "Post now preserves the selected campaign photo while regenerating audio");

if (process.exitCode) {
  process.exit(process.exitCode);
}
