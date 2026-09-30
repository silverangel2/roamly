import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAmazonSearchUrl, getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { ROAMLY_AFFILIATE_DISCLOSURE, ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";
import { getRoamlySocialEnvStatus, isSocialTableMissingError } from "@/lib/roamly/social";
import { probeFacebookAccessibleUrl, probeFacebookPublicVisibility } from "@/lib/roamly/publicSocialStorage";
import { classifyFacebookPublication, type FacebookPublicationTruth } from "@/lib/roamly/facebookPublicationTruth";
import { generateFreshSocialReelVideo, generateStaticSocialPosterReelVideo, replaceRoamlyReelAudio, type SocialReelBrand } from "@/lib/roamly/socialReelGenerator";
import { selectCampaignPhotoAsset } from "@/lib/roamly/facebookCampaignMedia";
import { buildRoamlyContentVariant } from "@/lib/roamly/socialContentVariation";

import {
  getRoamlyFacebookConnectionStatus,
  getRoamlyFacebookCredentialsForPosting
} from "@/lib/roamly/facebookConnector";

import {
  FACEBOOK_BRANDS,
  assetType,
  assetUrl,
  brandPlatform,
  brandQueuePlatforms,
  clean,
  envFirst,
  facebookBrandConfig,
  generateFacebookQueue,
  hash,
  isApprovedAutomationAsset,
  loadFacebookAutomationSettings,
  metadataBrand,
  normalizeFacebookBrand,
  numberValue,
  objectValue,
  recordAdminActivity,
  refillFacebookQueue,
  uniqueHashtags,
  validTimeZone,
  withBrandMetadata,
} from "./socialCaptions";
export * from "./socialCaptions";

export type FacebookPostFormat = "reel" | "image" | "statement" | "link";
export type FacebookQueueStatus = "scheduled" | "processing" | "published" | "failed" | "retrying" | "skipped" | "archived";
export type FacebookSocialBrand = SocialReelBrand;

export type FacebookAutomationSettings = {
  automationEnabled: boolean;
  paused: boolean;
  manualReviewRequired: boolean;
  postsPerDay: number;
  reelsPerWeek: number;
  preferredPostingHours: number[];
  timeZone: string;
  minimumQueueSize: number;
  maximumQueueSize: number;
  maximumDailyPosts: number;
  contentCategories: string[];
  categoryPercentages: Record<string, number>;
  affiliatePostFrequency: number;
  promotionalPostFrequency: number;
  websiteLinkFrequency: number;
  statementPostFrequency: number;
  automaticRetryLimit: number;
  media: {
    maximumUsesPerAsset: number;
    minimumDaysBeforeReuse: number;
    preferNewestUploads: boolean;
    allowGeneratedVisuals: boolean;
    allowStatementGraphics: boolean;
    allowStockFallbackMedia: boolean;
  };
};

export type FacebookAutomationSummary = {
  tableReady: boolean;
  settings: FacebookAutomationSettings;
  env: ReturnType<typeof getRoamlySocialEnvStatus> & {
    pageName?: string;
    pageId?: string;
    credentialSource?: "connected-facebook-oauth" | "env-fallback" | "missing";
    canonicalConnection?: Awaited<ReturnType<typeof getRoamlyFacebookConnectionStatus>>;
    permissions: string[];
    publishingReady: boolean;
    blockingIssues: string[];
  };
  counts: {
    queueSize: number;
    scheduled: number;
    published: number;
    failed: number;
    retrying: number;
    drafts: number;
    mediaAssets: number;
  };
  nextPost: QueueWithDraft | null;
  nextReel: QueueWithDraft | null;
  todaySchedule: QueueWithDraft[];
  weekSchedule: QueueWithDraft[];
  recentActivity: QueueWithDraft[];
  lastCron: CronLogRow | null;
  nextAutomationRun: string;
};

export type GeneratedFacebookDraft = {
  contentType: string;
  postFormat: FacebookPostFormat;
  topic: string;
  topicKey: string;
  conceptKey: string;
  hook: string;
  caption: string;
  onScreenText: string;
  mediaDirection: string;
  suggestedMedia: string;
  selectedMediaAssetId: string | null;
  selectedMediaUrl: string;
  callToAction: string;
  hashtags: string[];
  musicOrAudioMood: string;
  roamlyLink: string;
  amazonAffiliateLink: string;
  affiliateDisclosure: string;
  generationSource: "openai" | "fallback" | "seo";
  qualityScore: number;
  qualityReasons: string[];
  scheduledFor: string;
  metadata: Record<string, unknown>;
};

type SocialDraftRow = {
  id: string;
  content_type: string;
  post_format: FacebookPostFormat;
  topic: string | null;
  hook: string;
  caption: string;
  on_screen_text: string | null;
  media_direction: string | null;
  suggested_media: string | null;
  selected_media_asset_id: string | null;
  selected_media_url: string | null;
  call_to_action: string | null;
  hashtags: string[] | null;
  music_or_audio_mood: string | null;
  roamly_link: string | null;
  amazon_affiliate_link: string | null;
  affiliate_disclosure: string | null;
  generation_source: string;
  status: string;
  quality_score: number;
  quality_reasons: string[] | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SocialMediaAssetRow = {
  id: string;
  platform: string | null;
  status: string | null;
  title: string | null;
  destination?: string | null;
  topic?: string | null;
  media_url: string | null;
  asset_type: string | null;
  source?: string | null;
  approved_for_automation: boolean | null;
  excluded_from_automation: boolean | null;
  archived_at?: string | null;
  use_count: number | null;
  last_used_at: string | null;
  width: number | null;
  height: number | null;
  duration_seconds: number | null;
  is_vertical: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type QueueWithDraft = {
  id: string;
  draft_id: string;
  platform: string;
  queue_status: FacebookQueueStatus;
  scheduled_for: string;
  idempotency_key: string;
  publish_key: string;
  facebook_post_id: string | null;
  facebook_reel_id: string | null;
  facebook_media_id: string | null;
  facebook_url: string | null;
  published_at: string | null;
  attempt_count: number;
  retry_after: string | null;
  last_error: string | null;
  permanent_failure: boolean;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  draft: SocialDraftRow;
};

type CronLogRow = {
  id: string;
  cron_name: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  due_found: number;
  published_count: number;
  failed_count: number;
  retry_count: number;
  generated_count: number;
  skipped_reason: string | null;
  summary: Record<string, unknown> | null;
  created_at: string;
};

type PublishResult = {
  ok: boolean;
  status: "published" | "failed" | "skipped";
  publicationTruth?: FacebookPublicationTruth;
  facebookPostId?: string | null;
  facebookReelId?: string | null;
  facebookMediaId?: string | null;
  facebookUrl?: string | null;
  mediaAssetId?: string | null;
  sourceMediaAssetId?: string | null;
  temporary?: boolean;
  error?: string;
  metaResponse?: Record<string, unknown>;
};

class FacebookGraphError extends Error {
  temporary: boolean;
  responseBody: Record<string, unknown>;

  constructor(message: string, temporary: boolean, responseBody: Record<string, unknown> = {}) {
    super(message);
    this.name = "FacebookGraphError";
    this.temporary = temporary;
    this.responseBody = responseBody;
  }
}


function brandFromQueueItem(item: Pick<QueueWithDraft, "platform" | "metadata" | "draft">): FacebookSocialBrand {
  if (item.platform === "facebook_reviewintel") return "reviewintel";
  if (item.platform === "facebook_roamly") return "roamly";
  const queueBrand = metadataBrand(item.metadata);
  if (queueBrand !== "roamly") return queueBrand;
  return metadataBrand(item.draft?.metadata);
}

export type FacebookBrandConfig = {
  brand: FacebookSocialBrand;
  label: string;
  platform: string;
  pageId: string;
  pageAccessToken: string;
  graphVersion: string;
  facebookEnabled: boolean;
  autoPostEnabled: boolean;
  requireApproval: boolean;
  publicSiteUrl: string;
  primaryLink: string;
  affiliateUrl: string;
  affiliateDisclosure: string;
  credentialSource?: "connected-facebook-oauth" | "env-fallback";
};

function dayBoundsInTimeZone(timeZone: string, date = new Date(), daySpan = 1) {
  const zone = validTimeZone(timeZone);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hourCycle: "h23"
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value || 0);

  const toUtc = (dayOffset: number) => {
    const wallClockUtc = Date.UTC(
      value("year"),
      value("month") - 1,
      value("day") + dayOffset,
      0,
      0,
      0,
      0
    );
    let candidate = new Date(wallClockUtc);

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actualParts = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      }).formatToParts(candidate);
      const actual = (type: Intl.DateTimeFormatPartTypes) =>
        Number(actualParts.find((part) => part.type === type)?.value || 0);
      const actualAsUtc = Date.UTC(
        actual("year"),
        actual("month") - 1,
        actual("day"),
        actual("hour"),
        actual("minute"),
        actual("second"),
        0
      );
      const delta = wallClockUtc - actualAsUtc;
      if (delta === 0) break;
      candidate = new Date(candidate.getTime() + delta);
    }

    candidate.setMilliseconds(0);
    return candidate;
  };

  return {
    start: toUtc(0),
    end: toUtc(daySpan)
  };
}

async function countPublishedToday(admin: SupabaseClient, brand: FacebookSocialBrand, timeZone: string) {
  const { start, end } = dayBoundsInTimeZone(timeZone);
  const { count } = await admin
    .from("roamly_social_queue")
    .select("id", { count: "exact", head: true })
    .in("platform", brandQueuePlatforms(brand))
    .eq("queue_status", "published")
    .gte("published_at", start.toISOString())
    .lt("published_at", end.toISOString());
  return count || 0;
}

async function releaseStaleLocks(admin: SupabaseClient, brand: FacebookSocialBrand) {
  const stale = new Date(Date.now() - 30 * 60_000).toISOString();
  await admin
    .from("roamly_social_queue")
    .update({
      queue_status: "retrying",
      processing_locked_at: null,
      processing_lock_token: null,
      retry_after: new Date(Date.now() + 10 * 60_000).toISOString(),
      last_error: "Publishing lock expired and was released."
    })
    .in("platform", brandQueuePlatforms(brand))
    .eq("queue_status", "processing")
    .lt("processing_locked_at", stale);
}

async function getDueQueue(
  admin: SupabaseClient,
  limit: number,
  brand: FacebookSocialBrand,
  options: { queueId?: string; notBefore?: string } = {}
) {
  const now = new Date().toISOString();

  let query = admin
    .from("roamly_social_queue")
    .select(
      "*,draft:roamly_social_drafts!inner(id,content_type,post_format,topic,hook,caption,on_screen_text,media_direction,suggested_media,selected_media_asset_id,selected_media_url,call_to_action,hashtags,music_or_audio_mood,roamly_link,amazon_affiliate_link,affiliate_disclosure,generation_source,status,quality_score,quality_reasons,metadata,created_at,updated_at)"
    )
    .in("platform", brandQueuePlatforms(brand))
    .in("queue_status", ["scheduled", "retrying"])
    .eq("draft.post_format", "reel")
    .lte("scheduled_for", now)
    .or(`retry_after.is.null,retry_after.lte.${now}`)
    .order("scheduled_for", { ascending: true })
    .limit(limit);

  if (options.queueId) query = query.eq("id", options.queueId);
  if (options.notBefore) query = query.gte("scheduled_for", options.notBefore);

  const { data, error } = await query;

  if (error) throw error;

  return ((data || []) as unknown as QueueWithDraft[]).filter(
    (item) => item.draft?.post_format === "reel"
  );
}

async function lockQueueItem(admin: SupabaseClient, item: QueueWithDraft) {
  const lockToken = randomUUID();
  const { data, error } = await admin
    .from("roamly_social_queue")
    .update({
      queue_status: "processing",
      processing_locked_at: new Date().toISOString(),
      processing_lock_token: lockToken,
      processing_started_at: new Date().toISOString(),
      attempt_count: (item.attempt_count || 0) + 1,
      last_error: null
    })
    .eq("id", item.id)
    .in("queue_status", ["scheduled", "retrying"])
    .is("processing_lock_token", null)
    .select("id")
    .maybeSingle();
  if (error || !data) return "";
  await admin
    .from("roamly_publishing_jobs")
    .update({
      job_status: "processing",
      locked_at: new Date().toISOString(),
      lock_token: lockToken,
      started_at: new Date().toISOString(),
      attempt_count: (item.attempt_count || 0) + 1
    })
    .eq("queue_id", item.id);
  return lockToken;
}

