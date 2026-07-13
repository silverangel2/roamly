import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import {
  generateFallbackSocialPost,
  isSocialTableMissingError,
  saveRoamlySocialDraft,
  type RoamlyGeneratedSocialPost,
  type RoamlySocialStatus
} from "@/lib/roamly/social";

function getString(value: unknown, maxLength = 1000) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

function getGenerated(value: unknown): RoamlyGeneratedSocialPost | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Partial<RoamlyGeneratedSocialPost>;
  if (typeof record.facebookCaption !== "string" || typeof record.instagramCaption !== "string") return null;
  return {
    title: getString(record.title, 180) || "Roamly social draft",
    facebookCaption: getString(record.facebookCaption, 5000),
    instagramCaption: getString(record.instagramCaption, 5000),
    tiktokScript: getString(record.tiktokScript, 5000),
    linkedinPost: getString(record.linkedinPost, 5000),
    hashtags: getStringArray(record.hashtags).slice(0, 16),
    cta: getString(record.cta, 500),
    affiliateDisclosure: getString(record.affiliateDisclosure, 500),
    source: record.source === "openai" ? "openai" : "fallback"
  };
}

function getStatus(value: unknown): RoamlySocialStatus {
  const status = getString(value, 40);
  return status === "scheduled" || status === "approved" || status === "posted" || status === "failed" ? status : "draft";
}

export async function GET() {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const { data, error } = await guard.admin
    .from("roamly_social_posts")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(80);

  if (error) {
    if (isSocialTableMissingError(error)) return NextResponse.json({ ok: true, posts: [], tableReady: false });
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, posts: data || [], tableReady: true });
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const input = {
    contentType: getString(body.contentType, 160) || "Destination inspiration posts",
    destination: getString(body.destination, 160),
    topic: getString(body.topic, 500),
    affiliatePartners: getStringArray(body.affiliatePartners),
    mediaUrl: getString(body.mediaUrl, 1000),
    scheduledFor: getString(body.scheduledFor, 80) || null
  };
  const generated = getGenerated(body.generated) || generateFallbackSocialPost(input);
  const status = input.scheduledFor ? "scheduled" : getStatus(body.status);

  const saved = await saveRoamlySocialDraft({
    admin: guard.admin,
    generated,
    input,
    status,
    createdBy: guard.user.email || guard.user.id
  });

  if (!saved.ok) {
    if (isSocialTableMissingError(saved.error)) {
      return NextResponse.json({ ok: false, error: "Roamly social tables are not ready.", tableReady: false }, { status: 503 });
    }
    return NextResponse.json({ ok: false, error: saved.error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, post: saved.post, tableReady: true });
}
