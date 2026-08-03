import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAmazonSearchUrl, getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { ROAMLY_AFFILIATE_DISCLOSURE, ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";
import { getRoamlySocialEnvStatus, isSocialTableMissingError } from "@/lib/roamly/social";
import { probeFacebookAccessibleUrl } from "@/lib/roamly/publicSocialStorage";
import { generateFreshSocialReelVideo, type SocialReelBrand } from "@/lib/roamly/socialReelGenerator";

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
  facebookPostId?: string | null;
  facebookReelId?: string | null;
  facebookMediaId?: string | null;
  facebookUrl?: string | null;
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

const FACEBOOK_AUTOMATION_CATEGORIES = [
  "Facebook Reels",
  "Travel statement posts",
  "Image posts",
  "Travel tips",
  "Travel questions",
  "Destination inspiration",
  "Budget-travel advice",
  "Road-trip content",
  "Packing tips",
  "Safety tips",
  "Weekend-trip ideas",
  "Solo-travel content",
  "Group-travel ideas",
  "Travel mistakes",
  "Travel quotes",
  "Product recommendations",
  "Affiliate product posts",
  "Roamly feature promotions",
  "Website traffic posts",
  "Conversation starters",
  "Engagement posts"
];

const TOPIC_ROTATION = [
  "weekend escapes",
  "carry-on packing",
  "road-trip stops",
  "solo travel confidence",
  "group trip planning",
  "budget boundaries",
  "safe arrival routines",
  "multi-city pacing",
  "weather backup plans",
  "airport transfer planning",
  "day-one itinerary checks",
  "local food discovery",
  "travel document checks",
  "hidden trip costs",
  "lightweight tech essentials",
  "family travel pacing",
  "spontaneous detours",
  "off-season travel",
  "short-haul getaways",
  "booking organization"
];

const DESTINATION_ROTATION = [
  "Lisbon",
  "Vancouver",
  "Tokyo",
  "Barcelona",
  "New York",
  "Banff",
  "Seoul",
  "Mexico City",
  "Paris",
  "San Diego",
  "Montreal",
  "Chicago",
  "Rome",
  "Reykjavik",
  "Quebec City",
  "London",
  "Oaxaca",
  "Costa Rica",
  "Amsterdam",
  "Cape Town"
];

const CTA_ROTATION = [
  "Plan your next trip with Roamly",
  "Explore more on Roamly",
  "Start planning your trip",
  "Discover your next destination",
  "Build your travel plan"
];

const AUDIO_MOODS = [
  "bright acoustic travel montage",
  "soft upbeat city-pop",
  "calm scenic lo-fi",
  "light road-trip indie",
  "warm cinematic travel bed",
  "gentle beach-day rhythm"
];

const HASHTAG_GROUPS = [
  ["Roamly", "TravelPlanning", "SmartTravel", "TravelTips", "TripPlanning"],
  ["Roamly", "BudgetTravel", "WeekendTrip", "TravelIdeas", "TravelBetter"],
  ["Roamly", "RoadTrip", "PackingTips", "TravelChecklist", "TravelHacks"],
  ["Roamly", "SoloTravel", "GroupTravel", "DestinationIdeas", "TravelCommunity"],
  ["Roamly", "TravelSafety", "CarryOnOnly", "TravelEssentials", "PlanSmarter"]
];

const REVIEWINTEL_AUTOMATION_CATEGORIES = [
  "Facebook Reels",
  "Shopper tips",
  "Fake review warning",
  "Seller tips",
  "Buyer mistakes",
  "Competitor review watch",
  "Trust signals",
  "Product research",
  "Affiliate buying checklist",
  "Website traffic posts"
];

const REVIEWINTEL_TOPIC_ROTATION = [
  "fake-review signals",
  "buyer complaint patterns",
  "star-rating traps",
  "product-page trust checks",
  "seller review intelligence",
  "competitor review gaps",
  "return-policy checks",
  "before-checkout research",
  "review authenticity clues",
  "smart shopping decisions"
];

const REVIEWINTEL_CTA_ROTATION = [
  "Scan before you buy",
  "Check the product on ReviewIntel",
  "Use ReviewIntel before checkout",
  "Find the review pattern first",
  "Turn reviews into a decision"
];

const REVIEWINTEL_HASHTAG_GROUPS = [
  ["ReviewIntel", "SmartShopping", "ReviewAnalysis", "FakeReviews", "BuySmarter"],
  ["ReviewIntel", "ProductResearch", "OnlineShopping", "TrustSignals", "ConsumerTips"],
  ["ReviewIntel", "EcommerceSellers", "ReviewMining", "ProductFeedback", "SellerTools"],
  ["ReviewIntel", "ShoppingTips", "ReviewQuality", "BeforeYouBuy", "ProductChecks"]
];

const FACEBOOK_BRANDS = ["roamly", "reviewintel"] as const satisfies FacebookSocialBrand[];
const LEGACY_FACEBOOK_PLATFORM = "facebook";

function clean(value?: string | null) {
  return (value || "").trim();
}

function numberValue(value: unknown, fallback: number, min: number, max: number) {
  const parsed = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function stringArray(value: unknown, fallback: string[] = []) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(clean).filter(Boolean) : fallback;
}

function numberArray(value: unknown, fallback: number[]) {
  if (!Array.isArray(value)) return fallback;
  const values = value
    .map((item) => numberValue(item, Number.NaN, 0, 23))
    .filter((item) => Number.isFinite(item));
  return values.length ? [...new Set(values)] : fallback;
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function hash(value: string) {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

function slug(value: string) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function envFirst(...names: string[]) {
  for (const name of names) {
    const value = cleanEnvValue(process.env[name]);
    if (value) return value;
  }
  return "";
}

function cleanEnvValue(value?: string | null) {
  const text = clean(value);
  if (!text) return "";
  if (/^\[(sensitive|redacted|secret|token|private)\]$/i.test(text)) return "";
  if (/^(changeme|change_me|your[_-]?token|your[_-]?secret|placeholder)$/i.test(text)) return "";
  return text;
}

function envFlag(...names: string[]) {
  for (const name of names) {
    const raw = process.env[name];
    if (typeof raw !== "string") continue;
    const value = raw.trim().toLowerCase();
    if (["1", "true", "yes", "on", "enabled"].includes(value)) return true;
    if (["0", "false", "no", "off", "disabled"].includes(value)) return false;
  }
  return null;
}

function normalizeFacebookBrand(value: unknown): FacebookSocialBrand {
  const raw = clean(typeof value === "string" ? value : "").toLowerCase().replace(/[^a-z0-9]/g, "");
  if (raw === "reviewintel" || raw === "reviewinsight") return "reviewintel";
  return "roamly";
}

function brandPlatform(brand: FacebookSocialBrand) {
  return brand === "roamly" ? "facebook_roamly" : "facebook_reviewintel";
}

function brandQueuePlatforms(brand: FacebookSocialBrand) {
  return brand === "roamly" ? [LEGACY_FACEBOOK_PLATFORM, brandPlatform(brand)] : [brandPlatform(brand)];
}

function brandSettingsId(brand: FacebookSocialBrand) {
  return brand === "roamly" ? "facebook" : "facebook_reviewintel";
}

function metadataBrand(metadata: Record<string, unknown> | null | undefined) {
  return normalizeFacebookBrand(metadata?.brand || metadata?.social_brand || metadata?.facebookBrand);
}

function brandFromQueueItem(item: Pick<QueueWithDraft, "platform" | "metadata" | "draft">): FacebookSocialBrand {
  if (item.platform === "facebook_reviewintel") return "reviewintel";
  if (item.platform === "facebook_roamly") return "roamly";
  const queueBrand = metadataBrand(item.metadata);
  if (queueBrand !== "roamly") return queueBrand;
  return metadataBrand(item.draft?.metadata);
}

function withBrandMetadata(brand: FacebookSocialBrand, metadata: Record<string, unknown> = {}) {
  return { ...metadata, brand };
}

function cleanPublicUrl(value: string, fallback: string) {
  const candidate = clean(value || fallback).replace(/\/$/, "");
  if (!candidate) return fallback;
  if (/^https?:\/\//i.test(candidate)) return candidate;
  return `https://${candidate}`;
}

function normalizeGraphVersion(value: string) {
  const version = clean(value) || "v23.0";
  return version.startsWith("v") ? version : `v${version}`;
}

type FacebookBrandConfig = {
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
};

function facebookBrandConfig(brandInput: FacebookSocialBrand = "roamly"): FacebookBrandConfig {
  const brand = normalizeFacebookBrand(brandInput);
  const graph = envFirst(
    brand === "reviewintel" ? "REVIEWINTEL_META_GRAPH_VERSION" : "ROAMLY_META_GRAPH_VERSION",
    brand === "reviewintel" ? "REVIEWINTEL_FACEBOOK_GRAPH_API_VERSION" : "ROAMLY_FACEBOOK_GRAPH_API_VERSION",
    brand === "reviewintel" ? "FACEBOOK_GRAPH_API_VERSION" : "",
    brand === "reviewintel" ? "META_GRAPH_API_VERSION" : "",
    "ROAMLY_META_GRAPH_VERSION"
  );

  if (brand === "reviewintel") {
    const pageIdValue = envFirst(
      "REVIEWINTEL_META_PAGE_ID",
      "REVIEWINTEL_FACEBOOK_PAGE_ID",
      "REVIEWINTEL_META_FACEBOOK_PAGE_ID",
      "FACEBOOK_PAGE_ID",
      "META_PAGE_ID",
      "META_FACEBOOK_PAGE_ID"
    );
    const pageAccessTokenValue = envFirst(
      "REVIEWINTEL_META_ACCESS_TOKEN",
      "REVIEWINTEL_META_PAGE_ACCESS_TOKEN",
      "REVIEWINTEL_FACEBOOK_PAGE_ACCESS_TOKEN",
      "FACEBOOK_PAGE_ACCESS_TOKEN",
      "META_PAGE_ACCESS_TOKEN",
      "META_FACEBOOK_PAGE_ACCESS_TOKEN"
    );
    const facebookEnabled =
      envFlag("REVIEWINTEL_SOCIAL_FACEBOOK_ENABLED", "REVIEWINTEL_SOCIAL_AUTOPOST_ENABLED", "FACEBOOK_AUTOPOST_ENABLED") ??
      Boolean(pageIdValue && pageAccessTokenValue);
    const autoPostEnabled =
      envFlag("REVIEWINTEL_SOCIAL_AUTOPOST_ENABLED", "SOCIAL_AUTOPOST_ENABLED", "FACEBOOK_AUTOPOST_ENABLED") ??
      Boolean(pageIdValue && pageAccessTokenValue);
    const publicSiteUrl = cleanPublicUrl(
      envFirst("REVIEWINTEL_START_URL", "REVIEWINTEL_SITE_URL", "REVIEWINTEL_PUBLIC_URL", "NEXT_PUBLIC_REVIEWINTEL_URL"),
      "https://getreviewintel.com"
    );

    return {
      brand,
      label: "ReviewIntel",
      platform: brandPlatform(brand),
      pageId: pageIdValue,
      pageAccessToken: pageAccessTokenValue,
      graphVersion: normalizeGraphVersion(graph),
      facebookEnabled,
      autoPostEnabled,
      requireApproval: envFlag("REVIEWINTEL_SOCIAL_REQUIRE_APPROVAL", "SOCIAL_REQUIRE_APPROVAL") ?? false,
      publicSiteUrl,
      primaryLink: `${publicSiteUrl}/?utm_source=facebook&utm_medium=organic_social&utm_campaign=autopost`,
      affiliateUrl: envFirst("REVIEWINTEL_SOCIAL_AFFILIATE_URL", "SOCIAL_AFFILIATE_URL", "FACEBOOK_AFFILIATE_URL"),
      affiliateDisclosure:
        envFirst("REVIEWINTEL_SOCIAL_AFFILIATE_DISCLOSURE", "SOCIAL_AFFILIATE_DISCLOSURE", "FACEBOOK_AFFILIATE_DISCLOSURE") ||
        "Affiliate disclosure: we may earn from qualifying links."
    };
  }

  const social = getRoamlySocialEnvStatus();
  const publicSiteUrl = cleanPublicUrl(envFirst("ROAMLY_PUBLIC_URL", "NEXT_PUBLIC_APP_URL", "NEXT_PUBLIC_SITE_URL"), ROAMLY_PUBLIC_DOMAIN);
  return {
    brand,
    label: "Roamly",
    platform: brandPlatform(brand),
    pageId: envFirst("ROAMLY_META_PAGE_ID"),
    pageAccessToken: envFirst("ROAMLY_META_ACCESS_TOKEN"),
    graphVersion: normalizeGraphVersion(graph),
    facebookEnabled: social.facebookEnabled,
    autoPostEnabled: social.autoPostEnabled,
    requireApproval: social.requireApproval,
    publicSiteUrl,
    primaryLink: `${publicSiteUrl}/plan?utm_source=facebook&utm_medium=organic_social&utm_campaign=autopost`,
    affiliateUrl: "",
    affiliateDisclosure: ROAMLY_AFFILIATE_DISCLOSURE
  };
}

function uniqueHashtags(values: string[]) {
  return [...new Set(values.map((tag) => tag.replace(/^#/, "").replace(/[^A-Za-z0-9_]/g, "")).filter(Boolean))].slice(0, 8);
}

function appBaseUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "") ||
    process.env.NEXT_PUBLIC_SITE_URL?.trim().replace(/\/$/, "") ||
    ROAMLY_PUBLIC_DOMAIN
  );
}

export function getDefaultFacebookAutomationSettings(brand: FacebookSocialBrand = "roamly"): FacebookAutomationSettings {
  const config = facebookBrandConfig(brand);
  const isReviewIntel = config.brand === "reviewintel";
  return {
    automationEnabled: config.autoPostEnabled,
    paused: !config.autoPostEnabled,
    manualReviewRequired: config.requireApproval,
    postsPerDay: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_POSTS_PER_DAY" : "ROAMLY_SOCIAL_POSTS_PER_DAY"),
      isReviewIntel ? 1 : 2,
      0,
      12
    ),
    reelsPerWeek: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_REELS_PER_WEEK" : "ROAMLY_SOCIAL_REELS_PER_WEEK"),
      isReviewIntel ? 7 : 3,
      0,
      21
    ),
    preferredPostingHours: [9, 12, 18],
    timeZone: clean(process.env.ROAMLY_TIME_ZONE) || clean(process.env.TZ) || "America/Moncton",
    minimumQueueSize: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_MIN_QUEUE_SIZE" : "ROAMLY_SOCIAL_MIN_QUEUE_SIZE"),
      isReviewIntel ? 10 : 30,
      0,
      500
    ),
    maximumQueueSize: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_MAX_QUEUE_SIZE" : "ROAMLY_SOCIAL_MAX_QUEUE_SIZE"),
      isReviewIntel ? 40 : 100,
      1,
      1000
    ),
    maximumDailyPosts: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_MAX_DAILY_POSTS" : "ROAMLY_SOCIAL_MAX_DAILY_POSTS"),
      isReviewIntel ? 1 : 3,
      0,
      24
    ),
    contentCategories: isReviewIntel ? REVIEWINTEL_AUTOMATION_CATEGORIES : FACEBOOK_AUTOMATION_CATEGORIES,
    categoryPercentages: {},
    affiliatePostFrequency: 12,
    promotionalPostFrequency: 15,
    websiteLinkFrequency: 80,
    statementPostFrequency: 20,
    automaticRetryLimit: 3,
    media: {
      maximumUsesPerAsset: 5,
      minimumDaysBeforeReuse: 14,
      preferNewestUploads: true,
      allowGeneratedVisuals: true,
      allowStatementGraphics: true,
      allowStockFallbackMedia: false
    }
  };
}

