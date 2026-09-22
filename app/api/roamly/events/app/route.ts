import { NextRequest, NextResponse } from "next/server";
import { recordAppEvent } from "@/lib/roamly/events";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { analyticsReferrerHost, sanitizeAnalyticsPath, sanitizeAnalyticsVisitorKey } from "@/lib/roamly/analyticsPrivacy";

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
  const supabase = await createSupabaseServerClient();
  if (!supabase) return NextResponse.json({ ok: false, error: "Supabase is not configured." }, { status: 503 });

  const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
  const { data } = await supabase.auth.getUser();
  const writer = createSupabaseAdminClient() || supabase;
  const userAgent = request.headers.get("user-agent") || "";
  const referrer = typeof body.referrer === "string" ? body.referrer : request.headers.get("referer") || "";
  const metadata =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : {};

  const result = await recordAppEvent(writer, {
    userId: data.user?.id || null,
    visitorKey: sanitizeAnalyticsVisitorKey(body.visitorKey),
    eventType: typeof body.eventType === "string" ? body.eventType : "page_view",
    path: sanitizeAnalyticsPath(body.path) || sanitizeAnalyticsPath(body.url),
    url: null,
    title: typeof body.title === "string" ? body.title.trim().slice(0, 160) : null,
    referrer: null,
    referrerHost: analyticsReferrerHost(referrer),
    deviceType: deviceType(userAgent),
    platform: typeof body.platform === "string" ? body.platform : null,
    browser: browser(userAgent),
    metadata: {
      ...metadata,
      language: typeof body.language === "string" ? body.language : null
    }
  });

  if (result.error) {
    console.error("[Roamly analytics] app event failed", result.error.message);
    return NextResponse.json({ ok: true, tracked: false });
  }
  return NextResponse.json({ ok: true });
}
