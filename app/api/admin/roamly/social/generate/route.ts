import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { generateRoamlySocialPost, ROAMLY_SOCIAL_CONTENT_TYPES } from "@/lib/roamly/social";

function getString(value: unknown, maxLength = 500) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function getStringArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string").map((item) => item.trim()).filter(Boolean)
    : [];
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const contentType = getString(body.contentType) || ROAMLY_SOCIAL_CONTENT_TYPES[0];
  const destination = getString(body.destination, 160);
  const topic = getString(body.topic, 500);
  const affiliatePartners = getStringArray(body.affiliatePartners);
  const mediaUrl = getString(body.mediaUrl, 1000);

  const generated = await generateRoamlySocialPost({
    contentType,
    destination,
    topic,
    affiliatePartners,
    mediaUrl
  });

  return NextResponse.json({ ok: true, generated });
}
