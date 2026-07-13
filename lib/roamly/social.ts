import OpenAI from "openai";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ROAMLY_AFFILIATE_DISCLOSURE,
  ROAMLY_PUBLIC_DOMAIN
} from "@/lib/roamly/emailTemplates";

export const ROAMLY_SOCIAL_CONTENT_TYPES = [
  "Destination inspiration posts",
  "Budget trip tips",
  "Multi-city itinerary ideas",
  "Travel checklist posts",
  "Amazon travel essentials",
  "Stay22 hotel/stay posts",
  "Klook tours/tickets/activity posts",
  "Travelpayouts flight/travel posts",
  "Airalo eSIM/roaming posts",
  "Live Companion feature posts",
  "Cross-border reminders",
  "Travel document/payment reminders"
] as const;

export const ROAMLY_SOCIAL_AFFILIATE_PARTNERS = ["Amazon", "Stay22", "Klook", "Travelpayouts", "Airalo"] as const;

export type RoamlySocialPlatform = "facebook" | "instagram" | "tiktok" | "linkedin" | "multi";
export type RoamlySocialStatus = "draft" | "scheduled" | "approved" | "posted" | "failed";

export type RoamlyGeneratedSocialPost = {
  title: string;
  facebookCaption: string;
  instagramCaption: string;
  tiktokScript: string;
  linkedinPost: string;
  hashtags: string[];
  cta: string;
  affiliateDisclosure: string;
  source: "openai" | "fallback";
};

export type RoamlySocialDraftInput = {
  contentType: string;
  destination?: string;
  topic?: string;
  affiliatePartners?: string[];
  mediaUrl?: string;
  scheduledFor?: string | null;
};

export type RoamlySocialPostRow = {
  id: string;
  platform: string | null;
  status: string;
  title: string | null;
  caption: string | null;
  hashtags: string[] | null;
  media_url: string | null;
  destination: string | null;
  topic: string | null;
  scheduled_for: string | null;
  posted_at: string | null;
  external_post_id: string | null;
  error_message: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

type SocialPostAttempt = {
  platform: "facebook" | "instagram";
  ok: boolean;
  status: string;
  externalPostId?: string;
  error?: string;
};

function clean(value?: string | null) {
  return (value || "").trim();
}

function enabled(value?: string | null) {
  return /^(true|1|yes|on)$/i.test(clean(value));
}

function disabled(value?: string | null) {
  return /^(false|0|no|off)$/i.test(clean(value));
}

function getOpenAIClient() {
  const apiKey = process.env.OPENAI_API_KEY;
  return apiKey ? new OpenAI({ apiKey }) : null;
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.map(clean).filter(Boolean))];
}

function normalizeContentType(value: string) {
  const match = ROAMLY_SOCIAL_CONTENT_TYPES.find((item) => item.toLowerCase() === clean(value).toLowerCase());
  return match || ROAMLY_SOCIAL_CONTENT_TYPES[0];
}

function normalizeAffiliatePartners(values?: string[]) {
  const allowed = new Set(ROAMLY_SOCIAL_AFFILIATE_PARTNERS.map((item) => item.toLowerCase()));
  return uniqueStrings(values || []).filter((item) => allowed.has(item.toLowerCase()));
}

function hasAffiliateLinks(input: Pick<RoamlySocialDraftInput, "affiliatePartners" | "contentType">) {
  const partners = normalizeAffiliatePartners(input.affiliatePartners);
  if (partners.length) return true;
  return /\b(amazon|stay22|klook|travelpayouts|airalo|affiliate|partner)\b/i.test(input.contentType);
}