async function facebookBrandConfigForPosting(
  brand: FacebookSocialBrand
): Promise<FacebookBrandConfig> {
  const config = facebookBrandConfig(brand);

  if (normalizeFacebookBrand(brand) !== "roamly") {
    return { ...config, credentialSource: "env-fallback" };
  }

  const stored = await getRoamlyFacebookCredentialsForPosting();
  const hasStoredConnection =
    stored.source === "connected-facebook-oauth" &&
    Boolean(stored.pageId && stored.accessToken);

  return {
    ...config,
    credentialSource: stored.source,
    // A stored OAuth Page connection is valid even when the legacy
    // environment toggle is absent or disabled.
    facebookEnabled: config.facebookEnabled || hasStoredConnection,
    pageId: stored.pageId || config.pageId,
    pageAccessToken: stored.accessToken || config.pageAccessToken
  };
}

export async function getFacebookVisibilityConfig(brand: FacebookSocialBrand) {
  const config = await facebookBrandConfigForPosting(brand);
  const appId = envFirst(brand === "reviewintel" ? "REVIEWINTEL_META_APP_ID" : "ROAMLY_META_APP_ID");
  return {
    brand: config.brand,
    label: config.label,
    pageId: config.pageId,
    pageAccessToken: config.pageAccessToken,
    graphVersion: config.graphVersion,
    appId,
    credentialSource: config.credentialSource || "env-fallback"
  };
}

async function facebookGraph<T>(
  config: FacebookBrandConfig,
  path: string,
  {
    method = "POST",
    params = {}
  }: {
    method?: "GET" | "POST";
    params?: Record<string, string>;
  } = {}
): Promise<T> {
  const token = config.pageAccessToken;
  if (!token) throw new FacebookGraphError("Facebook Page token is missing.", false, {});
  const url = new URL(`https://graph.facebook.com/${config.graphVersion}/${path.replace(/^\//, "")}`);
  const requestInit: RequestInit = { method };

  if (method === "GET") {
    for (const [key, value] of Object.entries({ ...params, access_token: token })) {
      if (value) url.searchParams.set(key, value);
    }
  } else {
    requestInit.headers = { "content-type": "application/x-www-form-urlencoded" };
    requestInit.body = new URLSearchParams({ ...params, access_token: token });
  }

  const response = await fetch(url, requestInit);
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & {
    error?: { message?: string; code?: number; is_transient?: boolean; error_subcode?: number };
  };

  if (!response.ok || body.error) {
    const message = body.error?.message || `Meta request failed with status ${response.status}.`;
    const temporary = Boolean(body.error?.is_transient || response.status >= 500 || response.status === 429);
    throw new FacebookGraphError(message, temporary, body);
  }

  return body as T;
}

function videoLooksSupported(url: string) {
  return /^https:\/\//i.test(url) && /\.mp4(\?|$)/i.test(url);
}

const MAX_REEL_BYTES = 50 * 1024 * 1024;

function assertReelMediaMetadata(input: {
  assetType?: unknown;
  isVertical?: unknown;
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  fileSizeBytes?: unknown;
}) {
  if (input.assetType !== "video") {
    throw new FacebookGraphError("Facebook Reel publishing requires an MP4 video asset.", false, { mediaType: input.assetType || null });
  }
  if (input.isVertical !== true) {
    throw new FacebookGraphError("Facebook Reel publishing requires vertical 9:16 media.", false, { isVertical: input.isVertical ?? null });
  }
  const width = Number(input.width);
  const height = Number(input.height);
  const duration = Number(input.durationSeconds);
  const size = Number(input.fileSizeBytes);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || Math.abs(width / height - 9 / 16) > 0.01) {
    throw new FacebookGraphError("Facebook Reel publishing requires a 9:16 video.", false, { width, height });
  }
  if (!Number.isFinite(duration) || duration <= 0) throw new FacebookGraphError("Facebook Reel video duration is invalid.", false, { durationSeconds: duration });
  if (!Number.isFinite(size) || size <= 0 || size > MAX_REEL_BYTES) {
    throw new FacebookGraphError("Facebook Reel video file size is invalid.", false, { fileSizeBytes: size, maxBytes: MAX_REEL_BYTES });
  }
}

function assertUploadedReelVideoAsset(input: {
  assetType?: unknown;
  isVertical?: unknown;
  width?: unknown;
  height?: unknown;
  durationSeconds?: unknown;
  fileSizeBytes?: unknown;
}) {
  if (input.assetType && input.assetType !== "video") {
    throw new FacebookGraphError("Facebook Reel publishing requires an MP4 video asset.", false, { mediaType: input.assetType || null });
  }
  if (input.isVertical === false) {
    throw new FacebookGraphError("Facebook Reel publishing requires vertical 9:16 media.", false, { isVertical: input.isVertical });
  }
  const width = Number(input.width);
  const height = Number(input.height);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0 && Math.abs(width / height - 9 / 16) > 0.04) {
    throw new FacebookGraphError("Facebook Reel publishing requires a 9:16 video.", false, { width, height });
  }
  const duration = Number(input.durationSeconds);
  if (input.durationSeconds != null && (!Number.isFinite(duration) || duration <= 0)) {
    throw new FacebookGraphError("Facebook Reel video duration is invalid.", false, { durationSeconds: duration });
  }
  const size = Number(input.fileSizeBytes);
  if (input.fileSizeBytes != null && (!Number.isFinite(size) || size <= 0 || size > MAX_REEL_BYTES)) {
    throw new FacebookGraphError("Facebook Reel video file size is invalid.", false, { fileSizeBytes: size, maxBytes: MAX_REEL_BYTES });
  }
}

function supabaseMediaConfig() {
  return {
    supabaseUrl: envFirst("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    serviceKey: envFirst("SUPABASE_SERVICE_ROLE_KEY")
  };
}

export function isLegacyRoamlyGeneratedVideoAsset(asset: Pick<SocialMediaAssetRow, "id" | "source" | "media_url" | "metadata"> | null | undefined) {
  if (!asset) return false;

  const metadata = objectValue(asset.metadata);
  const campaignId = clean(String(metadata.campaignId || ""));
  const publicObjectPath = clean(String(metadata.publicObjectPath || ""));
  const localAssetPath = clean(String(metadata.localAssetPath || ""));
  const source = clean(asset.source || String(metadata.source || ""));
  const mediaUrl = clean(asset.media_url || "");
  const generatedVideo = objectValue(metadata.generatedReelVideo);
  const generatedAudio = objectValue(generatedVideo.audioTrack);

  if (source === "codex_roamly_premium_reel_campaign") return true;
  if (campaignId === "roamly-premium-reels-2026-08") return true;
  if (/sine|frequency|noise|lavfi/i.test(String(generatedAudio.lavfi || "")) || /sine|frequency|noise|lavfi/i.test(JSON.stringify(metadata))) return true;

  return [
    publicObjectPath,
    localAssetPath,
    mediaUrl
  ].some((value) => /roamly-premium-reels-2026-08\/day-\d{2}-/i.test(value));
}

function sortAutomationAssets(assets: SocialMediaAssetRow[]) {
  return [...assets].sort((a, b) => {
    const useDiff = Number(a.use_count || 0) - Number(b.use_count || 0);
    if (useDiff) return useDiff;
    const aUsed = a.last_used_at ? Date.parse(a.last_used_at) : 0;
    const bUsed = b.last_used_at ? Date.parse(b.last_used_at) : 0;
    if (aUsed !== bUsed) return aUsed - bUsed;
    return Date.parse(String(b.created_at || "")) - Date.parse(String(a.created_at || ""));
  });
}

async function pickAutomationMediaAsset(admin: SupabaseClient, brand: FacebookSocialBrand) {
  const { data, error } = await admin
    .from("roamly_social_media_assets")
    .select("id,platform,status,title,media_url,asset_type,source,destination,topic,approved_for_automation,excluded_from_automation,archived_at,use_count,last_used_at,width,height,duration_seconds,is_vertical,metadata,created_at")
    .eq("approved_for_automation", true)
    .eq("excluded_from_automation", false)
    .order("use_count", { ascending: true })
    .order("last_used_at", { ascending: true, nullsFirst: true })
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.warn("[Roamly social] media library selection failed", error.message);
    return null;
  }

  const assets = ((data || []) as SocialMediaAssetRow[]).filter((asset) => {
    const type = assetType(asset);
    if (brand === "roamly" && type === "video" && isLegacyRoamlyGeneratedVideoAsset(asset)) {
      return false;
    }
    // Automatic queue generation must go through the current Reel renderer.
    // Library videos can carry arbitrary dimensions and embedded audio, so
    // only approved images are eligible for automatic visual selection.
    return type === "image" && isApprovedAutomationAsset(asset, brand);
  });

  return sortAutomationAssets(assets)[0] || null;
}

