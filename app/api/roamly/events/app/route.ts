import { NextRequest, NextResponse } from "next/server";
import { recordAppEvent } from "@/lib/roamly/events";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  analyticsReferrerHost,
  sanitizeAnalyticsEventMetadata,
  sanitizeAnalyticsEventType,
  sanitizeAnalyticsLanguage,
  sanitizeAnalyticsPath,
  sanitizeAnalyticsPlatform,
  sanitizeAnalyticsVisitorKey
} from "@/lib/roamly/analyticsPrivacy";

function deviceType(userAgent: string) {
  if (/Mobi|Android|iPhone/i.test(userAgent)) return "mobile";
  if (/iPad|Tablet/i.test(userAgent)) return "tablet";
  return "desktop";
}

function browser(userAgent: string) {
  if (/Edg/i.test(userAgent)) return "Edge";
  if (/Chrome/i.test(userAgent)) return "Chrome";
  if (/Safari/i.test(userAgent)) return "Safari";
  if (/Firefox/i.test(userAgent)) return "Firefox";
  return "Other";
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
  const origin = request.headers.get("origin");
  if (contentType !== "application/json" || (origin && origin !== request.nextUrl.origin) || request.headers.get("sec-fetch-site") === "cross-site") {
    return NextResponse.json({ ok: false, error: "Invalid analytics request." }, { status: 400 });
  }
  const declaredLength = Number(request.headers.get("content-length") || 0);
  if (declaredLength > 8_192) return NextResponse.json({ ok: false, error: "Analytics request is too large." }, { status: 413 });
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > 8_192) return NextResponse.json({ ok: false, error: "Analytics request is too large." }, { status: 413 });
  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid analytics request." }, { status: 400 });
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ ok: false, error: "Invalid analytics request." }, { status: 400 });
  }
  const body = parsedBody as Record<string, unknown>;
  const eventType = sanitizeAnalyticsEventType(body.eventType);
  if (!eventType) return NextResponse.json({ ok: true, tracked: false });

  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const { data } = await supabase.auth.getUser();
  const writer = createSupabaseAdminClient() || supabase;
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = request.headers.get("referer") || "";

  const result = await recordAppEvent(writer, {
    userId: data.user?.id || null,
    visitorKey: sanitizeAnalyticsVisitorKey(body.visitorKey),
    eventType,
    path: sanitizeAnalyticsPath(body.path) || sanitizeAnalyticsPath(body.url),
    url: null,
    title: null,
    referrer: null,
    referrerHost: analyticsReferrerHost(referrer),
    deviceType: deviceType(userAgent),
    platform: sanitizeAnalyticsPlatform(body.platform),
    browser: browser(userAgent),
    metadata: { ...sanitizeAnalyticsEventMetadata(body.metadata), language: sanitizeAnalyticsLanguage(body.language) }
  });

  if (result.error) {
    console.error("[Roamly analytics] app event failed", result.error.message);
    return NextResponse.json({ ok: true, tracked: false });
  }
  return NextResponse.json({ ok: true });
}