export function getRoamlySocialEnvStatus() {
  const facebookEnabled = enabled(process.env.ROAMLY_SOCIAL_FACEBOOK_ENABLED);
  const instagramEnabled = enabled(process.env.ROAMLY_SOCIAL_INSTAGRAM_ENABLED);
  const autoPostEnabled = enabled(process.env.ROAMLY_SOCIAL_AUTOPOST_ENABLED);
  const requireApproval = !disabled(process.env.ROAMLY_SOCIAL_REQUIRE_APPROVAL || "true");
  const pageIdConfigured = Boolean(clean(process.env.ROAMLY_META_PAGE_ID));
  const tokenConfigured = Boolean(clean(process.env.ROAMLY_META_ACCESS_TOKEN));
  const instagramAccountConfigured = Boolean(clean(process.env.ROAMLY_INSTAGRAM_BUSINESS_ACCOUNT_ID));

  return {
    autoPostEnabled,
    requireApproval,
    cronSecretConfigured: Boolean(clean(process.env.ROAMLY_SOCIAL_CRON_SECRET)),
    facebookEnabled,
    instagramEnabled,
    facebookConnected: facebookEnabled && pageIdConfigured && tokenConfigured,
    instagramConnected: instagramEnabled && instagramAccountConfigured && tokenConfigured,
    pageIdConfigured,
    tokenConfigured,
    instagramAccountConfigured,
    facebookStatusLabel: facebookEnabled && pageIdConfigured && tokenConfigured ? "Facebook connected" : "Facebook not connected",
    instagramStatusLabel:
      instagramEnabled && instagramAccountConfigured && tokenConfigured ? "Instagram connected" : "Instagram not connected"
  };
}

export function isSocialTableMissingError(error: { message?: string } | null | undefined) {
  const message = error?.message || "";
  return message.includes("schema cache") || message.includes("does not exist") || message.includes("relation");
}

function fallbackTopic(input: RoamlySocialDraftInput) {
  const destination = clean(input.destination) || "your next trip";
  const topic = clean(input.topic);
  if (topic) return topic;
  if (/budget/i.test(input.contentType)) return `how to keep a ${destination} trip realistic before booking`;
  if (/checklist|document|payment/i.test(input.contentType)) return `what to confirm before leaving for ${destination}`;
  if (/live companion/i.test(input.contentType)) return `how Roamly helps during travel days in ${destination}`;
  if (/multi-city/i.test(input.contentType)) return `how to connect stops without overpacking the itinerary`;
  return `smarter planning for ${destination}`;
}

function hashtagBase(destination: string) {
  return uniqueStrings([
    "Roamly",
    "TravelPlanning",
    "SmartTravel",
    "TravelTips",
    destination.replace(/[^A-Za-z0-9]/g, "")
  ]).slice(0, 8);
}

export function generateFallbackSocialPost(input: RoamlySocialDraftInput): RoamlyGeneratedSocialPost {
  const contentType = normalizeContentType(input.contentType);
  const destination = clean(input.destination) || "your next destination";
  const topic = fallbackTopic({ ...input, contentType });
  const affiliateDisclosure = hasAffiliateLinks({ ...input, contentType }) ? ROAMLY_AFFILIATE_DISCLOSURE : "";
  const cta = `Plan smarter at ${ROAMLY_PUBLIC_DOMAIN}.`;
  const base = `A better ${destination} trip starts before you book. Roamly helps compare the route, budget, bookings, reminders, and live travel details so the itinerary feels realistic instead of rushed.`;
  const tip = `Travel-agent tip: ${topic.charAt(0).toUpperCase()}${topic.slice(1)}.`;

  return {
    title: `${destination} travel planning idea`,
    facebookCaption: [base, tip, cta, affiliateDisclosure].filter(Boolean).join("\n\n"),
    instagramCaption: [base, tip, cta, affiliateDisclosure].filter(Boolean).join("\n\n"),
    tiktokScript: [
      `Hook: Planning ${destination}? Check this before you book.`,
      `Scene 1: Show the route, dates, and budget together.`,
      `Scene 2: Add bookings, activities, and travel-day reminders.`,
      `Scene 3: Use Roamly to keep the plan practical while you travel.`,
      `CTA: ${cta}`,
      affiliateDisclosure
    ]
      .filter(Boolean)
      .join("\n"),
    linkedinPost: [
      `Travel planning works better when the itinerary, budget, bookings, and day-of support are connected.`,
      `For ${destination}, Roamly can help travelers think through ${topic} with a premium, practical planning flow.`,
      cta,
      affiliateDisclosure
    ]
      .filter(Boolean)
      .join("\n\n"),
    hashtags: hashtagBase(destination),
    cta,
    affiliateDisclosure,
    source: "fallback"
  };
}