export async function loadFacebookAutomationSettings(
  admin: SupabaseClient,
  brand: FacebookSocialBrand = "roamly"
): Promise<{
  tableReady: boolean;
  settings: FacebookAutomationSettings;
}> {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const defaults = getDefaultFacebookAutomationSettings(normalizedBrand);
  const { data, error } = await admin
    .from("roamly_social_automation_settings")
    .select("*")
    .eq("id", brandSettingsId(normalizedBrand))
    .maybeSingle();

  if (error) {
    if (isSocialTableMissingError(error)) return { tableReady: false, settings: defaults };
    return { tableReady: true, settings: defaults };
  }

  if (!data) return { tableReady: true, settings: defaults };

  const mediaSettings = objectValue(data.media_settings);
  return {
    tableReady: true,
    settings: {
      automationEnabled: Boolean(data.automation_enabled),
      paused: Boolean(data.paused),
      manualReviewRequired: Boolean(data.manual_review_required),
      postsPerDay: numberValue(data.posts_per_day, defaults.postsPerDay, 0, 12),
      reelsPerWeek: numberValue(data.reels_per_week, defaults.reelsPerWeek, 0, 21),
      preferredPostingHours: numberArray(data.preferred_posting_hours, defaults.preferredPostingHours),
      timeZone: clean(data.time_zone) || defaults.timeZone,
      minimumQueueSize: numberValue(data.minimum_queue_size, defaults.minimumQueueSize, 0, 500),
      maximumQueueSize: numberValue(data.maximum_queue_size, defaults.maximumQueueSize, 1, 1000),
      maximumDailyPosts: numberValue(data.maximum_daily_posts, defaults.maximumDailyPosts, 0, 24),
      contentCategories: stringArray(data.content_categories, defaults.contentCategories),
      categoryPercentages: objectValue(data.category_percentages) as Record<string, number>,
      affiliatePostFrequency: numberValue(data.affiliate_post_frequency, defaults.affiliatePostFrequency, 0, 100),
      promotionalPostFrequency: numberValue(data.promotional_post_frequency, defaults.promotionalPostFrequency, 0, 100),
      websiteLinkFrequency: numberValue(data.website_link_frequency, defaults.websiteLinkFrequency, 0, 100),
      statementPostFrequency: numberValue(data.statement_post_frequency, defaults.statementPostFrequency, 0, 100),
      automaticRetryLimit: numberValue(data.automatic_retry_limit, defaults.automaticRetryLimit, 0, 10),
      media: {
        maximumUsesPerAsset: numberValue(mediaSettings.maximumUsesPerAsset, defaults.media.maximumUsesPerAsset, 0, 100),
        minimumDaysBeforeReuse: numberValue(mediaSettings.minimumDaysBeforeReuse, defaults.media.minimumDaysBeforeReuse, 0, 365),
        preferNewestUploads: typeof mediaSettings.preferNewestUploads === "boolean" ? mediaSettings.preferNewestUploads : defaults.media.preferNewestUploads,
        allowGeneratedVisuals: typeof mediaSettings.allowGeneratedVisuals === "boolean" ? mediaSettings.allowGeneratedVisuals : defaults.media.allowGeneratedVisuals,
        allowStatementGraphics: typeof mediaSettings.allowStatementGraphics === "boolean" ? mediaSettings.allowStatementGraphics : defaults.media.allowStatementGraphics,
        allowStockFallbackMedia: typeof mediaSettings.allowStockFallbackMedia === "boolean" ? mediaSettings.allowStockFallbackMedia : defaults.media.allowStockFallbackMedia
      }
    }
  };
}