async function findPriorPublishedVisual(admin: SupabaseClient, currentDraftId: string, platform: string, sourceMediaAssetId: string) {
  if (!sourceMediaAssetId) return null;
  const { data: drafts, error: draftsError } = await admin
    .from("roamly_social_drafts")
    .select("id,selected_media_url,metadata,created_at")
    .eq("selected_media_asset_id", sourceMediaAssetId)
    .neq("id", currentDraftId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (draftsError || !drafts?.length) return null;
  const draftIds = drafts.map((draft) => draft.id);
  const { data: queues, error: queuesError } = await admin
    .from("roamly_social_queue")
    .select("id,draft_id,published_at,meta_response")
    .eq("platform", platform)
    .eq("queue_status", "published")
    .in("draft_id", draftIds)
    .order("published_at", { ascending: false })
    .limit(20);
  if (queuesError || !queues?.length) return null;
  const prior = queues[0] as { id: string; draft_id: string; published_at: string | null; meta_response: Record<string, unknown> | null };
  const priorDraft = drafts.find((draft) => draft.id === prior.draft_id);
  const metaResponse = objectValue(prior.meta_response);
  const mediaUrl = clean(String(metaResponse.mediaUrl || priorDraft?.selected_media_url || ""));
  if (!mediaUrl || !videoLooksSupported(mediaUrl)) return null;
  return { queueId: prior.id, draftId: prior.draft_id, publishedAt: prior.published_at, mediaUrl };
}

async function findLatestPublishedVisual(admin: SupabaseClient, currentDraftId: string, platform: string) {
  const { data, error } = await admin
    .from("roamly_social_queue")
    .select("id,draft_id,published_at,meta_response,draft:roamly_social_drafts!inner(id,selected_media_asset_id,selected_media_url)")
    .eq("platform", platform)
    .eq("queue_status", "published")
    .neq("draft_id", currentDraftId)
    .not("draft.selected_media_asset_id", "is", null)
    // The Aug 19 published Reel is the known-good visual baseline. Newer
    // generated outputs may have damaged visuals/audio and must not become
    // the fallback source for an empty draft.
    .order("published_at", { ascending: true })
    .limit(50);
  if (error || !data?.length) return null;
  for (const row of data as Array<Record<string, unknown>>) {
    const draft = objectValue(row.draft);
    const metaResponse = objectValue(row.meta_response);
    const mediaUrl = clean(String(metaResponse.mediaUrl || draft.selected_media_url || ""));
    const sourceMediaAssetId = clean(String(draft.selected_media_asset_id || ""));
    if (mediaUrl && sourceMediaAssetId && videoLooksSupported(mediaUrl)) {
      return { queueId: String(row.id), draftId: String(row.draft_id), mediaUrl, sourceMediaAssetId };
    }
  }
  return null;
}

function draftHashtags(draft: SocialDraftRow) {
  return Array.isArray(draft.hashtags)
    ? draft.hashtags.map((tag) => tag.replace(/^#/, "")).filter(Boolean)
    : [];
}

function reelSupportText(draft: SocialDraftRow, config: FacebookBrandConfig) {
  const direction = clean(draft.media_direction);
  if (direction) return direction;
  if (config.brand === "reviewintel") {
    return "ReviewIntel turns review patterns, complaints, and trust signals into a clearer product decision.";
  }
  return "Roamly keeps trip details, booking links, timing, and daily pacing in one practical travel plan.";
}

async function insertGeneratedReelMediaAsset(
  admin: SupabaseClient,
  draft: SocialDraftRow,
  config: FacebookBrandConfig,
  video: Awaited<ReturnType<typeof generateFreshSocialReelVideo>>,
  provenance: { sourceMediaAssetId?: string | null; sourceMediaUrl?: string | null } = {}
) {
  const { data, error } = await admin
    .from("roamly_social_media_assets")
    .insert({
      platform: config.platform,
      status: "approved",
      title: `${config.label} generated Reel - ${draft.topic || draft.content_type}`,
      caption: draft.caption,
      hashtags: draft.hashtags || [],
      media_url: video.publicUrl,
      topic: draft.topic || draft.content_type,
      asset_type: "video",
      approved_for_automation: true,
      excluded_from_automation: false,
      use_count: 0,
      is_vertical: true,
      metadata: withBrandMetadata(config.brand, {
        generated_by: "facebook_autopost_reel_generator",
        generated_at: new Date().toISOString(),
        format: "vertical_reel",
        mime_type: "video/mp4",
        width: video.width,
        height: video.height,
        duration_seconds: video.durationSeconds,
        file_size_bytes: video.size,
        public_url: video.publicUrl,
        object_path: video.objectPath,
        audio_track: video.audioTrack,
        source_draft_id: draft.id,
        sourceMediaAssetId: provenance.sourceMediaAssetId || null,
        sourceImageAssetId: provenance.sourceMediaAssetId || null,
        sourceMediaUrl: provenance.sourceMediaUrl || null,
        sourceImageUrl: provenance.sourceMediaUrl || null,
        sourceDraftId: draft.id
      })
    })
    .select("id")
    .single();

  if (error) {
    console.warn("[Roamly social] generated Reel media asset insert failed", error.message);
    return null;
  }

  return (data?.id as string | undefined) || null;
}

async function ensureReelVideo(
  admin: SupabaseClient,
  queueId: string,
  draft: SocialDraftRow,
  config: FacebookBrandConfig
): Promise<{
  mediaUrl: string;
  generatedVideo?: Awaited<ReturnType<typeof generateFreshSocialReelVideo>>;
  mediaAssetId?: string | null;
  sourceMediaAssetId?: string | null;
}> {
  const draftMetadata = objectValue(draft.metadata);
  const forceFreshGeneratedReel = draftMetadata.forceFreshGeneratedReel === true;
  const reuseExistingReel = draftMetadata.reuseExistingReel === true;
  const existingUrl = forceFreshGeneratedReel
    ? ""
    : clean(draft.selected_media_url || draft.suggested_media);
  const asset = !forceFreshGeneratedReel && draft.selected_media_asset_id
    ? await admin
        .from("roamly_social_media_assets")
        .select("id,platform,status,title,media_url,asset_type,source,approved_for_automation,excluded_from_automation,archived_at,use_count,last_used_at,width,height,duration_seconds,is_vertical,metadata,created_at")
        .eq("id", draft.selected_media_asset_id)
        .maybeSingle()
    : { data: null, error: null };
  if (asset.error) throw new FacebookGraphError(`Reel media asset validation failed: ${asset.error.message}`, false, { assetError: asset.error.message });
  if (draft.selected_media_asset_id && !asset.data) {
    throw new FacebookGraphError("The selected Facebook Reel media asset no longer exists.", false, { assetId: draft.selected_media_asset_id });
  }

  const selectedAsset = (asset.data || null) as SocialMediaAssetRow | null;
  const selectedAssetMetadata = objectValue(selectedAsset?.metadata);
  const selectedGeneratedMetadata = objectValue(selectedAssetMetadata.generatedReelVideo);
  const selectedAudioTrack = objectValue(selectedGeneratedMetadata.audioTrack);
  const selectedLooksGenerated = Boolean(
    selectedGeneratedMetadata.publicUrl ||
    selectedGeneratedMetadata.filename ||
    selectedAssetMetadata.generated_by ||
    selectedAssetMetadata.sourceMediaAssetId ||
    selectedAssetMetadata.sourceImageAssetId ||
    selectedAssetMetadata.facebookLibraryMedia
  );
  const reusableExistingReel = reuseExistingReel && (
    config.brand !== "roamly" ||
    (!selectedLooksGenerated || selectedAudioTrack.id === "roamly-theme")
  );
  // Preserve the campaign's source photo when regenerating an older Reel.
  // Post now stores this in postNow* metadata after clearing the old output.
  const boundSourceId = clean(String(
    draftMetadata.sourceMediaAssetId || draftMetadata.sourceImageAssetId ||
    draftMetadata.postNowSourceMediaAssetId || ""
  ));
  const boundSourceUrl = clean(String(
    draftMetadata.sourceMediaUrl || draftMetadata.sourceImageUrl ||
    draftMetadata.postNowSourceMediaUrl || ""
  ));
  let boundPhotoAsset: SocialMediaAssetRow | null = null;
  let boundPhotoUrl = "";
  if (config.brand === "roamly" && (boundSourceId || boundSourceUrl)) {
    if (boundSourceId && selectedAsset?.id === boundSourceId) {
      boundPhotoAsset = selectedAsset;
    } else if (boundSourceId) {
      const { data: boundAsset, error: boundAssetError } = await admin
        .from("roamly_social_media_assets")
        .select("id,platform,status,title,destination,topic,media_url,asset_type,source,approved_for_automation,excluded_from_automation,archived_at,use_count,last_used_at,width,height,duration_seconds,is_vertical,metadata,created_at")
        .eq("id", boundSourceId)
        .maybeSingle();
      if (boundAssetError) {
        throw new FacebookGraphError(`The campaign photo could not be resolved: ${boundAssetError.message}`, false, { draftId: draft.id, boundSourceId });
      }
      boundPhotoAsset = (boundAsset || null) as SocialMediaAssetRow | null;
    }
    if (boundPhotoAsset) {
      if (!isApprovedAutomationAsset(boundPhotoAsset, "roamly") || assetType(boundPhotoAsset) !== "image") {
        throw new FacebookGraphError("The campaign photo bound to this draft is missing, invalid, or not approved.", false, { draftId: draft.id, boundSourceId });
      }
      boundPhotoUrl = assetUrl(boundPhotoAsset);
    } else if (boundSourceUrl && !/\.mp4(?:\?|$)/i.test(boundSourceUrl)) {
      boundPhotoUrl = boundSourceUrl;
    } else {
      throw new FacebookGraphError("The campaign photo bound to this draft could not be resolved.", false, { draftId: draft.id, boundSourceId: boundSourceId || null, boundSourceUrl: boundSourceUrl || null });
    }
  }
  const pickedAsset = !forceFreshGeneratedReel && !existingUrl && !selectedAsset
    ? await pickAutomationMediaAsset(admin, config.brand)
    : null;
  let sourceAsset = boundPhotoAsset || selectedAsset || pickedAsset;
  let sourceUrl = boundPhotoUrl || (boundSourceUrl ? boundSourceUrl : existingUrl || assetUrl(sourceAsset));
  let sourceType = sourceAsset ? assetType(sourceAsset) : videoLooksSupported(sourceUrl) ? "video" : "";

  if (config.brand === "roamly" && boundPhotoUrl) {
    sourceAsset = boundPhotoAsset;
    sourceUrl = boundPhotoUrl;
    sourceType = "image";
  }

  // Damaged Aug 19-era drafts may have no media at all. Reuse the last
  // published visual and repair only its audio instead of rendering a blank
  // text Reel from scratch.
  if (!sourceUrl && config.brand === "roamly") {
    const priorPublishedVisual = await findLatestPublishedVisual(admin, draft.id, config.platform);
    const { supabaseUrl, serviceKey } = supabaseMediaConfig();
    if (priorPublishedVisual && supabaseUrl && serviceKey) {
      console.log("[ROAMLY_REPAIR_EMPTY_DRAFT_FROM_PUBLISHED_VISUAL]", {
        queueId,
        draftId: draft.id,
        priorQueueId: priorPublishedVisual.queueId,
        sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId
      });
      const video = await replaceRoamlyReelAudio({
        sourceVideoUrl: priorPublishedVisual.mediaUrl,
        topic: draft.topic || draft.content_type,
        supabaseUrl,
        serviceKey
      });
      const mediaAssetId = await insertGeneratedReelMediaAsset(admin, draft, config, video, {
        sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId,
        sourceMediaUrl: priorPublishedVisual.mediaUrl
      });
      const metadata = withBrandMetadata(config.brand, {
        ...(draft.metadata || {}),
        generatedReelVideo: { ...video, sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId, sourceMediaUrl: priorPublishedVisual.mediaUrl, audioRepairOnly: true, visualPreserved: true },
        sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId,
        facebookLibraryMedia: {
          mode: "legacy_published_visual_audio_repair",
          sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId,
          priorPublishedQueueId: priorPublishedVisual.queueId,
          sourceVideoUrl: priorPublishedVisual.mediaUrl,
          visualPreserved: true,
          audioReplacedOnly: true
        }
      });
      await admin.from("roamly_social_drafts").update({
        selected_media_url: video.publicUrl,
        selected_media_asset_id: mediaAssetId,
        media_hash: hash(video.publicUrl),
        metadata
      }).eq("id", draft.id);
      return { mediaUrl: video.publicUrl, generatedVideo: video, mediaAssetId, sourceMediaAssetId: priorPublishedVisual.sourceMediaAssetId };
    }
  }

  if (sourceUrl && sourceType === "video") {
    /*
     * Older Roamly generated Reels can contain the old synthetic audio.
     * If this MP4 was generated from one of Roamly's original library
     * photos, regenerate from THAT SAME PHOTO with the current renderer.
     */
    if (config.brand === "roamly" && sourceAsset && !reusableExistingReel) {
      const sourceAssetMetadata = objectValue(sourceAsset.metadata);
      const libraryMediaMetadata = objectValue(
        sourceAssetMetadata.facebookLibraryMedia
      );
      const generatedReelMetadata = objectValue(
        sourceAssetMetadata.generatedReelVideo
      );

      const draftMetadata = objectValue(draft.metadata);
      const draftLibraryMediaMetadata = objectValue(
        draftMetadata.facebookLibraryMedia
      );
      const draftGeneratedReelMetadata = objectValue(
        draftMetadata.generatedReelVideo
      );

      const rawOriginalSourceMediaAssetId =
        sourceAssetMetadata.sourceMediaAssetId ??
        sourceAssetMetadata.sourceImageAssetId ??
        sourceAssetMetadata.originalPhotoAssetId ??
        libraryMediaMetadata.sourceMediaAssetId ??
        libraryMediaMetadata.sourceImageAssetId ??
        generatedReelMetadata.sourceMediaAssetId ??
        generatedReelMetadata.sourceImageAssetId ??
        draftMetadata.sourceMediaAssetId ??
        draftMetadata.sourceImageAssetId ??
        draftMetadata.originalPhotoAssetId ??
        draftLibraryMediaMetadata.sourceMediaAssetId ??
        draftLibraryMediaMetadata.sourceImageAssetId ??
        draftGeneratedReelMetadata.sourceMediaAssetId ??
        draftGeneratedReelMetadata.sourceImageAssetId ??
        "";

      const originalSourceMediaAssetId = clean(
        String(rawOriginalSourceMediaAssetId)
      );

      if (
        originalSourceMediaAssetId &&
        originalSourceMediaAssetId !== sourceAsset.id
      ) {
        const { data: originalSourceAsset } = await admin
          .from("roamly_social_media_assets")
          .select("id,platform,status,title,media_url,asset_type,source,approved_for_automation,excluded_from_automation,archived_at,use_count,last_used_at,width,height,duration_seconds,is_vertical,metadata,created_at")
          .eq("id", originalSourceMediaAssetId)
          .maybeSingle();

        const originalPhoto =
          (originalSourceAsset || null) as SocialMediaAssetRow | null;

        if (
          originalPhoto &&
          assetType(originalPhoto) === "image" &&
          assetUrl(originalPhoto)
        ) {
          const originalPhotoUrl = assetUrl(originalPhoto);

          const probe = await probeFacebookAccessibleUrl({
            url: originalPhotoUrl,
            timeoutMs: 7000
          });

          if (!probe.ok) {
            throw new FacebookGraphError(
              probe.error || "Original Roamly source photo is not publicly reachable.",
              false,
              {
                mediaUrl: originalPhotoUrl,
                sourceMediaAssetId: originalPhoto.id
              }
            );
          }

          const { supabaseUrl, serviceKey } = supabaseMediaConfig();

          if (!supabaseUrl || !serviceKey) {
            throw new FacebookGraphError(
              "Static photo Reel conversion requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.",
              false,
              {}
            );
          }

          console.log("[ROAMLY_REGENERATE_STALE_REEL_FROM_ORIGINAL_PHOTO]", {
            queueId,
            draftId: draft.id,
            staleVideoAssetId: sourceAsset.id,
            originalPhotoAssetId: originalPhoto.id,
            originalPhotoUrl
          });

          const video = await generateStaticSocialPosterReelVideo({
            brand: config.brand,
            sourceImageUrl: originalPhotoUrl,
            topic: draft.topic || draft.content_type,
            supabaseUrl,
            serviceKey,
            audioSeed: `${config.brand}:static-photo:${queueId}:${draft.id}:${originalPhoto.id}`
          });

          const mediaAssetId = await insertGeneratedReelMediaAsset(
            admin,
            draft,
            config,
            video,
            { sourceMediaAssetId: originalPhoto.id, sourceMediaUrl: originalPhotoUrl }
          );

          const generatedReelVideo = {
            filename: video.filename,
            objectPath: video.objectPath,
            publicUrl: video.publicUrl,
            size: video.size,
            width: video.width,
            height: video.height,
            durationSeconds: video.durationSeconds,
            mimeType: video.mimeType,
            ffprobe: video.ffprobe,
            audioTrack: video.audioTrack,
            generatedAt: new Date().toISOString(),
            sourceMediaAssetId: originalPhoto.id,
            sourceMediaUrl: originalPhotoUrl,
            visualRules: {
              generatedText: false,
              crop: false,
              pan: false,
              zoom: false
            }
          };

          await admin
            .from("roamly_social_drafts")
            .update({
              selected_media_url: video.publicUrl,
              selected_media_asset_id: mediaAssetId,
              media_hash: hash(video.publicUrl),
              metadata: withBrandMetadata(config.brand, {
                ...(draft.metadata || {}),
                generatedReelVideo,
                sourceMediaAssetId: originalPhoto.id,
                facebookLibraryMedia: {
                  mode: "static_library_photo",
                  sourceMediaAssetId: originalPhoto.id,
                  generatedMediaAssetId: mediaAssetId,
                  sourceMediaUrl: originalPhotoUrl,
                  publicUrl: video.publicUrl,
                  publicProbe: probe,
                  regeneratedBecause: "stale_generated_reel_audio",
                  visualRules: generatedReelVideo.visualRules
                }
              })
            })
            .eq("id", draft.id);

          return {
            mediaUrl: video.publicUrl,
            generatedVideo: video,
            mediaAssetId,
            sourceMediaAssetId: originalPhoto.id
          };
        }
      }

    }

    // Generated Reels are outputs, never reusable visual sources. Return
    // them to the original fresh-generation path; uploaded videos remain.
    const sourceMetadata = objectValue(sourceAsset?.metadata);
    const sourceGenerated = objectValue(sourceMetadata.generatedReelVideo);
    const generatedByAutopost = String(sourceMetadata.generated_by || "").includes("reel_generator");
    if (!reusableExistingReel && (isLegacyRoamlyGeneratedVideoAsset(sourceAsset) || generatedByAutopost || sourceGenerated.publicUrl)) {
      const sourceMediaAssetId = clean(String(
        sourceAsset?.id || sourceMetadata.sourceMediaAssetId ||
        sourceMetadata.sourceImageAssetId || draftMetadata.sourceMediaAssetId ||
        draftMetadata.sourceImageAssetId || ""
      ));
      const priorPublishedVisual = await findPriorPublishedVisual(
        admin,
        draft.id,
        config.platform,
        sourceMediaAssetId
      );
      const { supabaseUrl, serviceKey } = supabaseMediaConfig();
      if (priorPublishedVisual && supabaseUrl && serviceKey) {
        console.log("[ROAMLY_REPAIR_LEGACY_REEL_AUDIO_ONLY]", {
          queueId,
          draftId: draft.id,
          priorQueueId: priorPublishedVisual.queueId,
          sourceMediaAssetId,
          priorMediaUrl: priorPublishedVisual.mediaUrl
        });
        const video = await replaceRoamlyReelAudio({
          sourceVideoUrl: priorPublishedVisual.mediaUrl,
          topic: draft.topic || draft.content_type,
          supabaseUrl,
          serviceKey
        });
        const mediaAssetId = await insertGeneratedReelMediaAsset(admin, draft, config, video, {
          sourceMediaAssetId,
          sourceMediaUrl: priorPublishedVisual.mediaUrl
        });
        const repairMetadata = withBrandMetadata(config.brand, {
          ...(draft.metadata || {}),
          generatedReelVideo: { ...video, sourceMediaAssetId, sourceMediaUrl: priorPublishedVisual.mediaUrl, audioRepairOnly: true, visualPreserved: true },
          sourceMediaAssetId,
          facebookLibraryMedia: {
            mode: "legacy_published_visual_audio_repair",
            sourceMediaAssetId,
            priorPublishedQueueId: priorPublishedVisual.queueId,
            sourceVideoUrl: priorPublishedVisual.mediaUrl,
            visualPreserved: true,
            audioReplacedOnly: true
          }
        });
        await admin.from("roamly_social_drafts").update({
          selected_media_url: video.publicUrl,
          selected_media_asset_id: mediaAssetId,
          media_hash: hash(video.publicUrl),
          metadata: repairMetadata
        }).eq("id", draft.id);
        return { mediaUrl: video.publicUrl, generatedVideo: video, mediaAssetId, sourceMediaAssetId };
      }
      sourceAsset = null;
      sourceUrl = "";
      sourceType = "";
    }

    if (sourceUrl && sourceType === "video") {
    if (!videoLooksSupported(sourceUrl)) {
      throw new FacebookGraphError("The selected Facebook Reel asset is not an MP4 video.", false, { mediaUrl: sourceUrl || null });
    }
    if (sourceAsset) {
      const assetMetadata = objectValue(sourceAsset.metadata);
      assertUploadedReelVideoAsset({
        assetType: assetType(sourceAsset) || sourceAsset.asset_type,
        isVertical: sourceAsset.is_vertical ?? assetMetadata.is_vertical,
        width: sourceAsset.width ?? assetMetadata.width,
        height: sourceAsset.height ?? assetMetadata.height,
        durationSeconds: sourceAsset.duration_seconds ?? assetMetadata.duration_seconds,
        fileSizeBytes: assetMetadata.file_size_bytes ?? assetMetadata.size_bytes
      });
    }
    const probe = await probeFacebookAccessibleUrl({ url: sourceUrl, timeoutMs: 7000 });
    if (!probe.ok) {
      throw new FacebookGraphError(probe.error || "Configured Reel MP4 is not publicly reachable.", false, { probe, mediaUrl: sourceUrl });
    }
    await admin.from("roamly_facebook_media_processing").insert({
      queue_id: queueId,
      draft_id: draft.id,
      processing_status: "ready",
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "existing_video_selected",
        page_id: config.pageId,
        mediaUrl: sourceUrl,
        mediaAssetId: sourceAsset?.id || draft.selected_media_asset_id || null,
        publicProbe: probe,
        generatedVideoRequired: false
      })
    });
    if (sourceAsset) {
      await admin
        .from("roamly_social_drafts")
        .update({
          selected_media_url: sourceUrl,
          selected_media_asset_id: sourceAsset.id,
          media_hash: hash(sourceUrl),
          metadata: withBrandMetadata(config.brand, {
            ...(draft.metadata || {}),
            facebookLibraryMedia: {
              mode: "original_video",
              sourceMediaAssetId: sourceAsset.id,
              publicUrl: sourceUrl,
              publicProbe: probe
            }
          })
        })
        .eq("id", draft.id);
    }
    return {
      mediaUrl: sourceUrl,
      mediaAssetId: sourceAsset?.id || draft.selected_media_asset_id,
      sourceMediaAssetId: sourceAsset?.id || draft.selected_media_asset_id
    };
    }
  }

    if (sourceUrl && sourceType === "image") {
    const probe = await probeFacebookAccessibleUrl({ url: sourceUrl, timeoutMs: 7000 });
    if (!probe.ok) {
      throw new FacebookGraphError(probe.error || "Configured Reel image is not publicly reachable.", false, { probe, mediaUrl: sourceUrl });
    }
    const { supabaseUrl, serviceKey } = supabaseMediaConfig();
    if (!supabaseUrl || !serviceKey) {
      throw new FacebookGraphError("Static photo Reel conversion requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", false, {});
    }
    await admin.from("roamly_facebook_media_processing").insert({
      queue_id: queueId,
      draft_id: draft.id,
      processing_status: "pending",
      metadata: withBrandMetadata(config.brand, {
        stage: "static_photo_reel_generation_started",
        page_id: config.pageId,
        sourceMediaAssetId: sourceAsset?.id || null,
        sourceMediaUrl: sourceUrl,
        publicProbe: probe,
        visualRules: {
          generatedText: false,
          crop: false,
          pan: false,
          zoom: false
        }
      })
    });

    const video = await generateStaticSocialPosterReelVideo({
      brand: config.brand,
      sourceImageUrl: sourceUrl,
      topic: draft.topic || draft.content_type,
      supabaseUrl,
      serviceKey,
      audioSeed: `${config.brand}:static-photo:${queueId}:${draft.id}:${sourceAsset?.id || Date.now()}`
    });
    const mediaAssetId = await insertGeneratedReelMediaAsset(admin, draft, config, video, {
      sourceMediaAssetId: sourceAsset?.id || null,
      sourceMediaUrl: sourceUrl
    });
    const generatedReelVideo = {
      filename: video.filename,
      objectPath: video.objectPath,
      publicUrl: video.publicUrl,
      size: video.size,
      width: video.width,
      height: video.height,
      durationSeconds: video.durationSeconds,
      mimeType: video.mimeType,
      ffprobe: video.ffprobe,
      audioTrack: video.audioTrack,
      generatedAt: new Date().toISOString(),
      sourceMediaAssetId: sourceAsset?.id || null,
      sourceMediaUrl: sourceUrl,
      visualRules: {
        generatedText: false,
        crop: false,
        pan: false,
        zoom: false
      }
    };
    const metadata = withBrandMetadata(config.brand, {
      ...(draft.metadata || {}),
      generatedReelVideo,
      sourceMediaAssetId: sourceAsset?.id || null,
      facebookLibraryMedia: {
        mode: "static_library_photo",
        sourceMediaAssetId: sourceAsset?.id || null,
        generatedMediaAssetId: mediaAssetId,
        sourceMediaUrl: sourceUrl,
        publicUrl: video.publicUrl,
        publicProbe: probe,
        visualRules: generatedReelVideo.visualRules
      }
    });

    await admin
      .from("roamly_social_drafts")
      .update({
        selected_media_url: video.publicUrl,
        selected_media_asset_id: mediaAssetId,
        media_hash: hash(video.publicUrl),
        metadata
      })
      .eq("id", draft.id);

    await admin
      .from("roamly_facebook_media_processing")
      .update({
        processing_status: "ready",
        checked_at: new Date().toISOString(),
        metadata: withBrandMetadata(config.brand, {
          stage: "static_photo_reel_generated",
          generatedVideo: generatedReelVideo,
          mediaAssetId,
          sourceMediaAssetId: sourceAsset?.id || null,
          page_id: config.pageId
        })
      })
      .eq("queue_id", queueId)
      .is("facebook_video_id", null);

    return {
      mediaUrl: video.publicUrl,
      generatedVideo: video,
      mediaAssetId,
      sourceMediaAssetId: sourceAsset?.id || null
    };
  }

  if (sourceUrl) {
    throw new FacebookGraphError("The selected Facebook Reel media asset is unsupported.", false, { mediaUrl: sourceUrl, mediaType: sourceType || null });
  }

  const { supabaseUrl, serviceKey } = supabaseMediaConfig();
  if (!supabaseUrl || !serviceKey) {
    throw new FacebookGraphError("Reel generation requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.", false, {});
  }

  await admin.from("roamly_facebook_media_processing").insert({
    queue_id: queueId,
    draft_id: draft.id,
    processing_status: "pending",
    metadata: withBrandMetadata(config.brand, {
      stage: "video_generation_started",
      page_id: config.pageId,
      reelOnly: true,
      generatedVideoRequired: true
    })
  });

  const caption = finalCaption(draft);
  const video = await generateFreshSocialReelVideo({
    brand: config.brand,
    topic: draft.topic || draft.content_type,
    hook: draft.hook,
    support: reelSupportText(draft, config),
    cta: clean(draft.call_to_action) || (config.brand === "reviewintel" ? "Scan before you buy" : "Plan your next trip"),
    caption,
    hashtags: draftHashtags(draft),
    websiteUrl: clean(draft.roamly_link) || config.primaryLink,
    affiliateUrl: clean(draft.amazon_affiliate_link) || config.affiliateUrl || undefined,
    supabaseUrl,
    serviceKey,
    audioSeed: `${config.brand}:${queueId}:${draft.id}:${Date.now()}`
  });

  const mediaAssetId = await insertGeneratedReelMediaAsset(admin, draft, config, video);
  const generatedReelVideo = {
    filename: video.filename,
    objectPath: video.objectPath,
    publicUrl: video.publicUrl,
    size: video.size,
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    mimeType: video.mimeType,
    ffprobe: video.ffprobe,
    audioTrack: video.audioTrack,
    generatedAt: new Date().toISOString()
  };
  assertReelMediaMetadata({
    assetType: "video",
    isVertical: video.width / video.height === 9 / 16,
    width: video.width,
    height: video.height,
    durationSeconds: video.durationSeconds,
    fileSizeBytes: video.size
  });
  const metadata = withBrandMetadata(config.brand, {
    ...(draft.metadata || {}),
    generatedReelVideo
  });

  await admin
    .from("roamly_social_drafts")
    .update({
      selected_media_url: video.publicUrl,
      selected_media_asset_id: mediaAssetId,
      media_hash: hash(video.publicUrl),
      metadata
    })
    .eq("id", draft.id);

  await admin
    .from("roamly_facebook_media_processing")
    .update({
      processing_status: "ready",
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "video_generated",
        generatedVideo: generatedReelVideo,
        mediaAssetId,
        page_id: config.pageId
      })
    })
    .eq("queue_id", queueId)
    .is("facebook_video_id", null);

  return { mediaUrl: video.publicUrl, generatedVideo: video, mediaAssetId };
}

