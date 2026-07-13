import { NextRequest, NextResponse } from "next/server";
import { requireRoamlyAdmin } from "@/lib/roamly/adminGuard";
import { generateAndPublishSeoPage, ROAMLY_SEO_CONTENT_TYPES } from "@/lib/roamly/seoAutomation";

function getString(value: unknown, maxLength = 160) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export async function POST(request: NextRequest) {
  const guard = await requireRoamlyAdmin();
  if (!guard.ok) return guard.response;

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const contentType = getString(body.contentType) || ROAMLY_SEO_CONTENT_TYPES[0];
  const topic = getString(body.topic, 180);
  const queueSocialPost = body.queueSocialPost !== false;

  const result = await generateAndPublishSeoPage(guard.admin, {
    contentType,
    topic,
    actorEmail: guard.user.email || guard.user.id,
    queueSocialPost
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}