export async function saveFacebookAutomationSettings(
  admin: SupabaseClient,
  settings: Partial<FacebookAutomationSettings>,
  actorEmail?: string | null,
  brand: FacebookSocialBrand = "roamly"
) {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const current = await loadFacebookAutomationSettings(admin, normalizedBrand);
  const merged: FacebookAutomationSettings = {
    ...current.settings,
    ...settings,
    media: {
      ...current.settings.media,
      ...(settings.media || {})
    }
  };
  const payload = {
    id: brandSettingsId(normalizedBrand),
    automation_enabled: merged.automationEnabled,
    paused: merged.paused,
    manual_review_required: merged.manualReviewRequired,
    posts_per_day: merged.postsPerDay,
    reels_per_week: merged.reelsPerWeek,
    preferred_posting_hours: merged.preferredPostingHours,
    time_zone: merged.timeZone,
    minimum_queue_size: merged.minimumQueueSize,
    maximum_queue_size: merged.maximumQueueSize,
    maximum_daily_posts: merged.maximumDailyPosts,
    affiliate_post_frequency: merged.affiliatePostFrequency,
    promotional_post_frequency: merged.promotionalPostFrequency,
    website_link_frequency: merged.websiteLinkFrequency,
    statement_post_frequency: merged.statementPostFrequency,
    automatic_retry_limit: merged.automaticRetryLimit,
    content_categories: merged.contentCategories,
    category_percentages: merged.categoryPercentages,
    media_settings: merged.media,
    settings: {},
    updated_by: actorEmail || null
  };

  const { error } = await admin.from("roamly_social_automation_settings").upsert(payload, { onConflict: "id" });
  if (error) return { ok: false as const, error };
  await recordAdminActivity(admin, actorEmail, "facebook_settings_updated", "social_automation", normalizedBrand, "completed", {
    brand: normalizedBrand,
    automationEnabled: merged.automationEnabled,
    paused: merged.paused
  });
  return { ok: true as const, settings: merged };
}

async function recordAdminActivity(
  admin: SupabaseClient,
  actorEmail: string | null | undefined,
  action: string,
  targetType?: string,
  targetId?: string,
  status = "completed",
  metadata: Record<string, unknown> = {}
) {
  const { error } = await admin.from("roamly_admin_activity_logs").insert({
    actor_email: actorEmail || null,
    action,
    target_type: targetType || null,
    target_id: targetId || null,
    status,
    metadata
  });
  if (error && !isSocialTableMissingError(error)) {
    console.error("[Roamly admin activity] insert failed", error.message);
  }
}

export async function isAutomationActionRateLimited(admin: SupabaseClient, actorEmail: string | null | undefined, action: string) {
  const since = new Date(Date.now() - 10 * 60_000).toISOString();
  const { count, error } = await admin
    .from("roamly_admin_activity_logs")
    .select("id", { count: "exact", head: true })
    .eq("actor_email", actorEmail || "")
    .eq("action", action)
    .gte("created_at", since);
  if (error) return false;
  return (count || 0) >= 4;
}

function determineFormat(): FacebookPostFormat {
  return "reel";
}

function categoryForIndex(settings: FacebookAutomationSettings, index: number) {
  const categories = settings.contentCategories.length ? settings.contentCategories : FACEBOOK_AUTOMATION_CATEGORIES;
  return categories[index % categories.length];
}

function shouldUseAffiliate(settings: FacebookAutomationSettings, category: string, index: number, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") {
    const configured = Boolean(clean(facebookBrandConfig("reviewintel").affiliateUrl));
    if (!configured) return false;
    if (/affiliate|product|shopping|buyer/i.test(category)) return index % 2 === 0;
    return Boolean(settings.affiliatePostFrequency && index % settings.affiliatePostFrequency === 0);
  }

  if (/affiliate|product|packing|essentials/i.test(category)) return getAmazonAffiliateConfig().enabled && index % 2 === 0;
  if (!settings.affiliatePostFrequency) return false;
  return getAmazonAffiliateConfig().enabled && index % settings.affiliatePostFrequency === 0;
}

function isPromotional(settings: FacebookAutomationSettings, category: string, index: number) {
  if (/feature|website|roamly/i.test(category)) return true;
  return Boolean(settings.promotionalPostFrequency && index % settings.promotionalPostFrequency === 0);
}

function linkForDraft(category: string, index: number, brand: FacebookSocialBrand) {
  const config = facebookBrandConfig(brand);
  const url = new URL(brand === "reviewintel" ? "/" : "/plan", config.publicSiteUrl);
  url.searchParams.set("utm_source", "facebook");
  url.searchParams.set("utm_medium", "organic_social");
  url.searchParams.set("utm_campaign", "autopost");
  url.searchParams.set("utm_content", `${slug(category)}-${String(index + 1).padStart(3, "0")}`);
  return url.toString();
}

function hookFor(category: string, topic: string, destination: string, index: number, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") {
    const hooks = [
      `Before checkout, check the ${topic}`,
      `A five-star rating is not the whole product story`,
      `The repeated complaints matter more than the loudest review`,
      `Smart shoppers look for patterns before buying`,
      `Seller decisions get clearer when reviews are organized`,
      `The product page sells. The review pattern explains.`,
      `Do not let polished stars make the decision for you`,
      `ReviewIntel turns messy reviews into a clearer next step`
    ];
    if (/seller|competitor/i.test(category)) return `Seller signal: ${topic}`;
    if (/fake|trust/i.test(category)) return `Trust check: ${topic}`;
    return hooks[index % hooks.length];
  }

  const hooks = [
    `Before you book ${destination}, check the plan in one place`,
    `A ${topic} reminder for the trip you keep talking about`,
    `The easiest travel mistake to avoid this week`,
    `Would this make your next ${destination} trip calmer?`,
    `One small planning step can change the whole travel day`,
    `A better weekend trip starts before the suitcase opens`,
    `Save this if ${topic} is on your mind`,
    `The travel plan should feel realistic before it feels exciting`
  ];
  if (/quote|statement/i.test(category)) return hooks[(index + 1) % hooks.length];
  if (/question|conversation|engagement/i.test(category)) return `Would you rather over-plan or leave the day open in ${destination}?`;
  if (/budget/i.test(category)) return `The budget check most travelers skip before ${destination}`;
  if (/packing/i.test(category)) return `Pack for the actual days, not the fantasy version of ${destination}`;
  if (/safety/i.test(category)) return `A calm arrival plan is part of safe travel`;
  if (/road/i.test(category)) return `Road trips work better when the stops breathe`;
  return hooks[index % hooks.length];
}