function parseGenerated(value: string, fallback: RoamlyGeneratedSocialPost): RoamlyGeneratedSocialPost {
  try {
    const parsed = JSON.parse(value) as Partial<RoamlyGeneratedSocialPost>;
    return {
      title: clean(parsed.title) || fallback.title,
      facebookCaption: clean(parsed.facebookCaption) || fallback.facebookCaption,
      instagramCaption: clean(parsed.instagramCaption) || fallback.instagramCaption,
      tiktokScript: clean(parsed.tiktokScript) || fallback.tiktokScript,
      linkedinPost: clean(parsed.linkedinPost) || fallback.linkedinPost,
      hashtags: Array.isArray(parsed.hashtags) ? uniqueStrings(parsed.hashtags.filter((item): item is string => typeof item === "string")).slice(0, 12) : fallback.hashtags,
      cta: clean(parsed.cta) || fallback.cta,
      affiliateDisclosure: clean(parsed.affiliateDisclosure) || fallback.affiliateDisclosure,
      source: "openai"
    };
  } catch {
    return fallback;
  }
}

export async function generateRoamlySocialPost(input: RoamlySocialDraftInput): Promise<RoamlyGeneratedSocialPost> {
  const contentType = normalizeContentType(input.contentType);
  const affiliatePartners = normalizeAffiliatePartners(input.affiliatePartners);
  const fallback = generateFallbackSocialPost({ ...input, contentType, affiliatePartners });
  const client = getOpenAIClient();
  if (!client) return fallback;

  try {
    const completion = await client.chat.completions.create({
      model: process.env.OPENAI_SOCIAL_MODEL || process.env.OPENAI_MODEL || "gpt-4o-mini",
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You create premium, helpful, travel-agent style social posts for Roamly. Avoid spam, hype, fake urgency, and unsupported claims. Return only JSON."
        },
        {
          role: "user",
          content: JSON.stringify({
            brand: "Roamly",
            domain: ROAMLY_PUBLIC_DOMAIN,
            product:
              "AI-powered itineraries, budget checks, booking organization, and Live Trip Companion for smarter travel planning.",
            contentType,
            destination: clean(input.destination),
            topic: clean(input.topic),
            affiliatePartners,
            requiredFields: [
              "title",
              "facebookCaption",
              "instagramCaption",
              "tiktokScript",
              "linkedinPost",
              "hashtags",
              "cta",
              "affiliateDisclosure"
            ],
            affiliateDisclosure: hasAffiliateLinks({ contentType, affiliatePartners }) ? ROAMLY_AFFILIATE_DISCLOSURE : "",
            tone: "premium, helpful, travel-agent style, not spammy"
          })
        }
      ],
      temperature: 0.7
    });

    return parseGenerated(completion.choices[0]?.message?.content || "", fallback);
  } catch (error) {
    console.error("[Roamly social] generation failed", error instanceof Error ? error.message : error);
    return fallback;
  }
}

export async function saveRoamlySocialDraft({
  admin,
  generated,
  input,
  status = "draft",
  createdBy
}: {
  admin: SupabaseClient;
  generated: RoamlyGeneratedSocialPost;
  input: RoamlySocialDraftInput;
  status?: RoamlySocialStatus;
  createdBy?: string | null;
}) {
  const affiliatePartners = normalizeAffiliatePartners(input.affiliatePartners);
  const { data, error } = await admin
    .from("roamly_social_posts")
    .insert({
      platform: "multi",
      status,
      title: generated.title,
      caption: generated.facebookCaption,
      hashtags: generated.hashtags,
      media_url: clean(input.mediaUrl) || null,
      destination: clean(input.destination) || null,
      topic: clean(input.topic) || normalizeContentType(input.contentType),
      scheduled_for: input.scheduledFor || null,
      metadata: {
        generated,
        contentType: normalizeContentType(input.contentType),
        affiliatePartners,
        createdBy: createdBy || null
      }
    })
    .select("*")
    .single();

  if (error) return { ok: false as const, error };

  await insertSocialHistory(admin, {
    socialPostId: data.id,
    action: status === "scheduled" ? "scheduled" : "draft_saved",
    status,
    generated,
    input,
    metadata: { createdBy: createdBy || null }
  });

  return { ok: true as const, post: data as RoamlySocialPostRow };
}

