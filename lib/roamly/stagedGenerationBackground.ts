import { after } from "next/server";
import { logGenerationDiagnostic, getPublicSupabaseHost } from "@/lib/roamly/generationDiagnostics";

export function getGenerationWorkerSecret() {
  return (process.env.ROAMLY_GENERATION_CRON_SECRET || process.env.CRON_SECRET || "").trim();
}

function siteUrl(origin?: string | null) {
  if (origin && /^https?:\/\//i.test(origin)) return origin.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "https://roamlyhq.com";
}

export function scheduleStagedGenerationAdvance(params: {
  tripId: string;
  origin?: string | null;
  reason: string;
  requestId?: string;
}) {
  const secret = getGenerationWorkerSecret();
  if (!secret) {
    logGenerationDiagnostic("staged_generation_background_schedule_skipped", {
      requestId: params.requestId,
      tripId: params.tripId,
      route: "stagedGenerationBackground",
      supabaseHost: getPublicSupabaseHost(),
      reason: params.reason,
      errorCode: "GENERATION_CRON_SECRET_MISSING"
    });
    return;
  }

  const url = `${siteUrl(params.origin)}/api/cron/roamly-itinerary-generation`;
  after(async () => {
    await fetch(url, {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        tripId: params.tripId,
        reason: params.reason,
        requestId: params.requestId || null
      }),
      cache: "no-store"
    }).catch((error) => {
      logGenerationDiagnostic("staged_generation_background_trigger_failed", {
        requestId: params.requestId,
        tripId: params.tripId,
        route: "stagedGenerationBackground",
        supabaseHost: getPublicSupabaseHost(),
        reason: params.reason,
        errorCode: error instanceof Error ? error.name : "BACKGROUND_TRIGGER_FAILED"
      });
    });
  });
}