function captionFor({
  category,
  destination,
  hook,
  cta,
  link,
  affiliateLink,
  disclosure,
  promotional,
  brand
}: {
  category: string;
  destination: string;
  hook: string;
  cta: string;
  link: string;
  affiliateLink: string;
  disclosure: string;
  promotional: boolean;
  brand: FacebookSocialBrand;
}) {
  if (brand === "reviewintel") {
    const bodies: Record<string, string> = {
      seller: "For sellers, repeated complaints can point to product fixes, stronger positioning, and better customer support priorities.",
      fake: "For shoppers, a high rating is only useful when the review pattern looks specific, recent, and consistent.",
      competitor: "Competitor reviews can reveal the objections buyers already have, before you spend on a new listing or campaign.",
      default: "ReviewIntel helps turn reviews, complaints, trust signals, and product feedback into a clearer decision."
    };
    const key = /seller/i.test(category)
      ? "seller"
      : /fake|trust/i.test(category)
        ? "fake"
        : /competitor/i.test(category)
          ? "competitor"
          : "default";
    return [
      hook,
      bodies[key],
      `${cta}: ${link}`,
      affiliateLink ? `Relevant shopping link: ${affiliateLink}` : "",
      disclosure
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  const bodies: Record<string, string> = {
    budget: `Give the trip a realistic budget before the booking tabs take over. Roamly helps compare route, pace, bookings, and reminders so ${destination} feels easier to plan.`,
    packing: `A useful packing list starts with the actual itinerary. Check weather, transit days, activities, and laundry access before adding more "just in case" items.`,
    safety: `Share the plan, keep arrival details handy, and build a backup option into the day. Calm travel is usually planned travel.`,
    road: `Leave room between stops. The best road-trip days usually need fuel, food, photos, and one unplanned pause.`,
    product: `For travel essentials, match the item to the itinerary instead of buying for every possible scenario.`,
    feature: `Roamly brings itinerary planning, budget checks, booking organization, and live trip support into one place.`,
    default: `Make the plan practical before you make it packed. The route, timing, budget, and travel-day details should work together.`
  };
  const key = /budget/i.test(category)
    ? "budget"
    : /packing/i.test(category)
      ? "packing"
      : /safety/i.test(category)
        ? "safety"
        : /road/i.test(category)
          ? "road"
          : /product|affiliate/i.test(category)
            ? "product"
            : promotional
              ? "feature"
              : "default";
  return [hook, bodies[key], `${cta}: ${link}`, affiliateLink ? `Travel essential link: ${affiliateLink}` : "", disclosure].filter(Boolean).join("\n\n");
}

function hashtagsFor(category: string, destination: string, index: number, brand: FacebookSocialBrand) {
  const base = brand === "reviewintel" ? REVIEWINTEL_HASHTAG_GROUPS[index % REVIEWINTEL_HASHTAG_GROUPS.length] : HASHTAG_GROUPS[index % HASHTAG_GROUPS.length];
  const specific = [
    destination.replace(/[^A-Za-z0-9]/g, ""),
    category.replace(/[^A-Za-z0-9]/g, ""),
    TOPIC_ROTATION[index % TOPIC_ROTATION.length].replace(/[^A-Za-z0-9]/g, "")
  ];
  return uniqueHashtags([...base, ...specific]);
}

function mediaDirectionFor(format: FacebookPostFormat, category: string, destination: string, topic: string, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") {
    return `Vertical 9:16 ReviewIntel Reel about ${topic}: product-review pattern checks, shopper/seller decision prompts, and a clear website CTA.`;
  }
  if (format === "reel") {
    return `Vertical 9:16 video for ${destination}: quick cuts of planning screens, destination moments, packing details, and one clean text overlay about ${topic}.`;
  }
  if (format === "statement") {
    return "Clean Roamly statement graphic with high contrast, short text, generous spacing, no long URL, and mobile-readable typography.";
  }
  if (/product|affiliate|packing/i.test(category)) {
    return "Simple image of a travel essential in use, with no fake discount badges and no clutter.";
  }
  return `Bright travel image for ${destination} with room for a short caption in the Facebook post text only.`;
}

function onScreenTextFor(format: FacebookPostFormat, category: string, hook: string, topic: string, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") return hook.length > 70 ? `Check the ${topic} first.` : hook;
  if (format === "statement") return hook.length > 70 ? `${topic.charAt(0).toUpperCase()}${topic.slice(1)} matters.` : hook;
  if (format === "reel") return /question|conversation/i.test(category) ? "Would you choose this trip?" : "Plan the trip before it gets messy.";
  return "";
}

function audioMoodFor(format: FacebookPostFormat, index: number) {
  return format === "reel" ? AUDIO_MOODS[index % AUDIO_MOODS.length] : "";
}

function affiliateLinkFor(topic: string, index: number, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") {
    const configured = clean(facebookBrandConfig("reviewintel").affiliateUrl);
    if (!configured) return "";
    try {
      const url = new URL(configured);
      if (!/^https?:$/.test(url.protocol)) return "";
      return url.toString();
    } catch {
      return "";
    }
  }

  const amazon = getAmazonAffiliateConfig();
  if (!amazon.enabled) return "";
  const queries = [
    "packable travel backpack",
    "travel adapter international",
    "packing cubes carry on",
    "portable charger travel",
    "anti theft crossbody travel bag",
    "travel first aid kit",
    "waterproof phone pouch travel",
    "lightweight rain jacket travel"
  ];
  return buildAmazonSearchUrl(`${queries[index % queries.length]} ${topic}`, {
    enabled: amazon.enabled,
    associateTag: amazon.associateTag,
    marketplace: amazon.marketplace
  });
}

function qualityCheck(draft: Omit<GeneratedFacebookDraft, "qualityScore" | "qualityReasons">, duplicateHashes: Set<string>) {
  const reasons: string[] = [];
  let score = 100;

  const captionHash = hash(draft.caption);
  const hookHash = hash(draft.hook);
  const hashtagHash = hash(draft.hashtags.join("|"));
  const conceptHash = hash(draft.conceptKey);
  if (duplicateHashes.has(captionHash) || duplicateHashes.has(hookHash) || duplicateHashes.has(hashtagHash) || duplicateHashes.has(conceptHash)) {
    reasons.push("Duplicate hook, caption, concept, or hashtag set.");
    score -= 40;
  }
  if (!draft.caption) {
    reasons.push("Caption is empty.");
    score -= 60;
  }
  if (!draft.callToAction || !draft.caption.includes(draft.callToAction)) {
    reasons.push("Call to action is missing.");
    score -= 20;
  }
  if (draft.hashtags.length > 8) {
    reasons.push("Too many hashtags.");
    score -= 15;
  }
  if (draft.amazonAffiliateLink && !draft.affiliateDisclosure) {
    reasons.push("Affiliate disclosure is missing.");
    score -= 40;
  }
  for (const link of [draft.roamlyLink, draft.amazonAffiliateLink].filter(Boolean)) {
    try {
      const url = new URL(link);
      if (!/^https?:$/.test(url.protocol)) throw new Error("Invalid protocol");
    } catch {
      reasons.push("A link is invalid.");
      score -= 25;
    }
  }
  if (/\b(lorem ipsum|placeholder|insert|developer|system prompt|as an ai)\b/i.test(draft.caption)) {
    reasons.push("Placeholder or internal wording detected.");
    score -= 50;
  }
  if (draft.postFormat === "statement" && draft.onScreenText.length > 90) {
    reasons.push("Statement visual text is too long.");
    score -= 20;
  }
  if (/\bguaranteed|viral|limited time|act now|fake discount\b/i.test(draft.caption)) {
    reasons.push("Unsupported promotional claim detected.");
    score -= 35;
  }

  return { score: Math.max(0, Math.min(100, score)), reasons };
}

async function existingDuplicateHashes(admin: SupabaseClient, brand: FacebookSocialBrand) {
  const set = new Set<string>();
  const { data } = await admin
    .from("roamly_social_drafts")
    .select("hook_hash,caption_hash,hashtag_hash,concept_key,link_hash,media_hash")
    .in("platform", brandQueuePlatforms(brand))
    .order("created_at", { ascending: false })
    .limit(500);
  for (const row of (data || []) as Array<Record<string, string | null>>) {
    ["hook_hash", "caption_hash", "hashtag_hash", "concept_key", "link_hash", "media_hash"].forEach((key) => {
      const value = row[key];
      if (value) set.add(key === "concept_key" ? hash(value) : value);
    });
  }
  return set;
}

async function existingScheduledTimes(admin: SupabaseClient) {
  const set = new Set<string>();
  const now = new Date().toISOString();
  const { data } = await admin
    .from("roamly_social_queue")
    .select("scheduled_for")
    .in("queue_status", ["scheduled", "processing", "retrying", "published"])
    .gte("scheduled_for", now)
    .limit(800);
  for (const row of (data || []) as Array<{ scheduled_for?: string }>) {
    if (row.scheduled_for) set.add(new Date(row.scheduled_for).toISOString().slice(0, 16));
  }
  return set;
}

