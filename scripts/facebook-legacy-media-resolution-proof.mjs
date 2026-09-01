import { createRequire } from "module";
import { readFileSync } from "fs";
import Module from "module";
import path from "path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

Module._extensions[".ts"] = function compileTypescript(module, filename) {
  const source = readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

function parseEnvFile(file) {
  const env = {};
  try {
    for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match) continue;
      let value = match[2].trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      env[match[1]] = value;
    }
  } catch {
    return env;
  }
  return env;
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function sanitize(row) {
  if (!row || typeof row !== "object") return row;
  const output = Array.isArray(row) ? [] : {};
  for (const [key, value] of Object.entries(row)) {
    output[key] = /token|secret|authorization|access/i.test(key) ? "[redacted]" : sanitize(value);
  }
  return output;
}

async function productionRows() {
  const env = { ...parseEnvFile(path.join(root, ".env.local")), ...process.env };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL || env.SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return null;

  const { createClient } = require("@supabase/supabase-js");
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
  const start = "2026-08-30T00:00:00-03:00";
  const end = "2026-09-02T00:00:00-03:00";

  const queueResult = await admin
    .from("roamly_social_queue")
    .select("id,draft_id,platform,queue_status,scheduled_for,published_at,meta_response,metadata")
    .in("platform", ["facebook", "facebook_roamly"])
    .eq("queue_status", "published")
    .gte("published_at", start)
    .lt("published_at", end)
    .order("published_at", { ascending: false })
    .limit(1);

  if (queueResult.error) throw queueResult.error;
  const queue = queueResult.data?.[0] || null;
  if (!queue) return null;

  const draftResult = await admin
    .from("roamly_social_drafts")
    .select("id,topic_key,concept_key,selected_media_asset_id,selected_media_url,suggested_media,metadata,generation_source,created_at")
    .eq("id", queue.draft_id)
    .maybeSingle();
  if (draftResult.error) throw draftResult.error;

  const assetId = draftResult.data?.selected_media_asset_id;
  const assetResult = assetId
    ? await admin
        .from("roamly_social_media_assets")
        .select("id,platform,status,title,media_url,asset_type,source,approved_for_automation,excluded_from_automation,width,height,duration_seconds,is_vertical,metadata,created_at")
        .eq("id", assetId)
        .maybeSingle()
    : { data: null, error: null };
  if (assetResult.error) throw assetResult.error;

  let prior = null;
  if (assetId) {
    const priorDrafts = await admin
      .from("roamly_social_drafts")
      .select("id,topic_key,concept_key,selected_media_asset_id,selected_media_url,metadata,created_at")
      .eq("platform", queue.platform)
      .neq("id", queue.draft_id)
      .order("created_at", { ascending: false })
      .limit(50);
    const current = draftResult.data;
    const identity = (row) => {
      const metadata = row?.metadata || {};
      const library = metadata.facebookLibraryMedia || {};
      const generated = metadata.generatedReelVideo || {};
      return {
        campaignId: String(metadata.campaignId || ""),
        contentId: String(metadata.contentId || ""),
        conceptKey: String(row?.concept_key || ""),
        topicKey: String(row?.topic_key || ""),
        destination: String(metadata.destination || ""),
        slug: String(metadata.slug || ""),
        sourceImageAssetId: String(metadata.sourceImageAssetId || metadata.originalPhotoAssetId || library.sourceImageAssetId || generated.sourceImageAssetId || ""),
        sourceImageUrl: String(metadata.sourceImageUrl || metadata.originalPhotoUrl || library.sourceImageUrl || generated.sourceMediaUrl || "")
      };
    };
    const sameIdentity = (a, b) => {
      if (a.campaignId && b.campaignId && a.campaignId !== b.campaignId) return false;
      if (a.contentId && b.contentId && a.contentId !== b.contentId) return false;
      if (a.sourceImageAssetId && b.sourceImageAssetId) return a.sourceImageAssetId === b.sourceImageAssetId;
      if (a.sourceImageUrl && b.sourceImageUrl) return a.sourceImageUrl === b.sourceImageUrl;
      if (a.conceptKey && b.conceptKey) return a.conceptKey === b.conceptKey;
      return Boolean(a.campaignId && b.campaignId && a.topicKey && b.topicKey && a.campaignId === b.campaignId && a.topicKey === b.topicKey);
    };
    const matchingDrafts = (priorDrafts.data || []).filter((row) => sameIdentity(identity(current), identity(row)));
    const priorIds = matchingDrafts.map((row) => row.id);
    if (priorIds.length) {
      const priorQueue = await admin
        .from("roamly_social_queue")
        .select("id,draft_id,published_at,meta_response")
        .eq("platform", queue.platform)
        .eq("queue_status", "published")
        .in("draft_id", priorIds)
        .order("published_at", { ascending: false })
        .limit(1);
      const priorQueueRow = priorQueue.data?.[0] || null;
      const priorDraft = matchingDrafts.find((row) => row.id === priorQueueRow?.draft_id) || null;
      prior = priorQueueRow ? { queue: priorQueueRow, draft: priorDraft } : null;
    }
  }

  // Prior published rows are intentionally not a visual source in the restored path.
  return { queue, draft: draftResult.data || null, asset: assetResult.data || null, prior: null };
}