async function uploadReelVideo(config: FacebookBrandConfig, uploadUrl: string, videoUrl: string) {
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      Authorization: `OAuth ${config.pageAccessToken}`,
      file_url: videoUrl
    }
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { success?: boolean; error?: { message?: string } };
  if (!response.ok || body.error) {
    throw new FacebookGraphError(body.error?.message || "Facebook Reel upload failed.", response.status >= 500 || response.status === 429, body);
  }
  return body;
}

async function waitForReelProcessing(config: FacebookBrandConfig, videoId: string) {
  return {
    state: "unknown" as const,
    response: { id: videoId },
    status: "NOT_EXPOSED_BY_META_API",
    error: "Meta processing status is not exposed by the current final-object API; continuing to the documented finish request."
  };
}

async function findPublishedReelInPageCollection(config: FacebookBrandConfig, videoId: string) {
  let after = "";
  for (let page = 0; page < 10; page += 1) {
    const collection = await facebookGraph<{
      data?: Array<Record<string, unknown>>;
      paging?: { cursors?: { after?: string } };
    }>(config, `${config.pageId}/video_reels`, {
      method: "GET",
      params: {
        fields: "id,permalink_url,media_type,is_reel,created_time",
        limit: "100",
        ...(after ? { after } : {})
      }
    });
    const match = (Array.isArray(collection.data) ? collection.data : []).find(
      (candidate) => clean(String(candidate.id || "")) === videoId
    );
    if (match) return { object: match, pagesScanned: page + 1, completeWithinBound: true };
    const nextAfter = clean(String(collection.paging?.cursors?.after || ""));
    if (!nextAfter) return { object: null, pagesScanned: page + 1, completeWithinBound: true };
    after = nextAfter;
  }
  return { object: null, pagesScanned: 10, completeWithinBound: false };
}