function buildScheduleSlots(settings: FacebookAutomationSettings, count: number, usedTimes: Set<string>) {
  const slots: string[] = [];
  const now = new Date();
  const hours = settings.preferredPostingHours.length ? settings.preferredPostingHours : [9, 12, 18];
  let dayOffset = 1;
  while (slots.length < count && dayOffset < 730) {
    const maxForDay = Math.max(1, Math.min(settings.maximumDailyPosts || settings.postsPerDay || 2, 6));
    for (let dailyIndex = 0; dailyIndex < maxForDay && slots.length < count; dailyIndex += 1) {
      const slot = new Date(now);
      slot.setDate(now.getDate() + dayOffset);
      const hour = hours[(dayOffset + dailyIndex) % hours.length];
      const minute = (11 + dayOffset * 13 + dailyIndex * 19) % 60;
      slot.setHours(hour, minute, 0, 0);
      const key = slot.toISOString().slice(0, 16);
      if (slot > now && !usedTimes.has(key)) {
        usedTimes.add(key);
        slots.push(slot.toISOString());
      }
    }
    dayOffset += 1;
  }
  return slots;
}

async function buildDrafts(
  admin: SupabaseClient,
  count: number,
  settings: FacebookAutomationSettings,
  scheduledTimes: string[],
  brand: FacebookSocialBrand
) {
  const duplicateHashes = await existingDuplicateHashes(admin, brand);
  const config = facebookBrandConfig(brand);
  const drafts: GeneratedFacebookDraft[] = [];
  let safety = 0;

  while (drafts.length < count && safety < count * 4) {
    const index = drafts.length + safety;
    const category = categoryForIndex(settings, index);
    const topic = brand === "reviewintel" ? REVIEWINTEL_TOPIC_ROTATION[index % REVIEWINTEL_TOPIC_ROTATION.length] : TOPIC_ROTATION[index % TOPIC_ROTATION.length];
    const destination = brand === "reviewintel" ? "ReviewIntel" : DESTINATION_ROTATION[index % DESTINATION_ROTATION.length];
    const postFormat = determineFormat();
    const promotional = isPromotional(settings, category, index);
    const cta =
      brand === "reviewintel"
        ? REVIEWINTEL_CTA_ROTATION[index % REVIEWINTEL_CTA_ROTATION.length]
        : CTA_ROTATION[index % CTA_ROTATION.length];
    const link = linkForDraft(category, index, brand);
    const useAffiliate = shouldUseAffiliate(settings, category, index, brand);
    const affiliateLink = useAffiliate ? affiliateLinkFor(topic, index, brand) : "";
    const disclosure = affiliateLink ? config.affiliateDisclosure : "";
    const hook = hookFor(category, topic, destination, index, brand);
    const caption = captionFor({
      category,
      destination,
      hook,
      cta,
      link,
      affiliateLink,
      disclosure,
      promotional,
      brand
    });
    const hashtags = hashtagsFor(category, brand === "reviewintel" ? topic : destination, index, brand);
    const suggestedMedia = "";
    const selectedMediaUrl = "";
    const conceptKey = `${brand}-${slug(category)}-${slug(topic)}-${slug(destination)}-${String(index).padStart(3, "0")}`;
    const draftBase = {
      contentType: category,
      postFormat,
      topic: brand === "reviewintel" ? topic : `${topic} in ${destination}`,
      topicKey: slug(topic),
      conceptKey,
      hook,
      caption,
      onScreenText: onScreenTextFor(postFormat, category, hook, topic, brand),
      mediaDirection: mediaDirectionFor(postFormat, category, destination, topic, brand),
      suggestedMedia,
      selectedMediaAssetId: null,
      selectedMediaUrl,
      callToAction: cta,
      hashtags,
      musicOrAudioMood: audioMoodFor(postFormat, index),
      roamlyLink: link,
      amazonAffiliateLink: affiliateLink,
      affiliateDisclosure: disclosure,
      generationSource: "fallback" as const,
      scheduledFor: scheduledTimes[drafts.length] || new Date(Date.now() + (drafts.length + 1) * 86_400_000).toISOString(),
      metadata: withBrandMetadata(brand, {
        destination,
        promotional,
        affiliate: Boolean(affiliateLink),
        reelOnly: true,
        generatedVideoRequired: true
      })
    };
    const quality = qualityCheck(draftBase, duplicateHashes);
    const completeDraft = { ...draftBase, qualityScore: quality.score, qualityReasons: quality.reasons };

    if (quality.score >= 75) {
      duplicateHashes.add(hash(hook));
      duplicateHashes.add(hash(caption));
      duplicateHashes.add(hash(hashtags.join("|")));
      duplicateHashes.add(hash(conceptKey));
      duplicateHashes.add(hash(link));
      drafts.push(completeDraft);
    }

    safety += 1;
  }

  return drafts;
}

async function createGenerationBatch(admin: SupabaseClient, count: number, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const { data, error } = await admin
    .from("roamly_content_generation_batches")
    .insert({
      platform: brandPlatform(brand),
      requested_count: count,
      generation_source: "fallback",
      status: "running",
      started_by: actorEmail || null,
      metadata: withBrandMetadata(brand, {
        categories: brand === "reviewintel" ? REVIEWINTEL_AUTOMATION_CATEGORIES : FACEBOOK_AUTOMATION_CATEGORIES,
        reelOnly: true
      })
    })
    .select("id")
    .single();
  if (error) throw error;
  return data.id as string;
}

async function finishGenerationBatch(
  admin: SupabaseClient,
  batchId: string,
  createdCount: number,
  rejectedCount: number,
  status: "completed" | "failed" | "partial",
  errorMessage?: string
) {
  await admin
    .from("roamly_content_generation_batches")
    .update({
      created_count: createdCount,
      rejected_count: rejectedCount,
      status,
      finished_at: new Date().toISOString(),
      error_message: errorMessage || null
    })
    .eq("id", batchId);
}

async function insertGeneratedDraft(admin: SupabaseClient, batchId: string, draft: GeneratedFacebookDraft, actorEmail?: string | null) {
  const brand = metadataBrand(draft.metadata);
  const hookHash = hash(draft.hook);
  const captionHash = hash(draft.caption);
  const hashtagHash = hash(draft.hashtags.join("|"));
  const linkHash = hash([draft.roamlyLink, draft.amazonAffiliateLink].filter(Boolean).join("|"));
  const mediaHash = hash(draft.selectedMediaUrl || draft.mediaDirection);

  const { data, error } = await admin
    .from("roamly_social_drafts")
    .insert({
      batch_id: batchId,
      platform: brandPlatform(brand),
      content_type: draft.contentType,
      post_format: draft.postFormat,
      topic: draft.topic,
      topic_key: draft.topicKey,
      concept_key: draft.conceptKey,
      hook: draft.hook,
      hook_hash: hookHash,
      caption: draft.caption,
      caption_hash: captionHash,
      on_screen_text: draft.onScreenText,
      media_direction: draft.mediaDirection,
      suggested_media: draft.suggestedMedia || null,
      selected_media_asset_id: draft.selectedMediaAssetId,
      selected_media_url: draft.selectedMediaUrl || null,
      media_hash: mediaHash,
      call_to_action: draft.callToAction,
      hashtags: draft.hashtags,
      hashtag_hash: hashtagHash,
      music_or_audio_mood: draft.musicOrAudioMood || null,
      roamly_link: draft.roamlyLink,
      link_hash: linkHash,
      amazon_affiliate_link: draft.amazonAffiliateLink || null,
      affiliate_disclosure: draft.affiliateDisclosure || null,
      generation_source: draft.generationSource,
      status: "queued",
      quality_score: draft.qualityScore,
      quality_reasons: draft.qualityReasons,
      metadata: withBrandMetadata(brand, draft.metadata),
      created_by: actorEmail || null
    })
    .select("id")
    .single();

  if (error) return { ok: false as const, error };

  const draftId = data.id as string;
  if (draft.postFormat === "statement" && (!draft.selectedMediaUrl || draft.selectedMediaUrl.includes("/pending-"))) {
    const mediaUrl = `${appBaseUrl()}/api/social/statement-image/${draftId}`;
    await admin
      .from("roamly_social_drafts")
      .update({
        selected_media_url: mediaUrl,
        media_hash: hash(mediaUrl)
      })
      .eq("id", draftId);
  }

  await admin.from("roamly_content_quality_checks").insert({
    draft_id: draftId,
    batch_id: batchId,
    score: draft.qualityScore,
    status: draft.qualityScore >= 75 ? "passed" : "rejected",
    reasons: draft.qualityReasons,
    metadata: withBrandMetadata(brand, { contentType: draft.contentType, postFormat: draft.postFormat })
  });

  return { ok: true as const, draftId };
}

