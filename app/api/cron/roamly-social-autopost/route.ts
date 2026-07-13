import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateFacebookQueue,
  getFacebookAutomationSummary,
  refillFacebookQueue,
  retryFailedFacebookPosts,
  runFacebookAutomationCycle,
  saveFacebookAutomationSettings
} from "@/lib/roamly/socialAutomation";

function authorized(request: NextRequest) {
  const secret = (process.env.ROAMLY_SOCIAL_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(secret && token && token === secret);
}

async function handle(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  const admin = createSupabaseAdminClient();
  if (!admin) {
    return NextResponse.json({ ok: false, error: "Supabase service role is not configured." }, { status: 503 });
  }

  const body = request.method === "POST" ? ((await request.json().catch(() => ({}))) as Record<string, unknown>) : {};
  const action = typeof body.action === "string" ? body.action : request.nextUrl.searchParams.get("action") || "run";

  if (action === "status") {
    const [summary, duplicateCaptions, duplicateHooks, duplicateJobs, affiliateMissingDisclosure] = await Promise.all([
      getFacebookAutomationSummary(admin),
      admin.from("roamly_social_drafts").select("caption_hash").not("caption_hash", "is", null).limit(1000),
      admin.from("roamly_social_drafts").select("hook_hash").not("hook_hash", "is", null).limit(1000),
      admin.from("roamly_publishing_jobs").select("idempotency_key").not("idempotency_key", "is", null).limit(1000),
      admin
        .from("roamly_social_drafts")
        .select("id", { count: "exact", head: true })
        .not("amazon_affiliate_link", "is", null)
        .or("affiliate_disclosure.is.null,affiliate_disclosure.eq.")
    ]);
    const duplicateCount = (values: Array<Record<string, unknown>> | null, key: string) => {
      const seen = new Set<unknown>();
      let duplicates = 0;
      for (const row of values || []) {
        const value = row[key];
        if (!value) continue;
        if (seen.has(value)) duplicates += 1;
        seen.add(value);
      }
      return duplicates;
    };
    const result = {
      ok: true,
      summary,
      verification: {
        duplicateCaptions: duplicateCount(duplicateCaptions.data, "caption_hash"),
        duplicateHooks: duplicateCount(duplicateHooks.data, "hook_hash"),
        duplicatePublishingJobs: duplicateCount(duplicateJobs.data, "idempotency_key"),
        affiliateMissingDisclosure: affiliateMissingDisclosure.count || 0,
        tablesReady: summary.tableReady,
        publishingReady: summary.env.publishingReady,
        blockingIssues: summary.env.blockingIssues
      }
    };
    return NextResponse.json(result);
  }

  if (action === "generate_100") {
    const result = await generateFacebookQueue(admin, { count: 100, actorEmail: "cron_maintenance", source: "cron" });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "pause") {
    const result = await saveFacebookAutomationSettings(admin, { paused: true }, "cron_maintenance");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "resume") {
    const result = await saveFacebookAutomationSettings(admin, { paused: false }, "cron_maintenance");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "retry_failures") {
    const result = await retryFailedFacebookPosts(admin, "cron_maintenance");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "refill_queue") {
    const result = await refillFacebookQueue(admin, "cron_maintenance");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  const result = await runFacebookAutomationCycle(admin, { trigger: "cron" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