function finalFacebookReelCaption(
  draft: QueueWithDraft["draft"],
  brand: FacebookSocialBrand
) {
  const original = finalCaption(draft);

  if (normalizeFacebookBrand(brand) !== "roamly") {
    return original;
  }

  // Strip the entire old hashtag section from Roamly's final caption.
  // This deliberately bypasses all earlier hashtag sanitizers that
  // produced broken output such as "#p #pp".
  const withoutHashtags = original
    .split(/\n/)
    .filter((line) => !line.trim().startsWith("#"))
    .join("\n")
    .trim();

  // IMPORTANT:
  // These three tags are literal final-output text.
  // Do not pass them through uniqueHashtags(), regex cleanup,
  // normalization, slicing, or any other sanitizer.
  return `${withoutHashtags}\n\n#travel #travelreels #travelinspiration #fypシ #fypシ゚viralシ #fypviralシ`;
}

async function publishFacebookReel(
  admin: SupabaseClient,
  queueId: string,
  draft: SocialDraftRow,
  brand: FacebookSocialBrand = metadataBrand(draft.metadata)
): Promise<PublishResult> {
  console.log("[FB_REEL_STAGE_1_CONFIG_START]", { queueId, brand });
  const config = await facebookBrandConfigForPosting(brand);
  console.log("[FB_REEL_STAGE_2_CONFIG_OK]", { queueId, pageId: config.pageId });

  console.log("[FB_REEL_STAGE_3_ENSURE_START]", { queueId });
  const reelMedia = await ensureReelVideo(admin, queueId, draft, config);
  console.log("[FB_REEL_STAGE_4_ENSURE_OK]", {
    queueId,
    mediaUrl: reelMedia.mediaUrl,
    generatedVideo: reelMedia.generatedVideo || null
  });

  const mediaUrl = reelMedia.mediaUrl;

  console.log("[FB_REEL_STAGE_5_META_START_REQUEST]", { queueId });
  const start = await facebookGraph<{ video_id?: string; upload_url?: string }>(config, `${config.pageId}/video_reels`, {
    params: { upload_phase: "start" }
  });
  console.log("[FB_REEL_STAGE_6_META_START_OK]", { queueId, videoId: start.video_id || null });
  const videoId = clean(start.video_id);
  const uploadUrl = clean(start.upload_url);
  if (!videoId || !uploadUrl) {
    return { ok: false, status: "failed", temporary: true, error: "Meta did not return a Reel upload target.", metaResponse: start };
  }

  await admin
    .from("roamly_facebook_media_processing")
    .update({
      facebook_video_id: videoId,
      facebook_upload_url: uploadUrl,
      processing_status: "uploading",
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "meta_upload_started",
        page_id: config.pageId,
        mediaUrl,
        generatedVideo: reelMedia.generatedVideo || null,
        start
      })
    })
    .eq("queue_id", queueId)
    .is("facebook_video_id", null);

  console.log("[FB_REEL_STAGE_7_UPLOAD_START]", { queueId, mediaUrl });
  const upload = await uploadReelVideo(config, uploadUrl, mediaUrl);
  console.log("[FB_REEL_STAGE_8_UPLOAD_OK]", { queueId });
  await admin
    .from("roamly_facebook_media_processing")
    .update({
      processing_status: "processing",
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "meta_upload_complete",
        page_id: config.pageId,
        mediaUrl,
        generatedVideo: reelMedia.generatedVideo || null,
        start,
        upload
      })
    })
    .eq("queue_id", queueId);

  console.log("[FB_REEL_STAGE_9_PROCESSING_WAIT]", { queueId, videoId });
  const processing = await waitForReelProcessing(config, videoId);
  console.log("[FB_REEL_STAGE_10_PROCESSING_RESULT]", {
    queueId,
    state: processing.state,
    status: processing.status,
    error: processing.error || null
  });
  console.log("[FB_REEL_STAGE_11_FINISH_START]", {
    queueId,
    caption: finalFacebookReelCaption(draft, brand)
  });
  const finish = await facebookGraph<{ id?: string; post_id?: string; success?: boolean }>(config, `${config.pageId}/video_reels`, {
    params: {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      description: finalFacebookReelCaption(draft, brand)
    }
  });
  console.log("[FB_REEL_STAGE_12_FINISH_OK]", { queueId, finish });
  if (finish.success !== true) {
    throw new FacebookGraphError("Facebook Reel publish was not explicitly confirmed by Meta.", true, finish as Record<string, unknown>);
  }

  let confirmation: Record<string, unknown> = {};
  let confirmationError: string | null = null;
  try {
    const collectionMatch = await findPublishedReelInPageCollection(config, videoId);
    confirmation = collectionMatch.object || {};
    if (!collectionMatch.object) {
      confirmationError = collectionMatch.completeWithinBound
        ? "Meta did not return the upload video ID in the Page video_reels collection."
        : "Meta Page video_reels pagination remained incomplete while resolving the published Reel.";
    }
  } catch (error) {
    confirmationError = error instanceof Error ? error.message : "Meta Page Reel collection lookup failed.";
    confirmation = error instanceof FacebookGraphError ? error.responseBody : {};
  }
  const permalink = typeof confirmation.permalink_url === "string" ? confirmation.permalink_url : "";
  const visibility = permalink && !confirmationError
    ? await probeFacebookPublicVisibility({ url: permalink, timeoutMs: 7000 })
    : { verified: false, reason: confirmationError ? "Meta final object confirmation failed." : "Public permalink is missing." };
  const classification = classifyFacebookPublication({ finish, confirmation, confirmationError, visibility });
  const publishedVideoId = clean(String(confirmation.id || ""));
  const publishedPostId = clean(String(finish.post_id || finish.id || ""));
  if (classification.truth === "failed") {
    await admin
      .from("roamly_facebook_media_processing")
      .update({ processing_status: "failed", error_message: classification.reason, checked_at: new Date().toISOString() })
      .eq("queue_id", queueId);
    return {
      ok: false,
      status: "failed",
      temporary: true,
      error: classification.reason,
      metaResponse: withBrandMetadata(config.brand, {
        pageId: config.pageId,
        graphVersion: config.graphVersion,
        confirmation,
        publishedVideoId,
        publishedPostId: publishedPostId || null,
        finish,
        publicationTruth: classification.truth,
        publicationReason: classification.reason
      })
    };
  }
  await admin
    .from("roamly_facebook_media_processing")
    .update({
      processing_status: "published",
      published_at: new Date().toISOString(),
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "meta_publish_complete",
        page_id: config.pageId,
        graphVersion: config.graphVersion,
        mediaUrl,
        generatedVideo: reelMedia.generatedVideo || null,
        start,
        upload,
        finish,
        confirmation,
        confirmationError,
        confirmationStatus: classification.truth,
        platformMediaType: classification.classifiedAsReel ? "reel" : "unconfirmed",
        publicationTruth: classification.truth,
        publicationReason: classification.reason,
        publicVisibility: visibility,
        verificationTimestamp: new Date().toISOString()
      })
    })
    .eq("queue_id", queueId);

  return {
    ok: true,
    status: "published",
    publicationTruth: classification.truth,
    facebookPostId: publishedPostId || null,
    facebookReelId: publishedVideoId || null,
    facebookMediaId: videoId,
    facebookUrl: permalink || null,
    mediaAssetId: reelMedia.mediaAssetId || null,
    sourceMediaAssetId: reelMedia.sourceMediaAssetId || null,
    metaResponse: withBrandMetadata(config.brand, {
      pageId: config.pageId,
      postedAs: classification.classifiedAsReel ? "reel" : "unconfirmed",
      platformMediaType: classification.classifiedAsReel ? "reel" : "unconfirmed",
      publicationTruth: classification.truth,
      publicationReason: classification.reason,
      publicVisibility: visibility,
      verificationTimestamp: new Date().toISOString(),
      graphVersion: config.graphVersion,
      mediaUrl,
      mediaAssetId: reelMedia.mediaAssetId || null,
      sourceMediaAssetId: reelMedia.sourceMediaAssetId || null,
      generatedVideo: reelMedia.generatedVideo || null,
      start,
      upload,
      finish,
      confirmation,
      confirmationError,
      confirmationStatus: classification.truth
    })
  };
}

function finalCaption(draft: SocialDraftRow) {
  const disclosure = clean(draft.affiliate_disclosure);
  const hashtags = Array.isArray(draft.hashtags)
    ? draft.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")
    : "";
  const caption = [draft.caption, disclosure && !draft.caption.includes(disclosure) ? disclosure : "", hashtags].filter(Boolean).join("\n\n");
  return caption.slice(0, 6000);
}