async function insertQueueRows(admin: SupabaseClient, draftId: string, draft: GeneratedFacebookDraft) {
  const brand = metadataBrand(draft.metadata);
  const platform = brandPlatform(brand);
  const idempotencyKey = hash(`${platform}:${draftId}:${draft.scheduledFor}`);
  const publishKey = hash(`${platform}:publish:${draftId}`);
  const scheduledDate = draft.scheduledFor.slice(0, 10);
  const { data, error } = await admin
    .from("roamly_social_queue")
    .insert({
      draft_id: draftId,
      platform,
      queue_status: "scheduled",
      scheduled_for: draft.scheduledFor,
      scheduled_date: scheduledDate,
      idempotency_key: idempotencyKey,
      publish_key: publishKey,
      metadata: withBrandMetadata(brand, {
        contentType: draft.contentType,
        postFormat: draft.postFormat,
        reelOnly: true,
        platformMediaType: "reel",
        runtimeProof: Boolean(draft.metadata.runtimeProof),
        proofId: typeof draft.metadata.proofId === "string" ? draft.metadata.proofId : undefined
      })
    })
    .select("id")
    .single();
  if (error) return { ok: false as const, error };

  const queueId = data.id as string;
  await Promise.all([
    admin.from("roamly_scheduled_posts").insert({
      queue_id: queueId,
      draft_id: draftId,
      platform,
      scheduled_for: draft.scheduledFor,
      status: "scheduled",
      metadata: withBrandMetadata(brand, { idempotencyKey, platformMediaType: "reel" })
    }),
    admin.from("roamly_publishing_jobs").insert({
      queue_id: queueId,
      draft_id: draftId,
      platform,
      job_status: "scheduled",
      idempotency_key: idempotencyKey,
      scheduled_for: draft.scheduledFor,
      metadata: withBrandMetadata(brand, { publishKey, reelOnly: true, platformMediaType: "reel" })
    })
  ]);

  await admin
    .from("roamly_social_drafts")
    .update({ status: "scheduled" })
    .eq("id", draftId);

  return { ok: true as const, queueId };
}

export async function generateFacebookQueue(
  admin: SupabaseClient,
  {
    count = 100,
    actorEmail,
    source = "admin",
    brand = "roamly"
  }: {
    count?: number;
    actorEmail?: string | null;
    source?: "admin" | "cron" | "seo";
    brand?: FacebookSocialBrand;
  } = {}
) {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const { tableReady, settings } = await loadFacebookAutomationSettings(admin, normalizedBrand);
  if (!tableReady) {
    return { ok: false as const, tableReady: false, brand: normalizedBrand, created: 0, scheduled: 0, rejected: 0, error: "Automation tables are not ready." };
  }

  const safeCount = numberValue(count, 100, 1, Math.max(settings.maximumQueueSize, 1));
  const batchId = await createGenerationBatch(admin, safeCount, actorEmail || source, normalizedBrand);
  try {
    const usedTimes = await existingScheduledTimes(admin);
    const schedule = buildScheduleSlots(settings, safeCount, usedTimes);
    const drafts = await buildDrafts(admin, safeCount, settings, schedule, normalizedBrand);
    let created = 0;
    let scheduled = 0;
    let rejected = Math.max(0, safeCount - drafts.length);
    const queueIds: string[] = [];

    for (const draft of drafts) {
      const inserted = await insertGeneratedDraft(admin, batchId, draft, actorEmail || source);
      if (!inserted.ok) {
        rejected += 1;
        continue;
      }
      created += 1;
      const queued = await insertQueueRows(admin, inserted.draftId, draft);
      if (queued.ok) {
        scheduled += 1;
        queueIds.push(queued.queueId);
      }
    }

    await finishGenerationBatch(admin, batchId, created, rejected, created ? (created === safeCount ? "completed" : "partial") : "failed");
    await recordAdminActivity(admin, actorEmail || source, "facebook_queue_generated", "batch", batchId, "completed", {
      brand: normalizedBrand,
      requested: safeCount,
      created,
      scheduled,
      rejected
    });
    return { ok: true as const, tableReady: true, brand: normalizedBrand, batchId, created, scheduled, rejected, queueIds };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Queue generation failed.";
    await finishGenerationBatch(admin, batchId, 0, safeCount, "failed", message);
    return { ok: false as const, tableReady: true, brand: normalizedBrand, batchId, created: 0, scheduled: 0, rejected: safeCount, error: message };
  }
}

export async function queueFacebookPostForSeoPage(
  admin: SupabaseClient,
  page: {
    slug: string;
    seoTitle: string;
    metaDescription: string;
    contentType: string;
    canonicalUrl: string;
  },
  actorEmail?: string | null
) {
  const brand: FacebookSocialBrand = "roamly";
  const { settings } = await loadFacebookAutomationSettings(admin, brand);
  const usedTimes = await existingScheduledTimes(admin);
  const [scheduledFor] = buildScheduleSlots(settings, 1, usedTimes);
  const cta = "Explore more on Roamly";
  const hook = `New Roamly guide: ${page.seoTitle}`;
  const hashtags = uniqueHashtags(["Roamly", "TravelPlanning", "TravelGuide", page.contentType, "SmartTravel"]);
  const draft: GeneratedFacebookDraft = {
    contentType: "Website traffic posts",
    postFormat: "reel",
    topic: page.seoTitle,
    topicKey: slug(page.contentType),
    conceptKey: `seo-${slug(page.slug)}-${Date.now()}`,
    hook,
    caption: [hook, page.metaDescription, `${cta}: ${page.canonicalUrl}`].join("\n\n"),
    onScreenText: "",
    mediaDirection: "Vertical 9:16 Reel that sends travelers to a newly published Roamly guide.",
    suggestedMedia: "",
    selectedMediaAssetId: null,
    selectedMediaUrl: "",
    callToAction: cta,
    hashtags,
    musicOrAudioMood: audioMoodFor("reel", 0),
    roamlyLink: page.canonicalUrl,
    amazonAffiliateLink: "",
    affiliateDisclosure: "",
    generationSource: "seo",
    qualityScore: 94,
    qualityReasons: [],
    scheduledFor: scheduledFor || new Date(Date.now() + 86_400_000).toISOString(),
    metadata: withBrandMetadata(brand, { seoSlug: page.slug, seoTitle: page.seoTitle, reelOnly: true, generatedVideoRequired: true })
  };
  const batchId = await createGenerationBatch(admin, 1, actorEmail || "seo", brand);
  const inserted = await insertGeneratedDraft(admin, batchId, draft, actorEmail || "seo");
  if (!inserted.ok) {
    await finishGenerationBatch(admin, batchId, 0, 1, "failed", inserted.error.message);
    return { ok: false as const, error: inserted.error.message };
  }
  const queued = await insertQueueRows(admin, inserted.draftId, draft);
  await finishGenerationBatch(admin, batchId, queued.ok ? 1 : 0, queued.ok ? 0 : 1, queued.ok ? "completed" : "failed", queued.ok ? undefined : queued.error.message);
  if (!queued.ok) return { ok: false as const, error: queued.error.message };
  return { ok: true as const, queueId: queued.queueId, draftId: inserted.draftId, scheduledFor: draft.scheduledFor };
}