export async function insertSocialHistory(
  admin: SupabaseClient,
  {
    socialPostId,
    action,
    status,
    generated,
    input,
    externalPostId,
    errorMessage,
    metadata = {}
  }: {
    socialPostId?: string | null;
    action: string;
    status: string;
    generated: RoamlyGeneratedSocialPost;
    input: RoamlySocialDraftInput;
    externalPostId?: string | null;
    errorMessage?: string | null;
    metadata?: Record<string, unknown>;
  }
) {
  const { error } = await admin.from("roamly_social_post_history").insert({
    social_post_id: socialPostId || null,
    action,
    platform: "multi",
    status,
    title: generated.title,
    caption: generated.facebookCaption,
    hashtags: generated.hashtags,
    media_url: clean(input.mediaUrl) || null,
    destination: clean(input.destination) || null,
    topic: clean(input.topic) || normalizeContentType(input.contentType),
    scheduled_for: input.scheduledFor || null,
    posted_at: status === "posted" ? new Date().toISOString() : null,
    external_post_id: externalPostId || null,
    error_message: errorMessage || null,
    metadata
  });

  if (error && !isSocialTableMissingError(error)) {
    console.error("[Roamly social] history insert failed", error.message);
  }
}

function generatedFromRow(row: RoamlySocialPostRow): RoamlyGeneratedSocialPost {
  const generated = row.metadata?.generated;
  if (generated && typeof generated === "object") {
    return {
      ...generateFallbackSocialPost({
        contentType: clean(row.topic) || ROAMLY_SOCIAL_CONTENT_TYPES[0],
        destination: row.destination || "",
        topic: row.topic || ""
      }),
      ...(generated as Partial<RoamlyGeneratedSocialPost>)
    };
  }
  return {
    ...generateFallbackSocialPost({
      contentType: clean(row.topic) || ROAMLY_SOCIAL_CONTENT_TYPES[0],
      destination: row.destination || "",
      topic: row.topic || ""
    }),
    title: row.title || "Roamly social post",
    facebookCaption: row.caption || "",
    hashtags: Array.isArray(row.hashtags) ? row.hashtags : []
  };
}