async function publishQueueItem(admin: SupabaseClient, item: QueueWithDraft): Promise<PublishResult> {
  const brand = brandFromQueueItem(item);
  if (item.facebook_post_id || item.facebook_reel_id || item.published_at) {
    return {
      ok: true,
      status: "published",
      facebookPostId: item.facebook_post_id,
      facebookReelId: item.facebook_reel_id,
      facebookMediaId: item.facebook_media_id,
      facebookUrl: item.facebook_url,
      metaResponse: withBrandMetadata(brand, { duplicateProtection: true })
    };
  }

  const draft = item.draft;
  if (draft.post_format !== "reel") {
    return {
      ok: false,
      status: "failed",
      temporary: false,
      error: "Automatic Facebook publishing is Reel-only. Non-Reel drafts require manual handling.",
      metaResponse: withBrandMetadata(brand, {
        blockedFallback: true,
        originalFormat: draft.post_format,
        reason: "no_image_or_feed_fallback"
      })
    };
  }
  return publishFacebookReel(admin, item.id, draft, brand);
}

async function saveAttempt(
  admin: SupabaseClient,
  item: QueueWithDraft,
  status: "published" | "failed" | "retrying" | "skipped",
  result: PublishResult,
  attemptNumber: number
) {
  const brand = brandFromQueueItem(item);
  await admin.from("roamly_publishing_attempts").insert({
    queue_id: item.id,
    draft_id: item.draft_id,
    platform: brandPlatform(brand),
    attempt_number: attemptNumber,
    status,
    temporary_failure: Boolean(result.temporary),
    facebook_post_id: result.facebookPostId || null,
    facebook_reel_id: result.facebookReelId || null,
    facebook_media_id: result.facebookMediaId || null,
    facebook_url: result.facebookUrl || null,
    error_message: result.error || null,
    meta_response: result.metaResponse || {},
    finished_at: new Date().toISOString()
  });
}

async function markMediaAssetUsed(
  admin: SupabaseClient,
  mediaAssetId: string,
  item: QueueWithDraft,
  brand: FacebookSocialBrand,
  usedAt: string,
  metadata: Record<string, unknown> = {}
) {
  const current = await admin
    .from("roamly_social_media_assets")
    .select("use_count")
    .eq("id", mediaAssetId)
    .maybeSingle();
  const useCount = Number((current.data as { use_count?: number | null } | null)?.use_count || 0) + 1;
  await admin
    .from("roamly_social_media_assets")
    .update({
      use_count: useCount,
      last_used_at: usedAt
    })
    .eq("id", mediaAssetId);
  await admin.from("roamly_media_library_usage").insert({
    media_asset_id: mediaAssetId,
    draft_id: item.draft_id,
    queue_id: item.id,
    platform: brandPlatform(brand),
    use_count: 1,
    last_used_at: usedAt,
    status: "active",
    metadata
  });
}

async function markPublished(admin: SupabaseClient, item: QueueWithDraft, result: PublishResult) {
  const now = new Date().toISOString();
  const brand = brandFromQueueItem(item);
  await Promise.all([
    admin
      .from("roamly_social_queue")
      .update({
        queue_status: result.publicationTruth === "processing" ? "retrying" : "published",
        facebook_post_id: result.facebookPostId || null,
        facebook_reel_id: result.facebookReelId || null,
        facebook_media_id: result.facebookMediaId || null,
        facebook_url: result.facebookUrl || null,
        published_at: result.publicationTruth === "processing" ? null : now,
        processing_finished_at: result.publicationTruth === "processing" ? null : now,
        processing_locked_at: null,
        processing_lock_token: null,
        last_error: null,
        meta_response: result.metaResponse || {},
        metadata: {
          ...(item.metadata || {}),
          publicationTruth: result.publicationTruth || "published_unverified"
        },
        retry_after: result.publicationTruth === "processing" ? new Date(Date.now() + 10 * 60_000).toISOString() : null
      })
      .eq("id", item.id),
    admin.from("roamly_social_drafts").update({ status: result.publicationTruth === "processing" ? "scheduled" : "published" }).eq("id", item.draft_id),
    admin.from("roamly_scheduled_posts").update({ status: result.publicationTruth === "processing" ? "retrying" : "published" }).eq("queue_id", item.id),
    admin
      .from("roamly_publishing_jobs")
      .update({
        job_status: result.publicationTruth === "processing" ? "retrying" : "published",
        finished_at: result.publicationTruth === "processing" ? null : now,
        lock_token: null,
        locked_at: null,
        last_error: result.publicationTruth === "processing" ? "Meta processing remains unresolved." : null
      })
      .eq("queue_id", item.id)
  ]);

  if (result.publicationTruth === "processing") return;

  const draftMetadata = objectValue(item.draft.metadata);
  const mediaIds = [
    result.mediaAssetId,
    result.sourceMediaAssetId,
    item.draft.selected_media_asset_id,
    clean(String(draftMetadata.sourceMediaAssetId || ""))
  ].filter((value): value is string => Boolean(value));
  for (const mediaAssetId of [...new Set(mediaIds)]) {
    await markMediaAssetUsed(admin, mediaAssetId, item, brand, now, {
      source: "facebook_publish_success",
      resultMediaAssetId: result.mediaAssetId || null,
      sourceMediaAssetId: result.sourceMediaAssetId || null
    });
  }
}

async function markFailed(admin: SupabaseClient, item: QueueWithDraft, result: PublishResult, retryLimit: number) {
  const now = new Date();
  const brand = brandFromQueueItem(item);
  const nextAttempt = (item.attempt_count || 0) + 1;
  const canRetry = Boolean(result.temporary && nextAttempt <= retryLimit);
  const retryAfter = new Date(now.getTime() + Math.min(90, 10 * nextAttempt) * 60_000).toISOString();
  const status: FacebookQueueStatus = canRetry ? "retrying" : "failed";

  await Promise.all([
    admin
      .from("roamly_social_queue")
      .update({
        queue_status: status,
        retry_after: canRetry ? retryAfter : null,
        scheduled_for: canRetry ? retryAfter : item.scheduled_for,
        permanent_failure: !canRetry,
        last_error: result.error || "Publishing failed.",
        processing_finished_at: now.toISOString(),
        processing_locked_at: null,
        processing_lock_token: null
      })
      .eq("id", item.id),
    admin.from("roamly_social_drafts").update({ status: status === "failed" ? "failed" : "scheduled" }).eq("id", item.draft_id),
    admin.from("roamly_scheduled_posts").update({ status }).eq("queue_id", item.id),
    admin
      .from("roamly_publishing_jobs")
      .update({
        job_status: status,
        finished_at: now.toISOString(),
        lock_token: null,
        locked_at: null,
        last_error: result.error || "Publishing failed."
      })
      .eq("queue_id", item.id),
    admin.from("roamly_failed_jobs").insert({
      queue_id: item.id,
      draft_id: item.draft_id,
      platform: brandPlatform(brand),
      failure_type: canRetry ? "temporary" : "permanent",
      error_message: result.error || "Publishing failed.",
      metadata: withBrandMetadata(brand, { temporary: result.temporary, attempt: nextAttempt })
    })
  ]);

  return status;
}

export async function validateFacebookPageConnection(brand: FacebookSocialBrand = "roamly") {
  const config = await facebookBrandConfigForPosting(brand);
  const blockingIssues: string[] = [];
  if (!config.facebookEnabled) blockingIssues.push(`${config.label} Facebook publishing is not enabled.`);
  if (!config.pageId) blockingIssues.push(`${config.label} Facebook Page ID is missing.`);
  if (!config.pageAccessToken) blockingIssues.push(`${config.label} Facebook Page access token is missing.`);

  if (blockingIssues.length) {
    return {
      ok: false as const,
      pageName: "",
      pageId: config.pageId,
      permissions: ["pages_manage_posts", "pages_read_engagement", "pages_show_list"],
      blockingIssues
    };
  }

  try {
    const response = await facebookGraph<{ id?: string; name?: string }>(config, `${config.pageId}`, {
      method: "GET",
      params: { fields: "id,name" }
    });
    return {
      ok: Boolean(response.id),
      pageName: response.name || "",
      pageId: response.id || config.pageId,
      permissions: ["pages_manage_posts", "pages_read_engagement", "pages_show_list", "pages_manage_metadata"],
      blockingIssues: response.id ? [] : ["Meta did not confirm the Facebook Page ID."]
    };
  } catch (error) {
    return {
      ok: false as const,
      pageName: "",
      pageId: config.pageId,
      permissions: ["pages_manage_posts", "pages_read_engagement", "pages_show_list", "pages_manage_metadata"],
      blockingIssues: [error instanceof Error ? error.message : "Facebook Page validation failed."]
    };
  }
}

async function createCronLog(admin: SupabaseClient) {
  const { data } = await admin
    .from("roamly_cron_execution_logs")
    .insert({ cron_name: "roamly-social-autopost", status: "running" })
    .select("id")
    .single();
  return data?.id as string | undefined;
}

async function finishCronLog(
  admin: SupabaseClient,
  id: string | undefined,
  status: "completed" | "failed" | "skipped" | "partial",
  summary: Record<string, unknown>,
  skippedReason?: string
) {
  if (!id) return;
  await admin
    .from("roamly_cron_execution_logs")
    .update({
      status,
      finished_at: new Date().toISOString(),
      due_found: numberValue(summary.dueFound, 0, 0, 1000),
      published_count: numberValue(summary.published, 0, 0, 1000),
      failed_count: numberValue(summary.failed, 0, 0, 1000),
      retry_count: numberValue(summary.retrying, 0, 0, 1000),
      generated_count: numberValue(summary.generated, 0, 0, 1000),
      skipped_reason: skippedReason || null,
      summary
    })
    .eq("id", id);
}

export async function runFacebookAutomationCycle(
  admin: SupabaseClient,
  {
    trigger = "cron",
    force = false,
    limit = 8,
    brand = "roamly",
    queueId
  }: {
    trigger?: "cron" | "admin";
    force?: boolean;
    limit?: number;
    brand?: FacebookSocialBrand;
    queueId?: string;
  } = {}
) {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const cronId = trigger === "cron" ? await createCronLog(admin) : undefined;
  const summary = {
    ok: true,
    status: "processed",
    trigger,
    brand: normalizedBrand,
    forceRequested: force,
    dueFound: 0,
    published: 0,
    failed: 0,
    retrying: 0,
    generated: 0,
    skipped: 0,
    results: [] as Array<Record<string, unknown>>,
    blockingIssues: [] as string[]
  };

  try {
    const { tableReady, settings } = await loadFacebookAutomationSettings(admin, normalizedBrand);
    if (!tableReady) {
      summary.ok = false;
      summary.status = "failed";
      summary.blockingIssues.push("Automation tables are not ready.");
      await finishCronLog(admin, cronId, "failed", summary, summary.blockingIssues[0]);
      return summary;
    }

    await releaseStaleLocks(admin, normalizedBrand);
    const validation = await validateFacebookPageConnection(normalizedBrand);
    const postingConfig = await facebookBrandConfigForPosting(normalizedBrand);
    const postingCredentialsAvailable = Boolean(
      postingConfig.facebookEnabled && postingConfig.pageId && postingConfig.pageAccessToken
    );
    const canPublish =
      postingCredentialsAvailable &&
      !settings.manualReviewRequired &&
      (force || (settings.automationEnabled && !settings.paused));
    if (!canPublish) {
      const reason =
        (!postingCredentialsAvailable
          ? `${postingConfig.label} Facebook posting credentials are missing.`
          : validation.blockingIssues[0]) ||
        (settings.manualReviewRequired ? "Manual review is enabled." : settings.paused ? "Automation is paused." : "Automation is disabled.");
      const refill = await refillFacebookQueue(admin, trigger, normalizedBrand);
      summary.generated = "created" in refill ? refill.created || 0 : 0;
      summary.status = "skipped";
      summary.blockingIssues = !postingCredentialsAvailable ? [reason] : validation.blockingIssues.length ? validation.blockingIssues : [reason];
      await finishCronLog(admin, cronId, "skipped", summary, reason);
      return summary;
    }

    const publishedToday = await countPublishedToday(admin, normalizedBrand, settings.timeZone);
    const dailyLimit =
      normalizedBrand === "roamly"
        ? 1
        : settings.maximumDailyPosts;
    const remainingToday = Math.max(0, dailyLimit - publishedToday);
    if (!remainingToday) {
      const refill = await refillFacebookQueue(admin, trigger, normalizedBrand);
      summary.generated = "created" in refill ? refill.created || 0 : 0;
      summary.status = "skipped";
      summary.blockingIssues.push("Daily publishing limit reached.");
      await finishCronLog(admin, cronId, "skipped", summary, "Daily publishing limit reached.");
      return summary;
    }

    const runLimit =
      normalizedBrand === "roamly" && trigger === "cron" && !force
        ? 1
        : limit;
    // A missed scheduled slot must remain eligible for bounded catch-up.
    // The daily limit and runLimit still cap automatic publishing at one post.
    const notBefore = undefined;
    const due = await getDueQueue(
      admin,
      Math.min(runLimit, remainingToday),
      normalizedBrand,
      { queueId, notBefore: queueId ? undefined : notBefore }
    );
    summary.dueFound = due.length;
    for (const item of due) {
      const lockToken = await lockQueueItem(admin, item);
      if (!lockToken) {
        summary.skipped += 1;
        continue;
      }

      let result: PublishResult;
      try {
        result = await publishQueueItem(admin, item);
      } catch (error) {
        result = {
          ok: false,
          status: "failed",
          temporary: error instanceof FacebookGraphError ? error.temporary : true,
          error: error instanceof Error ? error.message : "Publishing failed.",
          metaResponse: error instanceof FacebookGraphError ? error.responseBody : {}
        };
      }

      if (result.ok && result.publicationTruth === "processing") {
        await saveAttempt(admin, item, "retrying", result, (item.attempt_count || 0) + 1);
        await markPublished(admin, item, result);
        summary.retrying += 1;
        summary.results.push({ queueId: item.id, status: "processing", facebookId: result.facebookMediaId || null });
      } else if (result.ok) {
        await saveAttempt(admin, item, "published", result, (item.attempt_count || 0) + 1);
        await markPublished(admin, item, result);
        summary.published += 1;
        summary.results.push({ queueId: item.id, status: "published", facebookId: result.facebookPostId || result.facebookReelId });
      } else {
        const status = await markFailed(admin, item, result, settings.automaticRetryLimit);
        await saveAttempt(admin, item, status === "retrying" ? "retrying" : "failed", result, (item.attempt_count || 0) + 1);
        if (status === "retrying") summary.retrying += 1;
        else summary.failed += 1;
        summary.results.push({ queueId: item.id, status, error: result.error });
      }
    }

    const refill = await refillFacebookQueue(admin, trigger, normalizedBrand);
    summary.generated = "created" in refill ? refill.created || 0 : 0;
    await finishCronLog(admin, cronId, summary.failed ? "partial" : "completed", summary);
    return summary;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Automation cycle failed.";
    summary.ok = false;
    summary.status = "failed";
    summary.blockingIssues.push(message);
    await finishCronLog(admin, cronId, "failed", summary, message);
    return summary;
  }
}