export async function queueFacebookRuntimeProofReel(
  admin: SupabaseClient,
  brand: FacebookSocialBrand,
  actorEmail: string | null = "runtime_proof"
) {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const config = facebookBrandConfig(normalizedBrand);
  const proofId = randomUUID();
  const proofMoment = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(4, 14);
  const scheduledFor = new Date(Date.now() - 10 * 365 * 24 * 60 * 60 * 1000).toISOString();
  const link = new URL(config.primaryLink);
  link.searchParams.set("utm_content", `runtime-proof-${proofId.slice(0, 8)}`);
  const useAffiliate = normalizedBrand === "roamly" ? getAmazonAffiliateConfig().enabled : Boolean(clean(config.affiliateUrl));
  const affiliateLink = useAffiliate ? affiliateLinkFor("runtime proof", Date.now(), normalizedBrand) : "";
  const disclosure = affiliateLink ? config.affiliateDisclosure : "";
  const hook =
    normalizedBrand === "reviewintel"
      ? `ReviewIntel product check ${proofMoment}: ratings are only the start`
      : `Roamly planning check ${proofMoment}: real booking details first`;
  const body =
    normalizedBrand === "reviewintel"
      ? "Before checkout, look for repeated complaints, recent review quality, and trust patterns. ReviewIntel helps turn messy product feedback into a clearer decision."
      : "A practical trip plan should keep flights, hotel check-in, routes, meals, and backup time connected. Roamly helps organize the plan before the day gets crowded.";
  const cta = normalizedBrand === "reviewintel" ? "Scan before you buy" : "Plan your next trip with Roamly";
  const caption = [hook, body, `${cta}: ${link.toString()}`, affiliateLink ? `Relevant link: ${affiliateLink}` : "", disclosure]
    .filter(Boolean)
    .join("\n\n");
  const hashtags = uniqueHashtags(
    normalizedBrand === "reviewintel"
      ? ["ReviewIntel", "SmartShopping", "ReviewAnalysis", "FakeReviews", "BeforeYouBuy", "FacebookReels", `RI${proofMoment}`]
      : ["Roamly", "TravelPlanning", "SmartTravel", "TripPlanning", "TravelTips", "FacebookReels", `Roamly${proofMoment}`]
  );
  const draft: GeneratedFacebookDraft = {
    contentType: "Facebook Reels",
    postFormat: "reel",
    topic: normalizedBrand === "reviewintel" ? "product trust check" : "booking-aware trip planning",
    topicKey: normalizedBrand === "reviewintel" ? "product-trust-check" : "booking-aware-trip-planning",
    conceptKey: `${normalizedBrand}-runtime-proof-${proofId}`,
    hook,
    caption,
    onScreenText: hook,
    mediaDirection:
      normalizedBrand === "reviewintel"
        ? "Vertical 9:16 ReviewIntel Reel showing a simple product-review trust check and website CTA."
        : "Vertical 9:16 Roamly Reel showing booking-aware trip planning and website CTA.",
    suggestedMedia: "",
    selectedMediaAssetId: null,
    selectedMediaUrl: "",
    callToAction: cta,
    hashtags,
    musicOrAudioMood: audioMoodFor("reel", 0),
    roamlyLink: link.toString(),
    amazonAffiliateLink: affiliateLink,
    affiliateDisclosure: disclosure,
    generationSource: "fallback",
    qualityScore: 96,
    qualityReasons: [],
    scheduledFor,
    metadata: withBrandMetadata(normalizedBrand, {
      runtimeProof: true,
      proofId,
      reelOnly: true,
      generatedVideoRequired: true,
      affiliate: Boolean(affiliateLink)
    })
  };

  const batchId = await createGenerationBatch(admin, 1, actorEmail, normalizedBrand);
  const inserted = await insertGeneratedDraft(admin, batchId, draft, actorEmail);
  if (!inserted.ok) {
    await finishGenerationBatch(admin, batchId, 0, 1, "failed", inserted.error.message);
    return { ok: false as const, brand: normalizedBrand, batchId, error: inserted.error.message };
  }
  const queued = await insertQueueRows(admin, inserted.draftId, draft);
  await finishGenerationBatch(admin, batchId, queued.ok ? 1 : 0, queued.ok ? 0 : 1, queued.ok ? "completed" : "failed", queued.ok ? undefined : queued.error.message);
  if (!queued.ok) return { ok: false as const, brand: normalizedBrand, batchId, draftId: inserted.draftId, error: queued.error.message };

  return {
    ok: true as const,
    brand: normalizedBrand,
    batchId,
    draftId: inserted.draftId,
    queueId: queued.queueId,
    proofId,
    scheduledFor
  };
}

export async function refillFacebookQueue(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const { settings } = await loadFacebookAutomationSettings(admin, normalizedBrand);
  const future = await countFutureQueue(admin, normalizedBrand);
  const targetFloor = normalizedBrand === "reviewintel" ? 10 : 30;
  const target = Math.min(settings.maximumQueueSize, Math.max(settings.minimumQueueSize, targetFloor));
  const needed = Math.max(0, target - future);
  if (!needed) return { ok: true as const, brand: normalizedBrand, created: 0, scheduled: 0, reason: "Queue already meets the target size." };
  return generateFacebookQueue(admin, { count: needed, actorEmail, source: actorEmail ? "admin" : "cron", brand: normalizedBrand });
}

async function countFutureQueue(admin: SupabaseClient, brand: FacebookSocialBrand) {
  const { count } = await admin
    .from("roamly_social_queue")
    .select("id", { count: "exact", head: true })
    .in("platform", brandQueuePlatforms(brand))
    .in("queue_status", ["scheduled", "retrying"])
    .gte("scheduled_for", new Date().toISOString());
  return count || 0;
}

