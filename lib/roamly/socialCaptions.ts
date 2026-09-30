/**
 * Roamly social caption + draft-generation layer.
 *
 * Deterministic content engine for the Facebook autopost program: rotation
 * constants, destination-aware CTAs, hooks, caption builders, hashtag builders,
 * the quality gate, draft-batch generation, and queue refill. Extracted from
 * lib/roamly/socialAutomation.ts (transport refactor — the engine file exceeded
 * the push payload limit); behavior is identical, and socialAutomation.ts
 * re-exports everything so external imports keep working.
 *
 * Pure and deterministic: no network calls, no LLM calls, no spending, no
 * customer-data access. Supabase access here is limited to the automation
 * queue/settings tables the generation pipeline has always used.
 */
import { createHash, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildAmazonSearchUrl, getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { ROAMLY_AFFILIATE_DISCLOSURE, ROAMLY_PUBLIC_DOMAIN } from "@/lib/roamly/emailTemplates";
import { getRoamlySocialEnvStatus, isSocialTableMissingError } from "@/lib/roamly/social";
import { selectCampaignPhotoAsset } from "@/lib/roamly/facebookCampaignMedia";
import { buildRoamlyContentVariant } from "@/lib/roamly/socialContentVariation";
import type {
  FacebookAutomationSettings,
  FacebookBrandConfig,
  FacebookPostFormat,
  FacebookSocialBrand,
  GeneratedFacebookDraft,
  SocialMediaAssetRow
} from "./socialAutomation";

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

function ctaFor(topic: string, destination: string, index: number, brand: FacebookSocialBrand) {
  if (brand === "reviewintel") return REVIEWINTEL_CTA_ROTATION[index % REVIEWINTEL_CTA_ROTATION.length];
  // Trial conversion: name the destination and the concrete outcome (a finished
  // itinerary) instead of a generic brand invitation. Rotates deterministically
  // with the post index so captions stay varied and the quality gate still sees
  // the CTA text inside the caption.
  const ctas = [
    `Build your ${destination} itinerary`,
    `Turn this ${topic} idea into a ${destination} plan`,
    `Get your ${destination} day-by-day plan`,
    `Plan ${destination} with Roamly`,
    `Start planning ${destination}`
  ];
  return ctas[index % ctas.length];
}

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
const DEFAULT_ROAMLY_TIME_ZONE = "America/Moncton";

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

function validTimeZone(value: unknown, fallback = DEFAULT_ROAMLY_TIME_ZONE) {
  const zone = clean(typeof value === "string" ? value : "");
  if (!zone) return fallback;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return fallback;
  }
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

function explicitMetadataBrand(metadata: Record<string, unknown> | null | undefined): FacebookSocialBrand | null {
  const raw = clean(
    typeof metadata?.brand === "string"
      ? metadata.brand
      : typeof metadata?.social_brand === "string"
        ? metadata.social_brand
        : typeof metadata?.facebookBrand === "string"
          ? metadata.facebookBrand
          : ""
  )
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  if (raw === "roamly") return "roamly";
  if (raw === "reviewintel" || raw === "reviewinsight") return "reviewintel";
  return null;
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
  return [
    ...new Set(
      values
        .map((tag) =>
          tag
            .replace(/^#/, "")
            .normalize("NFC")
            .replace(/[^\p{L}\p{N}\p{M}_]/gu, "")
        )
        .filter(Boolean)
    )
  ].slice(0, 12);
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
    postsPerDay: isReviewIntel
      ? numberValue(
          envFirst("REVIEWINTEL_SOCIAL_POSTS_PER_DAY"),
          1,
          0,
          12
        )
      : 1,
    reelsPerWeek: numberValue(
      envFirst(isReviewIntel ? "REVIEWINTEL_SOCIAL_REELS_PER_WEEK" : "ROAMLY_SOCIAL_REELS_PER_WEEK"),
      isReviewIntel ? 7 : 3,
      0,
      21
    ),
    preferredPostingHours: [9, 12, 18],
    timeZone: validTimeZone(process.env.ROAMLY_TIME_ZONE, validTimeZone(process.env.TZ)),
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
    maximumDailyPosts: isReviewIntel
      ? numberValue(
          envFirst("REVIEWINTEL_SOCIAL_MAX_DAILY_POSTS"),
          1,
          0,
          24
        )
      : 1,
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
      postsPerDay:
        normalizedBrand === "roamly"
          ? 1
          : numberValue(data.posts_per_day, defaults.postsPerDay, 0, 12),
      reelsPerWeek: numberValue(data.reels_per_week, defaults.reelsPerWeek, 0, 21),
      preferredPostingHours: numberArray(data.preferred_posting_hours, defaults.preferredPostingHours),
      timeZone: validTimeZone(data.time_zone, defaults.timeZone),
      minimumQueueSize: numberValue(data.minimum_queue_size, defaults.minimumQueueSize, 0, 500),
      maximumQueueSize: numberValue(data.maximum_queue_size, defaults.maximumQueueSize, 1, 1000),
      maximumDailyPosts:
        normalizedBrand === "roamly"
          ? 1
          : numberValue(data.maximum_daily_posts, defaults.maximumDailyPosts, 0, 24),
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
  brand,
  bodyOverride
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
  bodyOverride?: string;
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
      cta,
      // The app link gets its own line so Facebook unfurls a tappable preview
      // card instead of burying the URL mid-sentence.
      link,
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
  // The app link gets its own line so Facebook unfurls a tappable preview card.
  return [hook, bodyOverride || bodies[key], cta, link, affiliateLink ? `Travel essential link: ${affiliateLink}` : "", disclosure].filter(Boolean).join("\n\n");
}

function hashtagsFor(category: string, destination: string, index: number, brand: FacebookSocialBrand, variationTerms: string[] = []) {
  const base = brand === "reviewintel"
    ? REVIEWINTEL_HASHTAG_GROUPS[index % REVIEWINTEL_HASHTAG_GROUPS.length]
    : HASHTAG_GROUPS[index % HASHTAG_GROUPS.length];

  const specific = [
    destination.replace(/[^A-Za-z0-9]/g, ""),
    category.replace(/[^A-Za-z0-9]/g, ""),
    TOPIC_ROTATION[index % TOPIC_ROTATION.length].replace(/[^A-Za-z0-9]/g, "")
  ];

  // Viral-reach discovery tags, rotated so posts don't look copy-pasted.
  // Broad high-follow tags carry the reach; the base groups carry the niche.
  const VIRAL_HASHTAG_ROTATION: Record<FacebookSocialBrand, string[][]> = {
    roamly: [
      ["Travel", "Reels", "TravelGram", "Wanderlust"],
      ["TravelReels", "InstaTravel", "ExploreMore", "TravelAddict"],
      ["Wanderlust", "TravelPhotography", "Reels", "Travel"],
      ["TravelGram", "TravelInspiration", "InstaTravel", "Reels"]
    ],
    reviewintel: [
      ["Reels", "Shopping", "Deals", "ShoppingHacks"],
      ["ProductReview", "Reels", "MustHave", "ShopSmart"],
      ["Shopping", "Reels", "Deals", "HonestReviews"]
    ]
  };
  const viralReachHashtags =
    VIRAL_HASHTAG_ROTATION[brand][index % VIRAL_HASHTAG_ROTATION[brand].length];

  return uniqueHashtags([...base, ...specific, ...variationTerms, ...viralReachHashtags]);
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

  const hours = [
    ...new Set(
      (settings.preferredPostingHours.length
        ? settings.preferredPostingHours
        : [9, 12, 18]
      )
        .map((value) => Math.max(0, Math.min(23, Math.trunc(value))))
    )
  ].sort((a, b) => a - b);

  const settingsRecord = settings as unknown as Record<string, unknown>;
  const timeZone =
    String(
      settingsRecord.timezone ||
      settingsRecord.timeZone ||
      settingsRecord.postingTimezone ||
      "America/Moncton"
    ).trim() || "America/Moncton";

  const partsInZone = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23"
    }).formatToParts(date);

    const get = (type: Intl.DateTimeFormatPartTypes) =>
      Number(parts.find((part) => part.type === type)?.value || 0);

    return {
      year: get("year"),
      month: get("month"),
      day: get("day"),
      hour: get("hour"),
      minute: get("minute"),
      second: get("second")
    };
  };

  const zonedWallClockToUtc = (
    year: number,
    month: number,
    day: number,
    hour: number
  ) => {
    const wallClockUtc = Date.UTC(year, month - 1, day, hour, 0, 0, 0);
    let candidate = new Date(wallClockUtc);

    // Resolve the UTC instant whose wall-clock representation in timeZone
    // equals year/month/day/hour:00.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const actual = partsInZone(candidate);
      const actualAsUtc = Date.UTC(
        actual.year,
        actual.month - 1,
        actual.day,
        actual.hour,
        actual.minute,
        actual.second,
        0
      );

      const delta = wallClockUtc - actualAsUtc;
      if (delta === 0) break;

      candidate = new Date(candidate.getTime() + delta);
    }

    candidate.setMilliseconds(0);
    return candidate;
  };

  const maxForDay = Math.max(
    1,
    Math.min(
      settings.maximumDailyPosts || settings.postsPerDay || 2,
      hours.length,
      6
    )
  );

  /*
   * Start TODAY, not tomorrow.
   * Any configured time that has already passed today is skipped naturally.
   */
  let dayOffset = 0;

  while (slots.length < count && dayOffset < 730) {
    const localNow = partsInZone(now);

    // Noon UTC keeps calendar arithmetic stable while we add days.
    const calendarDate = new Date(
      Date.UTC(
        localNow.year,
        localNow.month - 1,
        localNow.day + dayOffset,
        12,
        0,
        0,
        0
      )
    );

    const year = calendarDate.getUTCFullYear();
    const month = calendarDate.getUTCMonth() + 1;
    const day = calendarDate.getUTCDate();

    for (
      let dailyIndex = 0;
      dailyIndex < maxForDay && slots.length < count;
      dailyIndex += 1
    ) {
      const hour = hours[dailyIndex];

      // EXACT configured time: HH:00. No randomized minute.
      const slot = zonedWallClockToUtc(year, month, day, hour);
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
    const contentVariant = brand === "roamly" ? buildRoamlyContentVariant(index, destination) : null;
    const promotional = isPromotional(settings, category, index);
    const cta = ctaFor(topic, destination, index, brand);
    const link = linkForDraft(category, index, brand);
    const useAffiliate = shouldUseAffiliate(settings, category, index, brand);
    const affiliateLink = useAffiliate ? affiliateLinkFor(topic, index, brand) : "";
    const disclosure = affiliateLink ? config.affiliateDisclosure : "";
    const hook = contentVariant?.hook || hookFor(category, topic, destination, index, brand);
    const caption = captionFor({
      category,
      destination,
      hook,
      cta,
      link,
      affiliateLink,
      disclosure,
      promotional,
      brand,
      bodyOverride: contentVariant?.body
    });
    const hashtags = hashtagsFor(
      category,
      brand === "reviewintel" ? topic : destination,
      index,
      brand,
      contentVariant?.hashtagTerms || []
    );
    const campaignPhoto = brand === "roamly"
      ? await pickCampaignPhotoAsset(admin, brand, destination, topic)
      : null;
    if (brand === "roamly" && !campaignPhoto) {
      safety += 1;
      continue;
    }
    const suggestedMedia = campaignPhoto?.media_url || "";
    const selectedMediaUrl = campaignPhoto?.media_url || "";
    const conceptKey = `${brand}-${slug(category)}-${slug(topic)}-${slug(destination)}-${contentVariant?.key || "legacy"}-${String(index).padStart(3, "0")}`;
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
      selectedMediaAssetId: campaignPhoto?.id || null,
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
        sourceMediaAssetId: campaignPhoto?.id || null,
        sourceImageAssetId: campaignPhoto?.id || null,
        sourceMediaUrl: campaignPhoto?.media_url || null,
        sourceImageUrl: campaignPhoto?.media_url || null,
        visualSelection: campaignPhoto ? "destination_matched_approved_photo" : null,
        contentVariant: contentVariant?.key || null,
        contentIntent: contentVariant?.intent.key || null,
        contentMoment: contentVariant?.moment.key || null,
        contentAngle: contentVariant?.angle.key || null,
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
  const proofTag = proofId.replace(/-/g, "").slice(0, 12);
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
      ? ["ReviewIntel", "SmartShopping", "ReviewAnalysis", "FakeReviews", "BeforeYouBuy", "FacebookReels", `RI${proofTag}`]
      : [
          "Roamly",
          "TravelPlanning",
          "SmartTravel",
          "TripPlanning",
          "TravelTips",
          "FacebookReels",
          "fypシ",
          "fypシ゚viralシ",
          "fypviralシ",
          `Roamly${proofTag}`
        ]
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

function assetUrl(asset: Pick<SocialMediaAssetRow, "media_url"> | null | undefined) {
  return clean(asset?.media_url || "");
}

function assetType(asset: Pick<SocialMediaAssetRow, "asset_type" | "media_url" | "metadata">) {
  const metadata = objectValue(asset.metadata);
  const raw = clean(asset.asset_type || String(metadata.asset_type || metadata.media_type || "")).toLowerCase();
  if (raw === "image" || raw === "photo") return "image" as const;
  if (raw === "video" || /\.mp4(\?|$)/i.test(clean(asset.media_url))) return "video" as const;
  if (/\.(png|jpe?g|webp)(\?|$)/i.test(clean(asset.media_url))) return "image" as const;
  return "";
}

function isApprovedAutomationAsset(asset: SocialMediaAssetRow, brand: FacebookSocialBrand) {
  const metadata = objectValue(asset.metadata);
  const platform = clean(asset.platform);
  const metadataBrandName = explicitMetadataBrand(metadata);
  const platforms = brandQueuePlatforms(brand);
  return Boolean(
    asset.id &&
      assetUrl(asset) &&
      asset.approved_for_automation === true &&
      asset.excluded_from_automation !== true &&
      asset.status !== "rejected" &&
      asset.status !== "archived" &&
      !asset.archived_at &&
      (platforms.includes(platform) || (brand === "roamly" && platform === LEGACY_FACEBOOK_PLATFORM) || metadataBrandName === brand)
  );
}

async function pickCampaignPhotoAsset(admin: SupabaseClient, brand: FacebookSocialBrand, destination: string, topic: string) {
  const { data, error } = await admin
    .from("roamly_social_media_assets")
    .select("id,platform,status,title,media_url,asset_type,source,destination,topic,approved_for_automation,excluded_from_automation,archived_at,use_count,last_used_at,width,height,duration_seconds,is_vertical,metadata,created_at")
    .eq("approved_for_automation", true)
    .eq("excluded_from_automation", false)
    .order("use_count", { ascending: true })
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) {
    console.warn("[Roamly social] campaign photo selection failed", error.message);
    return null;
  }
  const candidates = ((data || []) as SocialMediaAssetRow[]).filter((asset) =>
    isApprovedAutomationAsset(asset, brand) && assetType(asset) === "image"
  );
  return selectCampaignPhotoAsset(candidates, destination, topic);
}

// Re-exported for lib/roamly/socialAutomation.ts (transport split).
export {
  FACEBOOK_BRANDS,
  assetType,
  assetUrl,
  brandPlatform,
  brandQueuePlatforms,
  clean,
  envFirst,
  facebookBrandConfig,
  hash,
  isApprovedAutomationAsset,
  metadataBrand,
  normalizeFacebookBrand,
  numberValue,
  objectValue,
  recordAdminActivity,
  uniqueHashtags,
  validTimeZone,
  withBrandMetadata,
};