export async function runFacebookAutomationForAllBrands(
  admin: SupabaseClient,
  options: { trigger?: "cron" | "admin"; force?: boolean; limit?: number } = {}
) {
  const results = [];
  for (const brand of FACEBOOK_BRANDS) {
    results.push(await runFacebookAutomationCycle(admin, { ...options, brand }));
  }

  const published = results.reduce((sum, result) => sum + result.published, 0);
  const failed = results.reduce((sum, result) => sum + result.failed, 0);
  const retrying = results.reduce((sum, result) => sum + result.retrying, 0);
  const generated = results.reduce((sum, result) => sum + result.generated, 0);

  return {
    ok: results.every((result) => result.ok),
    status: failed ? "partial" : "processed",
    brands: Object.fromEntries(results.map((result) => [result.brand, result])),
    published,
    failed,
    retrying,
    generated
  };
}

export async function refillFacebookQueues(admin: SupabaseClient, actorEmail?: string | null) {
  const results = [];
  for (const brand of FACEBOOK_BRANDS) {
    results.push(await refillFacebookQueue(admin, actorEmail, brand));
  }
  return {
    ok: results.every((result) => result.ok),
    brands: Object.fromEntries(results.map((result) => [result.brand, result])),
    created: results.reduce((sum, result) => sum + ("created" in result ? result.created || 0 : 0), 0),
    scheduled: results.reduce((sum, result) => sum + ("scheduled" in result ? result.scheduled || 0 : 0), 0)
  };
}

export async function getFacebookAutomationSummaries(admin: SupabaseClient) {
  const entries = await Promise.all(FACEBOOK_BRANDS.map(async (brand) => [brand, await getFacebookAutomationSummary(admin, brand)] as const));
  return Object.fromEntries(entries);
}

export async function publishNextFacebookPostNow(
  admin: SupabaseClient,
  actorEmail?: string | null,
  brand: FacebookSocialBrand = "roamly"
) {
  console.log("[POST_NOW_DEBUG_START]", {
    at: new Date().toISOString()
  });

  const normalizedBrand = normalizeFacebookBrand(brand);

  let { data, error } = await admin
    .from("roamly_social_queue")
    .select("id,draft_id,draft:roamly_social_drafts!inner(post_format)")
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .eq("queue_status", "scheduled")
    .eq("draft.post_format", "reel")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    return {
      ok: false as const,
      error: error.message
    };
  }

  if (!data) {
    console.log("[POST_NOW_QUEUE_REFILL]", {
      brand: normalizedBrand,
      reason: "No scheduled Reel available",
      count: 100
    });

    const refill = await generateFacebookQueue(admin, {
      count: 100,
      actorEmail: actorEmail || "post_now",
      source: "admin",
      brand: normalizedBrand
    });

    if (!refill.ok || !refill.created) {
      return {
        ok: false as const,
        error: refill.error || "Could not refill the Facebook Reel library."
      };
    }

    console.log("[POST_NOW_QUEUE_REFILLED]", {
      brand: normalizedBrand,
      created: refill.created,
      scheduled: refill.scheduled
    });

    ({ data, error } = await admin
      .from("roamly_social_queue")
      .select("id,draft_id,draft:roamly_social_drafts!inner(post_format)")
      .in("platform", brandQueuePlatforms(normalizedBrand))
      .eq("queue_status", "scheduled")
      .eq("draft.post_format", "reel")
      .order("scheduled_for", { ascending: true })
      .limit(1)
      .maybeSingle());
    if (error) return { ok: false as const, error: error.message };
  }

  if (!data) {
    return {
      ok: false as const,
      error: "No scheduled Facebook Reel is available."
    };
  }

  /*
   * POST NOW must regenerate THIS selected Reel using current music/caption
   * rules instead of reusing an old rendered MP4.
   */
  if (data.draft_id) {
    const { data: draft, error: draftError } = await admin
      .from("roamly_social_drafts")
      .select("id,hashtags,metadata")
      .eq("id", data.draft_id)
      .maybeSingle();

    if (draftError) {
      return { ok: false as const, error: draftError.message };
    }

    if (draft) {
      const metadata =
        draft.metadata &&
        typeof draft.metadata === "object" &&
        !Array.isArray(draft.metadata)
          ? (draft.metadata as Record<string, unknown>)
          : {};

      const libraryMedia =
        metadata.facebookLibraryMedia &&
        typeof metadata.facebookLibraryMedia === "object" &&
        !Array.isArray(metadata.facebookLibraryMedia)
          ? (metadata.facebookLibraryMedia as Record<string, unknown>)
          : {};

      const sourceMediaUrl =
        typeof libraryMedia.sourceMediaUrl === "string"
          ? libraryMedia.sourceMediaUrl.trim()
          : "";

      const sourceMediaAssetId =
        typeof libraryMedia.sourceMediaAssetId === "string"
          ? libraryMedia.sourceMediaAssetId
          : null;

      const existingHashtags = Array.isArray(draft.hashtags)
        ? draft.hashtags.filter(
            (tag): tag is string => typeof tag === "string"
          )
        : [];

      const refreshedHashtags = uniqueHashtags([
        ...existingHashtags,
        "fypシ",
        "fypシ゚viralシ",
        "fypviralシ"
      ]);

      const { error: refreshError } = await admin
        .from("roamly_social_drafts")
        .update({
          // Post now publishes the selected queued Reel as-is. This keeps the
          // button independent from Reel generation when reusable media exists.
          metadata: {
            ...metadata,
            reuseExistingReel: true,
            forceFreshGeneratedReel: false,
            postNowSourceMediaUrl: sourceMediaUrl || null,
            postNowSourceMediaAssetId: sourceMediaAssetId
          },
          hashtags: refreshedHashtags
        })
        .eq("id", data.draft_id);

      if (refreshError) {
        return { ok: false as const, error: refreshError.message };
      }
      }
    }

    /*
   * The normal cycle chooses the oldest due Reel.
   * Give THIS selected queue row a deliberately old unique timestamp so
   * no previously-overdue Reel can jump ahead of it.
   */
  let movedToPrioritySlot = false;
  let moveError: string | null = null;

  const priorityBase = Date.UTC(2000, 0, 1);

  for (let attempt = 0; attempt < 100; attempt += 1) {
    const scheduledFor = new Date(priorityBase + attempt).toISOString();

    const { error: updateError } = await admin
      .from("roamly_social_queue")
      .update({
        scheduled_for: scheduledFor,
        retry_after: null
      })
      .eq("id", data.id);

    if (!updateError) {
      movedToPrioritySlot = true;
      moveError = null;
      break;
    }

    moveError = updateError.message;

    if (updateError.code !== "23505") {
      break;
    }
  }

  if (!movedToPrioritySlot) {
    return {
      ok: false as const,
      error:
        moveError ||
        "Could not move the selected Reel into the Post now priority slot."
    };
  }

  await recordAdminActivity(
    admin,
    actorEmail,
    "facebook_publish_next_now",
    "social_queue",
    data.id,
    "completed",
    { brand: normalizedBrand }
  );

  console.log("[POST_NOW_EXACT_QUEUE]", {
    queueId: data.id,
    draftId: data.draft_id
  });

  const selectedQueueId = data.id;

  // POST NOW DIRECT EXACT PUBLISH
  // Publish the exact queue row already selected above.
  // Never ask the generic scheduler to choose another due Reel.
  const { data: exactQueueRow, error: exactQueueError } = await admin
    .from("roamly_social_queue")
    .select(
      "*,draft:roamly_social_drafts!inner(id,content_type,post_format,topic,hook,caption,on_screen_text,media_direction,suggested_media,selected_media_asset_id,selected_media_url,call_to_action,hashtags,music_or_audio_mood,roamly_link,amazon_affiliate_link,affiliate_disclosure,generation_source,status,quality_score,quality_reasons,metadata,created_at,updated_at)"
    )
    .eq("id", selectedQueueId)
    .eq("draft.post_format", "reel")
    .maybeSingle();

  if (exactQueueError || !exactQueueRow) {
    return {
      ok: false as const,
      error:
        exactQueueError?.message ||
        "Selected Facebook Reel could not be reloaded."
    };
  }

  const exactItem = exactQueueRow as unknown as QueueWithDraft;

  console.log("[POST_NOW_DIRECT_SELECTED]", {
    queueId: exactItem.id,
    draftId: exactItem.draft_id,
    hashtags: exactItem.draft?.hashtags || [],
    selectedMediaUrl: exactItem.draft?.selected_media_url || null
  });

  const lockToken = await lockQueueItem(admin, exactItem);

  if (!lockToken) {
    return {
      ok: false as const,
      error: "The selected Facebook Reel could not be locked for publishing."
    };
  }

  let publishResult: PublishResult;

  try {
    publishResult = await publishQueueItem(admin, exactItem);
  } catch (error) {
    publishResult = {
      ok: false,
      status: "failed",
      temporary: false,
      error:
        error instanceof Error
          ? error.message
          : "Facebook Reel publishing failed."
    };
  }

  console.log("[POST_NOW_DIRECT_RESULT]", {
    queueId: exactItem.id,
    ok: publishResult.ok,
    status: publishResult.status,
    error: publishResult.ok ? null : publishResult.error
  });

  if (publishResult.ok) {
    await markPublished(admin, exactItem, publishResult);

    return {
      ok: true as const,
      queueId: exactItem.id,
      result: publishResult
    };
  }

  await admin
    .from("roamly_social_queue")
    .update({
      queue_status: "failed",
      permanent_failure: true,
      last_error: publishResult.error || "Publishing failed.",
      processing_finished_at: new Date().toISOString(),
      processing_locked_at: null,
      processing_lock_token: null
    })
    .eq("id", exactItem.id);

  await admin
    .from("roamly_social_drafts")
    .update({
      status: "failed"
    })
    .eq("id", exactItem.draft_id);

  return {
    ok: false as const,
    queueId: exactItem.id,
    error: publishResult.error || "Facebook Reel publishing failed.",
    result: publishResult
  };
}