async function countPublishedToday(admin: SupabaseClient, brand: FacebookSocialBrand) {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const { count } = await admin
    .from("roamly_social_queue")
    .select("id", { count: "exact", head: true })
    .in("platform", brandQueuePlatforms(brand))
    .eq("queue_status", "published")
    .gte("published_at", start.toISOString());
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

async function getDueQueue(admin: SupabaseClient, limit: number, brand: FacebookSocialBrand) {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("roamly_social_queue")
    .select(
      "*,draft:roamly_social_drafts(id,content_type,post_format,topic,hook,caption,on_screen_text,media_direction,suggested_media,selected_media_asset_id,selected_media_url,call_to_action,hashtags,music_or_audio_mood,roamly_link,amazon_affiliate_link,affiliate_disclosure,generation_source,status,quality_score,quality_reasons,metadata,created_at,updated_at)"
    )
    .in("platform", brandQueuePlatforms(brand))
    .in("queue_status", ["scheduled", "retrying"])
    .lte("scheduled_for", now)
    .or(`retry_after.is.null,retry_after.lte.${now}`)
    .order("scheduled_for", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return ((data || []) as unknown as QueueWithDraft[]).filter((item) => item.draft);
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

function supabaseMediaConfig() {
  return {
    supabaseUrl: envFirst("NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_URL"),
    serviceKey: envFirst("SUPABASE_SERVICE_ROLE_KEY")
  };
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
  video: Awaited<ReturnType<typeof generateFreshSocialReelVideo>>
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
        source_draft_id: draft.id
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
): Promise<{ mediaUrl: string; generatedVideo?: Awaited<ReturnType<typeof generateFreshSocialReelVideo>>; mediaAssetId?: string | null }> {
  const existingUrl = clean(draft.selected_media_url || draft.suggested_media);
  const asset = draft.selected_media_asset_id
    ? await admin
        .from("roamly_social_media_assets")
        .select("asset_type,is_vertical,width,height,duration_seconds,metadata,media_url")
        .eq("id", draft.selected_media_asset_id)
        .maybeSingle()
    : { data: null, error: null };
  if (asset.error) throw new FacebookGraphError(`Reel media asset validation failed: ${asset.error.message}`, false, { assetError: asset.error.message });
  const assetMetadata = objectValue(asset.data?.metadata);
  if (draft.selected_media_asset_id && !asset.data) {
    throw new FacebookGraphError("The selected Facebook Reel media asset no longer exists.", false, { assetId: draft.selected_media_asset_id });
  }
  if (asset.data) {
    assertReelMediaMetadata({
      assetType: asset.data.asset_type,
      isVertical: asset.data.is_vertical,
      width: asset.data.width ?? assetMetadata.width,
      height: asset.data.height ?? assetMetadata.height,
      durationSeconds: asset.data.duration_seconds ?? assetMetadata.duration_seconds,
      fileSizeBytes: assetMetadata.file_size_bytes
    });
  }
  if ((existingUrl || draft.selected_media_asset_id) && !videoLooksSupported(existingUrl)) {
    throw new FacebookGraphError("The selected Facebook Reel asset is not an MP4 video.", false, { mediaUrl: existingUrl || null });
  }
  if (videoLooksSupported(existingUrl)) {
    const probe = await probeFacebookAccessibleUrl({ url: existingUrl, timeoutMs: 7000 });
    if (!probe.ok) {
      throw new FacebookGraphError(probe.error || "Configured Reel MP4 is not publicly reachable.", false, { probe, mediaUrl: existingUrl });
    }
    await admin.from("roamly_facebook_media_processing").insert({
      queue_id: queueId,
      draft_id: draft.id,
      processing_status: "ready",
      checked_at: new Date().toISOString(),
      metadata: withBrandMetadata(config.brand, {
        stage: "existing_video_selected",
        page_id: config.pageId,
        mediaUrl: existingUrl,
        publicProbe: probe,
        generatedVideoRequired: false
      })
    });
    return { mediaUrl: existingUrl, mediaAssetId: draft.selected_media_asset_id };
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

function processingState(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  const status = record.status;
  if (typeof status === "string") return status.toLowerCase();
  const videoStatus = record.video_status;
  if (typeof videoStatus === "string") return videoStatus.toLowerCase();
  const processingPhase = record.processing_phase;
  if (typeof processingPhase === "string") return processingPhase.toLowerCase();
  return "";
}

async function waitForReelProcessing(config: FacebookBrandConfig, videoId: string) {
  let lastStatus = "";
  for (let index = 0; index < 4; index += 1) {
    const response = await facebookGraph<Record<string, unknown>>(config, `${videoId}`, {
      method: "GET",
      params: { fields: "id,status,permalink_url" }
    });
    lastStatus = processingState(response.status || response);
    if (!lastStatus || /ready|complete|finished|published|success/.test(lastStatus)) return { ready: true, response };
    if (/error|failed|rejected/.test(lastStatus)) return { ready: false, response, error: `Meta processing failed: ${lastStatus}` };
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  return { ready: false, response: {}, error: lastStatus ? `Meta processing still ${lastStatus}.` : "Meta processing did not confirm readiness." };
}

async function publishFacebookReel(
  admin: SupabaseClient,
  queueId: string,
  draft: SocialDraftRow,
  brand: FacebookSocialBrand = metadataBrand(draft.metadata)
): Promise<PublishResult> {
  const config = facebookBrandConfig(brand);
  const reelMedia = await ensureReelVideo(admin, queueId, draft, config);
  const mediaUrl = reelMedia.mediaUrl;

  const start = await facebookGraph<{ video_id?: string; upload_url?: string }>(config, `${config.pageId}/video_reels`, {
    params: { upload_phase: "start" }
  });
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

  const upload = await uploadReelVideo(config, uploadUrl, mediaUrl);
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

  const processing = await waitForReelProcessing(config, videoId);
  if (!processing.ready) {
    await admin
      .from("roamly_facebook_media_processing")
      .update({ processing_status: "failed", error_message: processing.error || "Meta processing did not finish.", checked_at: new Date().toISOString() })
      .eq("queue_id", queueId);
    return { ok: false, status: "failed", temporary: true, error: processing.error || "Meta processing did not finish.", metaResponse: processing.response };
  }

  const finish = await facebookGraph<{ id?: string; success?: boolean }>(config, `${config.pageId}/video_reels`, {
    params: {
      upload_phase: "finish",
      video_id: videoId,
      video_state: "PUBLISHED",
      description: finalCaption(draft)
    }
  });

  const confirmation = await facebookGraph<Record<string, unknown>>(config, `${videoId}`, {
    method: "GET",
    params: { fields: "id,permalink_url,status,media_type,is_reel" }
  });
  const permalink = typeof confirmation.permalink_url === "string" ? confirmation.permalink_url : "";
  const classifiedAsReel = confirmation.is_reel === true || String(confirmation.media_type || "").toLowerCase() === "reel" || /\/reel\//i.test(permalink);
  if (!permalink || !classifiedAsReel) {
    throw new FacebookGraphError("Meta did not confirm the published object as a Reel.", false, { confirmation, permalink, classifiedAsReel });
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
        mediaUrl,
        generatedVideo: reelMedia.generatedVideo || null,
        start,
        upload,
        finish,
        confirmation,
        platformMediaType: "reel"
      })
    })
    .eq("queue_id", queueId);

  return {
    ok: true,
    status: "published",
    facebookReelId: videoId,
    facebookMediaId: videoId,
    facebookUrl: permalink,
    metaResponse: withBrandMetadata(config.brand, {
      pageId: config.pageId,
      postedAs: "reel",
      platformMediaType: "reel",
      mediaUrl,
      generatedVideo: reelMedia.generatedVideo || null,
      start,
      upload,
      finish,
      confirmation
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

async function markPublished(admin: SupabaseClient, item: QueueWithDraft, result: PublishResult) {
  const now = new Date().toISOString();
  const brand = brandFromQueueItem(item);
  await Promise.all([
    admin
      .from("roamly_social_queue")
      .update({
        queue_status: "published",
        facebook_post_id: result.facebookPostId || null,
        facebook_reel_id: result.facebookReelId || null,
        facebook_media_id: result.facebookMediaId || null,
        facebook_url: result.facebookUrl || null,
        published_at: now,
        processing_finished_at: now,
        processing_locked_at: null,
        processing_lock_token: null,
        retry_after: null,
        last_error: null,
        meta_response: result.metaResponse || {}
      })
      .eq("id", item.id),
    admin.from("roamly_social_drafts").update({ status: "published" }).eq("id", item.draft_id),
    admin.from("roamly_scheduled_posts").update({ status: "published" }).eq("queue_id", item.id),
    admin
      .from("roamly_publishing_jobs")
      .update({
        job_status: "published",
        finished_at: now,
        lock_token: null,
        locked_at: null,
        last_error: null
      })
      .eq("queue_id", item.id)
  ]);

  if (item.draft.selected_media_asset_id) {
    await admin
      .from("roamly_social_media_assets")
      .update({
        use_count: ((item.draft.metadata?.mediaUseCount as number | undefined) || 0) + 1,
        last_used_at: now
      })
      .eq("id", item.draft.selected_media_asset_id);
    await admin.from("roamly_media_library_usage").insert({
      media_asset_id: item.draft.selected_media_asset_id,
      draft_id: item.draft_id,
      queue_id: item.id,
      platform: brandPlatform(brand),
      use_count: 1,
      last_used_at: now,
      status: "active"
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
  const config = facebookBrandConfig(brand);
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
    brand = "roamly"
  }: { trigger?: "cron" | "admin"; force?: boolean; limit?: number; brand?: FacebookSocialBrand } = {}
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
    const canPublish =
      validation.ok &&
      !settings.manualReviewRequired &&
      (force || (settings.automationEnabled && !settings.paused));
    if (!canPublish) {
      const reason =
        validation.blockingIssues[0] ||
        (settings.manualReviewRequired ? "Manual review is enabled." : settings.paused ? "Automation is paused." : "Automation is disabled.");
      const refill = await refillFacebookQueue(admin, trigger, normalizedBrand);
      summary.generated = "created" in refill ? refill.created || 0 : 0;
      summary.status = "skipped";
      summary.blockingIssues = validation.blockingIssues.length ? validation.blockingIssues : [reason];
      await finishCronLog(admin, cronId, "skipped", summary, reason);
      return summary;
    }

    const publishedToday = await countPublishedToday(admin, normalizedBrand);
    const remainingToday = Math.max(0, settings.maximumDailyPosts - publishedToday);
    if (!remainingToday) {
      const refill = await refillFacebookQueue(admin, trigger, normalizedBrand);
      summary.generated = "created" in refill ? refill.created || 0 : 0;
      summary.status = "skipped";
      summary.blockingIssues.push("Daily publishing limit reached.");
      await finishCronLog(admin, cronId, "skipped", summary, "Daily publishing limit reached.");
      return summary;
    }

    const due = await getDueQueue(admin, Math.min(limit, remainingToday), normalizedBrand);
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

      if (result.ok) {
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

export async function publishNextFacebookPostNow(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const { data, error } = await admin
    .from("roamly_social_queue")
    .select("id")
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .eq("queue_status", "scheduled")
    .order("scheduled_for", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error || !data) return { ok: false as const, error: error?.message || "No scheduled post is available." };
  await admin
    .from("roamly_social_queue")
    .update({ scheduled_for: new Date(Date.now() - 1000).toISOString(), retry_after: null })
    .eq("id", data.id);
  await recordAdminActivity(admin, actorEmail, "facebook_publish_next_now", "social_queue", data.id, "completed", { brand: normalizedBrand });
  const result = await runFacebookAutomationCycle(admin, { trigger: "admin", force: true, limit: 1, brand: normalizedBrand });
  return { ok: result.ok, result };
}

export async function retryFailedFacebookPosts(admin: SupabaseClient, actorEmail?: string | null, brand: FacebookSocialBrand = "roamly") {
  const normalizedBrand = normalizeFacebookBrand(brand);
  const retryAt = new Date(Date.now() - 1000).toISOString();
  const { data, error } = await admin
    .from("roamly_social_queue")
    .update({
      queue_status: "retrying",
      retry_after: retryAt,
      scheduled_for: retryAt,
      permanent_failure: false,
      processing_lock_token: null,
      processing_locked_at: null
    })
    .in("platform", brandQueuePlatforms(normalizedBrand))
    .eq("queue_status", "failed")
    .select("id");
  if (error) return { ok: false as const, error: error.message };
  await recordAdminActivity(admin, actorEmail, "facebook_retry_failures", "social_queue", undefined, "completed", {
    brand: normalizedBrand,
    count: data?.length || 0
  });
  return { ok: true as const, brand: normalizedBrand, retried: data?.length || 0 };
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
  const social =
    normalizedBrand === "roamly"
      ? getRoamlySocialEnvStatus()
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
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const todayEnd = new Date(todayStart);
  todayEnd.setDate(todayEnd.getDate() + 1);
  const weekEnd = new Date(todayStart);
  weekEnd.setDate(weekEnd.getDate() + 7);

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
