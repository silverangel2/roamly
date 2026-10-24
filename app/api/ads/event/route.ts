import { NextResponse } from "next/server";
import { parseHouseAdEvent } from "@/lib/houseAds";
import { recordHouseAdEvent } from "@/lib/houseAdEvents";

/**
 * House Ads — impression intake. Bots ignored, one impression per visitor
 * per creative per 30 minutes per instance, cheap per-IP limiter, and the
 * write is fail-soft (an event can never break the page that showed the
 * card). Mirrors ReviewIntel's sponsor-event counting rules.
 */
const BOT_UA = /bot|crawler|spider|slurp|headless|preview|facebookexternalhit|curl|wget|python-requests|lighthouse/i;
const seen = new Map<string, number>();
const ipHits = new Map<string, number[]>();
const DEDUPE_MS = 30 * 60 * 1000;

function requestIp(request: Request) {
  const forwarded = request.headers.get("x-forwarded-for") || "";
  return forwarded.split(",")[0].trim() || "unknown";
}

export async function POST(request: Request) {
  const ip = requestIp(request);
  const t0 = Date.now();
  const hits = (ipHits.get(ip) || []).filter((t) => t > t0 - 600_000);
  hits.push(t0);
  ipHits.set(ip, hits);
  if (hits.length > 120) return NextResponse.json({ ok: true, ignored: "rate_limited" });

  const body = await request.json().catch(() => null);
  const event = parseHouseAdEvent(body);
  if (!event) return NextResponse.json({ error: "Invalid house ad event." }, { status: 400 });

  const ua = request.headers.get("user-agent") || "";
  if (!ua || BOT_UA.test(ua)) return NextResponse.json({ ok: true, ignored: "bot" });

  const key = `${event.creativeId}|${ip}|${ua.slice(0, 80)}`;
  const now = Date.now();
  if ((seen.get(key) || 0) > now - DEDUPE_MS) return NextResponse.json({ ok: true, ignored: "duplicate" });
  seen.set(key, now);
  if (seen.size > 50_000) for (const [k, t] of seen) if (t < now - DEDUPE_MS) seen.delete(k);

  await recordHouseAdEvent(event);
  return NextResponse.json({ ok: true });
}