export async function retryFailedFacebookPosts(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);

  const { data: candidates, error: selectError } = await admin
    .from("roamly_social_queue")
    .select("id")
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .in("queue_status", ["failed", "retrying"])
    .order("updated_at", { ascending: true });

  if (selectError) {
    return { ok: false as const, error: selectError.message };
  }

  if (!candidates?.length) {
    return {
      ok: false as const,
      error: "No failed Facebook posts are available to retry."
    };
  }

  const retriedIds: string[] = [];
  const baseTime = Date.now() - 1000;

  for (let rowIndex = 0; rowIndex < candidates.length; rowIndex += 1) {
    const item = candidates[rowIndex];
    let moved = false;
    let lastError: string | null = null;

    for (let attempt = 0; attempt < 100; attempt += 1) {
      /*
       * scheduled_for has a partial UNIQUE constraint, so every manually
       * retried item must receive its own immediate timestamp.
       */
      const scheduledFor = new Date(
        baseTime - (rowIndex * 1000) - attempt
      ).toISOString();

      const { error: updateError } = await admin
        .from("roamly_social_queue")
        .update({
          queue_status: "scheduled",
          retry_after: null,
          scheduled_for: scheduledFor,
          permanent_failure: false,
          processing_lock_token: null,
          processing_locked_at: null
        })
        .eq("id", item.id);

      if (!updateError) {
        moved = true;
        retriedIds.push(item.id);
        break;
      }

      lastError = updateError.message;

      if (updateError.code !== "23505") {
        break;
      }
    }

    if (!moved && lastError) {
      console.error("[Roamly Facebook] Could not requeue failed post", {
        queueId: item.id,
        error: lastError
      });
    }
  }

  if (!retriedIds.length) {
    return {
      ok: false as const,
      error: "Failed Facebook posts could not be moved back into the publishing queue."
    };
  }

  await recordAdminActivity(
    admin,
    actorEmail,
    "facebook_retry_failures",
    "social_queue",
    undefined,
    "completed",
    {
      brand: normalizedBrand,
      count: retriedIds.length
    }
  );

  /*
   * Admin Retry means retry now. Do not make the user wait for cron.
   */
  const result = await runFacebookAutomationCycle(admin, {
    trigger: "admin",
    force: true,
    limit: retriedIds.length,
    brand: normalizedBrand
  });

  return {
    ok: result.ok,
    brand: normalizedBrand,
    retried: retriedIds.length,
    result
  };
}

export async function skipNextFacebookPost(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const { data, error } = await admin
    .from("roamly_social_queue")
    .select("id")
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .in("queue_status", ["scheduled", "retrying"])
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: error?.message || "No scheduled post is available." };
  await Promise.all([
    admin.from("roamly_social_queue").update({ queue_status: "skipped" }).eq("id", data.id),
    admin.from("roamly_scheduled_posts").update({ status: "skipped" }).eq("queue_id", data.id),
    admin.from("roamly_publishing_jobs").update({ job_status: "skipped" }).eq("queue_id", data.id)
  ]);
  await recordAdminActivity(admin, actorEmail, "facebook_skip_next", "social_queue", data.id, "completed", { brand: normalizedBrand });
  return { ok: true as const, brand: normalizedBrand, skippedId: data.id as string };
}

export async function clearFailedFacebookJobs(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const { data, error } = await admin
    .from("roamly_social_queue")
    .update({ queue_status: "archived" })
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .eq("queue_status", "failed")
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  await admin
    .from("roamly_failed_jobs")
    .update({ resolved_at: new Date().toISOString() })
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .is("resolved_at", null);
  await recordAdminActivity(admin, actorEmail, "facebook_clear_failed_jobs", "social_queue", undefined, "completed", {
    brand: normalizedBrand,
    count: data?.length || 0
  });
  return { ok: true as const, brand: normalizedBrand, cleared: data?.length || 0 };
}

async function queryQueueWithDraft(
  admin: SupabaseClient,
  status: string[],
  options: { limit?: number; from?: string; to?: string; format?: FacebookPostFormat; brand?: FacebookSocialBrand } = {}
) {
  const brand = normalizeFacebookBrand(options.brand);
  let query = admin
    .from("roamly_social_queue")
    .select(
      "*,draft:roamly_social_drafts(id,content_type,post_format,topic,hook,caption,on_screen_text,media_direction,suggested_media,selected_media_asset_id,selected_media_url,call_to_action,hashtags,music_or_audio_mood,roamly_link,amazon_affiliate_link,affiliate_disclosure,generation_source,status,quality_score,quality_reasons,metadata,created_at,updated_at)"
    )
    .in("queue_status", status)
    .in("platform", brandQueuePlatforms(brand))
    .order("scheduled_for", { ascending: true })
    .limit(options.limit || 20);
  if (options.from) query = query.gte("scheduled_for", options.from);
  if (options.to) query = query.lte("scheduled_for", options.to);
  const { data, error } = await query;
  if (error) return [];
  const rows = ((data || []) as unknown as QueueWithDraft[]).filter((item) => item.draft);
  return options.format ? rows.filter((item) => item.draft.post_format === options.format) : rows;
}

export async function getFacebookAutomationSummary(
  admin: SupabaseClient,
  brand: FacebookSocialBrand = "roamly"
): Promise<FacebookAutomationSummary> {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const config = facebookBrandConfig(normalizedBrand);
  const { tableReady, settings } = await loadFacebookAutomationSettings(admin, normalizedBrand);
  const canonicalConnection =
    normalizedBrand === "roamly"
      ? await getRoamlyFacebookConnectionStatus().catch(() => null)
      : null;
  const social =
    normalizedBrand === "roamly"
      ? {
          ...getRoamlySocialEnvStatus(),
          facebookConnected: Boolean(canonicalConnection?.connected),
          pageIdConfigured: Boolean(canonicalConnection?.pageId || config.pageId),
          tokenConfigured: Boolean(canonicalConnection?.canonicalTokenStored),
          facebookStatusLabel: canonicalConnection?.connected
            ? "Facebook connected through OAuth"
            : canonicalConnection?.envFallbackConfigured
              ? "Facebook OAuth connection missing; env fallback configured"
              : "Facebook not connected",
          credentialSource: canonicalConnection?.source || ("missing" as const),
          canonicalConnection: canonicalConnection || undefined
        }
      : {
          autoPostEnabled: config.autoPostEnabled,
          requireApproval: config.requireApproval,
          cronSecretConfigured: Boolean(clean(process.env.ROAMLY_SOCIAL_CRON_SECRET || process.env.SOCIAL_CRON_SECRET || process.env.CRON_SECRET)),
          facebookEnabled: config.facebookEnabled,
          instagramEnabled: false,
          facebookConnected: Boolean(config.facebookEnabled && config.pageId && config.pageAccessToken),
          instagramConnected: false,
          pageIdConfigured: Boolean(config.pageId),
          tokenConfigured: Boolean(config.pageAccessToken),
          instagramAccountConfigured: false,
          facebookStatusLabel:
            config.facebookEnabled && config.pageId && config.pageAccessToken
              ? `${config.label} Facebook connected`
              : `${config.label} Facebook not connected`,
          instagramStatusLabel: "Instagram not connected"
        };
  const validation = await validateFacebookPageConnection(normalizedBrand);
  const now = new Date();
  const { start: todayStart, end: todayEnd } = dayBoundsInTimeZone(settings.timeZone, now);
  const { end: weekEnd } = dayBoundsInTimeZone(settings.timeZone, now, 7);

  if (!tableReady) {
    return {
      tableReady,
      settings,
      env: {
        ...social,
        pageName: validation.pageName,
        pageId: validation.pageId,
        permissions: validation.permissions,
        publishingReady: false,
        blockingIssues: ["Run the Facebook automation migration."]
      },
      counts: { queueSize: 0, scheduled: 0, published: 0, failed: 0, retrying: 0, drafts: 0, mediaAssets: 0 },
      nextPost: null,
      nextReel: null,
      todaySchedule: [],
      weekSchedule: [],
      recentActivity: [],
      lastCron: null,
      nextAutomationRun: nextAutomationRun()
    };
  }

  const [
    queueSize,
    scheduled,
    published,
    failed,
    retrying,
    drafts,
    mediaAssets,
    nextPosts,
    nextReels,
    todaySchedule,
    weekSchedule,
    recentActivity,
    lastCron
  ] = await Promise.all([
    admin.from("roamly_social_queue").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)).in("queue_status", ["scheduled", "retrying"]).gte("scheduled_for", now.toISOString()),
    admin.from("roamly_social_queue").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)).eq("queue_status", "scheduled"),
    admin.from("roamly_social_queue").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)).eq("queue_status", "published"),
    admin.from("roamly_social_queue").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)).eq("queue_status", "failed"),
    admin.from("roamly_social_queue").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)).eq("queue_status", "retrying"),
    admin.from("roamly_social_drafts").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)),
    admin.from("roamly_social_media_assets").select("id", { count: "exact", head: true }).in("platform", brandQueuePlatforms(normalizedBrand)),
    queryQueueWithDraft(admin, ["scheduled", "retrying"], { limit: 1, from: now.toISOString(), brand: normalizedBrand }),
    queryQueueWithDraft(admin, ["scheduled", "retrying"], { limit: 5, from: now.toISOString(), format: "reel", brand: normalizedBrand }),
    queryQueueWithDraft(admin, ["scheduled", "retrying"], { limit: 12, from: todayStart.toISOString(), to: todayEnd.toISOString(), brand: normalizedBrand }),
    queryQueueWithDraft(admin, ["scheduled", "retrying"], { limit: 40, from: todayStart.toISOString(), to: weekEnd.toISOString(), brand: normalizedBrand }),
    queryQueueWithDraft(admin, ["published", "failed", "retrying", "skipped"], { limit: 8, brand: normalizedBrand }),
    admin
      .from("roamly_cron_execution_logs")
      .select("*")
      .eq("cron_name", "roamly-social-autopost")
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const blockingIssues = [...validation.blockingIssues];
  if (!settings.automationEnabled) blockingIssues.push("Automation is disabled in settings.");
  if (settings.paused) blockingIssues.push("Automation is paused.");
  if (settings.manualReviewRequired) blockingIssues.push("Manual review is enabled.");

  return {
    tableReady,
    settings,
    env: {
      ...social,
      pageName: validation.pageName,
      pageId: validation.pageId,
      permissions: validation.permissions,
      publishingReady: validation.ok && settings.automationEnabled && !settings.paused && !settings.manualReviewRequired,
      blockingIssues
    },
    counts: {
      queueSize: queueSize.count || 0,
      scheduled: scheduled.count || 0,
      published: published.count || 0,
      failed: failed.count || 0,
      retrying: retrying.count || 0,
      drafts: drafts.count || 0,
      mediaAssets: mediaAssets.count || 0
    },
    nextPost: nextPosts[0] || null,
    nextReel: nextReels[0] || null,
    todaySchedule,
    weekSchedule,
    recentActivity,
    lastCron: (lastCron.data as CronLogRow | null) || null,
    nextAutomationRun: nextAutomationRun()
  };
}

function nextAutomationRun() {
  const now = new Date();
  const next = new Date(now);
  const minutes = now.getMinutes();
  const nextMinute = minutes < 30 ? 30 : 60;
  next.setMinutes(nextMinute, 0, 0);
  if (nextMinute === 60) next.setHours(now.getHours() + 1, 0, 0, 0);
  return next.toISOString();
}

export function publicDraftPreview(draft: SocialDraftRow) {
  return {
    id: draft.id,
    contentType: draft.content_type,
    postFormat: draft.post_format,
    hook: draft.hook,
    caption: draft.caption,
    onScreenText: draft.on_screen_text || "",
    mediaDirection: draft.media_direction || "",
    selectedMediaUrl: draft.selected_media_url || "",
    cta: draft.call_to_action || "",
    hashtags: Array.isArray(draft.hashtags) ? draft.hashtags : [],
    audioMood: draft.music_or_audio_mood || "",
    roamlyLink: draft.roamly_link || "",
    amazonAffiliateLink: draft.amazon_affiliate_link || "",
    affiliateDisclosure: draft.affiliate_disclosure || "",
    generationSource: draft.generation_source,
    status: draft.status,
    qualityScore: draft.quality_score,
    qualityReasons: Array.isArray(draft.quality_reasons) ? draft.quality_reasons : []
  };
}