async function graphPost(path: string, params: Record<string, string>) {
  const response = await fetch(`https://graph.facebook.com/${path.replace(/^\//, "")}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(params)
  });
  const body = (await response.json().catch(() => ({}))) as { id?: string; error?: { message?: string } };
  if (!response.ok) throw new Error(body.error?.message || "Meta request failed.");
  return body.id || "";
}

function captionWithDisclosure(caption: string, disclosure: string) {
  if (!disclosure || caption.includes(disclosure)) return caption;
  return [caption, disclosure].filter(Boolean).join("\n\n");
}

async function postFacebook(generated: RoamlyGeneratedSocialPost, mediaUrl?: string | null) {
  const status = getRoamlySocialEnvStatus();
  if (!status.facebookConnected) return { ok: false as const, status: "skipped" as const, error: "Facebook not connected." };

  const pageId = clean(process.env.ROAMLY_META_PAGE_ID);
  const accessToken = clean(process.env.ROAMLY_META_ACCESS_TOKEN);
  const caption = captionWithDisclosure(generated.facebookCaption, generated.affiliateDisclosure);
  const id = mediaUrl
    ? await graphPost(`${pageId}/photos`, { url: mediaUrl, caption, access_token: accessToken })
    : await graphPost(`${pageId}/feed`, { message: caption, access_token: accessToken });
  return { ok: true as const, status: "posted" as const, externalPostId: id };
}

async function postInstagram(generated: RoamlyGeneratedSocialPost, mediaUrl?: string | null) {
  const status = getRoamlySocialEnvStatus();
  if (!status.instagramConnected) return { ok: false as const, status: "skipped" as const, error: "Instagram not connected." };
  if (!mediaUrl) return { ok: false as const, status: "skipped" as const, error: "Instagram posting requires media_url." };

  const instagramId = clean(process.env.ROAMLY_INSTAGRAM_BUSINESS_ACCOUNT_ID);
  const accessToken = clean(process.env.ROAMLY_META_ACCESS_TOKEN);
  const caption = captionWithDisclosure(generated.instagramCaption, generated.affiliateDisclosure);
  const creationId = await graphPost(`${instagramId}/media`, { image_url: mediaUrl, caption, access_token: accessToken });
  const postId = await graphPost(`${instagramId}/media_publish`, { creation_id: creationId, access_token: accessToken });
  return { ok: true as const, status: "posted" as const, externalPostId: postId };
}

export async function postApprovedRoamlySocialPost(admin: SupabaseClient, post: RoamlySocialPostRow) {
  const generated = generatedFromRow(post);
  const input: RoamlySocialDraftInput = {
    contentType: clean(post.topic) || ROAMLY_SOCIAL_CONTENT_TYPES[0],
    destination: post.destination || "",
    topic: post.topic || "",
    mediaUrl: post.media_url || "",
    scheduledFor: post.scheduled_for
  };
  const attempts: SocialPostAttempt[] = [];

  for (const platform of ["facebook", "instagram"] as const) {
    try {
      const result = platform === "facebook" ? await postFacebook(generated, post.media_url) : await postInstagram(generated, post.media_url);
      attempts.push({ platform, ...result });
      await insertSocialHistory(admin, {
        socialPostId: post.id,
        action: `post_${platform}`,
        status: result.ok ? "posted" : result.status,
        generated,
        input,
        externalPostId: result.ok ? result.externalPostId : null,
        errorMessage: result.ok ? null : result.error,
        metadata: { platform }
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Social post failed.";
      attempts.push({ platform, ok: false, status: "failed", error: message });
      await insertSocialHistory(admin, {
        socialPostId: post.id,
        action: `post_${platform}`,
        status: "failed",
        generated,
        input,
        errorMessage: message,
        metadata: { platform }
      });
    }
  }

  const posted = attempts.filter((attempt) => attempt.ok);
  const failed = attempts.filter((attempt) => !attempt.ok && attempt.status === "failed");
  const externalIds = posted.map((attempt) => `${attempt.platform}:${attempt.externalPostId}`).join(",");

  await admin
    .from("roamly_social_posts")
    .update({
      status: posted.length ? "posted" : failed.length ? "failed" : post.status,
      posted_at: posted.length ? new Date().toISOString() : null,
      external_post_id: externalIds || post.external_post_id,
      error_message: failed.map((attempt) => attempt.error).filter(Boolean).join(" | ") || null
    })
    .eq("id", post.id);

  return { ok: posted.length > 0, attempts };
}

export async function runRoamlySocialAutopost(admin: SupabaseClient) {
  const status = getRoamlySocialEnvStatus();

  if (!status.autoPostEnabled) {
    return { ok: true, status: "skipped", reason: "Social autopost disabled." };
  }

  const defaultInput: RoamlySocialDraftInput = {
    contentType: "Destination inspiration posts",
    destination: "Roamly travelers",
    topic: "a practical travel planning reminder"
  };

  if (status.requireApproval) {
    const generated = await generateRoamlySocialPost(defaultInput);
    const saved = await saveRoamlySocialDraft({ admin, generated, input: defaultInput, status: "draft", createdBy: "cron" });
    return {
      ok: saved.ok,
      status: saved.ok ? "draft_created" : "failed",
      reason: saved.ok ? "Approval is required, so cron created a draft only." : saved.error.message
    };
  }

  if (!status.facebookConnected && !status.instagramConnected) {
    return { ok: true, status: "skipped", reason: "Facebook not connected. Instagram not connected." };
  }

  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("roamly_social_posts")
    .select("*")
    .in("status", ["approved", "scheduled"])
    .or(`scheduled_for.is.null,scheduled_for.lte.${now}`)
    .order("scheduled_for", { ascending: true, nullsFirst: true })
    .limit(5);

  if (error && !isSocialTableMissingError(error)) {
    return { ok: false, status: "failed", reason: error.message };
  }

  let posts = (data || []) as RoamlySocialPostRow[];

  if (!posts.length) {
    const generated = await generateRoamlySocialPost(defaultInput);
    const saved = await saveRoamlySocialDraft({ admin, generated, input: defaultInput, status: "approved", createdBy: "cron" });
    posts = saved.ok ? [saved.post] : [];
  }

  const results = [];
  for (const post of posts) {
    results.push({ id: post.id, ...(await postApprovedRoamlySocialPost(admin, post)) });
  }

  return { ok: true, status: "processed", results };
}