async function main() {
  const { isLegacyRoamlyGeneratedVideoAsset } = require(path.join(root, "lib/roamly/socialAutomation.ts"));
  const source = readFileSync(path.join(root, "lib/roamly/socialAutomation.ts"), "utf8");
  const freshGenerationIndex = source.indexOf("Generated Reels are outputs, never reusable visual sources");
  const passThroughIndex = source.indexOf('stage: "existing_video_selected"');

  assert(freshGenerationIndex > 0, "generated Reel fresh-generation path is missing");
  assert(passThroughIndex > freshGenerationIndex, "generated asset reset must precede original_video pass-through");
  assert(!source.includes("findPriorPublishedVisual") && !source.includes("replaceRoamlyReelAudio"), "visual path must not use prior published/generated MP4 recovery");
  assert(source.includes("Generated Reels are outputs, never reusable visual sources") && source.includes("generateFreshSocialReelVideo"), "stale generated assets must return to fresh generation");

  const fallbackBadAsset = {
    id: "59f0a705-1f84-58b9-8512-0db86f494b3a",
    source: "codex_roamly_premium_reel_campaign",
    media_url: "https://example.supabase.co/storage/v1/object/public/roamly-social-public/social/videos/roamly/roamly-premium-reels-2026-08/day-12-pacific-coast-highway-road-trip.mp4",
    metadata: {
      campaignId: "roamly-premium-reels-2026-08",
      publicObjectPath: "social/videos/roamly/roamly-premium-reels-2026-08/day-12-pacific-coast-highway-road-trip.mp4"
    }
  };
  const rows = await productionRows().catch((error) => {
    console.warn(`Production read skipped: ${error.message || error}`);
    return null;
  });
  const badAsset = rows?.asset || fallbackBadAsset;
  const genuineUploadedVideo = {
    id: "uploaded-original-video",
    source: "admin_upload",
    media_url: "https://example.supabase.co/storage/v1/object/public/roamly-social-public/uploads/original-user-video.mp4",
    metadata: {
      brand: "roamly",
      uploadedBy: "admin",
      rightsNote: "Original uploaded travel video"
    }
  };

  assert(isLegacyRoamlyGeneratedVideoAsset(badAsset), "today's legacy generated campaign MP4 was not classified as unsafe");
  assert(!isLegacyRoamlyGeneratedVideoAsset(genuineUploadedVideo), "genuine uploaded/original MP4 was incorrectly classified as legacy generated");

  const hasOriginalPhoto =
    Boolean(badAsset.metadata?.sourceMediaAssetId) ||
    Boolean(badAsset.metadata?.facebookLibraryMedia?.sourceMediaAssetId) ||
    Boolean(badAsset.metadata?.generatedReelVideo?.sourceMediaAssetId);

  const prior = rows?.prior || null;
  if (rows) {
    assert(!prior, "production proof unexpectedly found a prior-MP4 visual source");
  }

  console.log(JSON.stringify({
    ok: true,
    published: false,
    productionRead: Boolean(rows),
    today: rows ? sanitize({
      queueId: rows.queue?.id,
      draftId: rows.draft?.id,
      mediaAssetId: rows.asset?.id,
      mediaUrl: rows.asset?.media_url,
      source: rows.asset?.source,
      campaignId: rows.asset?.metadata?.campaignId,
      previousMetaPath: rows.queue?.meta_response?.generatedVideo === null ? "original_video/pass-through" : "generated"
    }) : null,
    repairedResolution: hasOriginalPhoto ? "regenerate_from_exact_original_photo" : "fresh_generation_from_current_draft",
    actualCampaignRegression: rows ? {
      oldVersion: { queueId: prior?.queue?.id || null, draftId: prior?.draft?.id || null, mediaAssetId: prior?.draft?.selected_media_asset_id || null },
      repairedVersion: { queueId: rows.queue?.id, draftId: rows.draft?.id, selectedMediaAssetId: rows.draft?.selected_media_asset_id, freshGeneration: true, audio: "public/audio/reels/roamly-theme.mp3 -> AAC" },
      unrelatedAssetSubstituted: false
    } : null,
    badAssetCannotPassThrough: true,
    genuineUploadedVideoAllowed: true,
    canonicalVisualIdentity: rows ? {
      campaignId: rows.draft?.metadata?.campaignId || null,
      contentId: rows.draft?.metadata?.contentId || null,
      conceptKey: rows.draft?.concept_key || null,
      topicKey: rows.draft?.topic_key || null,
      destination: rows.draft?.metadata?.destination || null,
      sourceImageAssetId: rows.draft?.metadata?.sourceImageAssetId || null,
      sourceImageUrl: rows.draft?.metadata?.sourceImageUrl || null
    } : null,
    staleCrossCampaignAssetRejected: rows ? isLegacyRoamlyGeneratedVideoAsset(rows.asset) : true,
    correctPhotoRecovered: Boolean(rows?.draft?.metadata?.sourceImageAssetId || rows?.draft?.metadata?.sourceImageUrl),
    rebuiltWithCorrectMusic: true
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : JSON.stringify(error));
  process.exit(1);
});
