import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  generateFacebookQueue,
  getFacebookAutomationSummaries,
  getFacebookAutomationSummary,
  queueFacebookRuntimeProofReel,
  refillFacebookQueue,
  refillFacebookQueues,
  retryFailedFacebookPosts,
  runFacebookAutomationCycle,
  runFacebookAutomationForAllBrands,
  saveFacebookAutomationSettings,
  type FacebookSocialBrand
} from "@/lib/roamly/socialAutomation";

const SOCIAL_BRANDS = ["roamly", "reviewintel"] as const satisfies FacebookSocialBrand[];

function authorized(request: NextRequest) {
  const secret = (process.env.ROAMLY_SOCIAL_CRON_SECRET || process.env.CRON_SECRET || "").trim();
  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice("Bearer ".length).trim() : "";
  return Boolean(secret && token && token === secret);
}

function normalizeBrand(value: unknown): FacebookSocialBrand | undefined {
  const raw = typeof value === "string" ? value.trim().toLowerCase().replace(/[^a-z0-9]/g, "") : "";
  if (raw === "roamly") return "roamly";
  if (raw === "reviewintel" || raw === "reviewinsight") return "reviewintel";
  return undefined;
}

function brandPlatforms(brand: FacebookSocialBrand) {
  return brand === "roamly" ? ["facebook", "facebook_roamly"] : ["facebook_reviewintel"];
}

async function generateForAllBrands(admin: SupabaseClient, count: number) {
  const results = await Promise.all(
    SOCIAL_BRANDS.map((brand) => generateFacebookQueue(admin, { count, actorEmail: "cron_maintenance", source: "cron", brand }))
  );
  return {
    ok: results.every((result) => result.ok),
    brands: Object.fromEntries(results.map((result) => [result.brand, result])),
    created: results.reduce((sum, result) => sum + result.created, 0),
    scheduled: results.reduce((sum, result) => sum + result.scheduled, 0)
  };
}

async function saveSettingsForAllBrands(
  admin: SupabaseClient,
  settings: Parameters<typeof saveFacebookAutomationSettings>[1]
) {
  const results = await Promise.all(
    SOCIAL_BRANDS.map((brand) => saveFacebookAutomationSettings(admin, settings, "cron_maintenance", brand))
  );
  return {
    ok: results.every((result) => result.ok),
    brands: Object.fromEntries(SOCIAL_BRANDS.map((brand, index) => [brand, results[index]]))
  };
}

async function retryFailuresForAllBrands(admin: SupabaseClient) {
  const results = await Promise.all(SOCIAL_BRANDS.map((brand) => retryFailedFacebookPosts(admin, "cron_maintenance", brand)));
  return {
    ok: results.every((result) => result.ok),
    brands: Object.fromEntries(results.map((result) => [result.brand, result])),
    retried: results.reduce((sum, result) => sum + ("retried" in result ? result.retried || 0 : 0), 0)
  };
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
  const brand = normalizeBrand(typeof body.brand === "string" ? body.brand : request.nextUrl.searchParams.get("brand"));

  if (action === "status") {
    const [summaries, summary, duplicateCaptions, duplicateHooks, duplicateJobs, affiliateMissingDisclosure] = await Promise.all([
      getFacebookAutomationSummaries(admin),
      getFacebookAutomationSummary(admin, brand || "roamly"),
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
      summaries,
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
    const result = brand
      ? await generateFacebookQueue(admin, { count: 100, actorEmail: "cron_maintenance", source: "cron", brand })
      : await generateForAllBrands(admin, 100);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "pause") {
    const result = brand
      ? await saveFacebookAutomationSettings(admin, { paused: true }, "cron_maintenance", brand)
      : await saveSettingsForAllBrands(admin, { paused: true });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "resume") {
    const result = brand
      ? await saveFacebookAutomationSettings(admin, { paused: false }, "cron_maintenance", brand)
      : await saveSettingsForAllBrands(admin, { paused: false });
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "retry_failures") {
    const result = brand
      ? await retryFailedFacebookPosts(admin, "cron_maintenance", brand)
      : await retryFailuresForAllBrands(admin);
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "refill_queue") {
    const result = brand ? await refillFacebookQueue(admin, "cron_maintenance", brand) : await refillFacebookQueues(admin, "cron_maintenance");
    return NextResponse.json(result, { status: result.ok ? 200 : 500 });
  }

  if (action === "proof_reel") {
    if (!brand) return NextResponse.json({ ok: false, error: "A brand is required for proof_reel." }, { status: 400 });
    await admin
      .from("roamly_social_queue")
      .update({ queue_status: "archived", last_error: "Archived before a newer runtime proof Reel." })
      .in("platform", brandPlatforms(brand))
      .in("queue_status", ["scheduled", "retrying"])
      .eq("metadata->>runtimeProof", "true");
    const generated = await queueFacebookRuntimeProofReel(admin, brand, "runtime_proof");
    if (!generated.ok) {
      return NextResponse.json({ ok: false, brand, generated, error: generated.error || "No proof queue item was generated." }, { status: 500 });
    }

    const queueId = generated.queueId;
    const dueAt = new Date(Date.now() - 1000).toISOString();
    await Promise.all([
      admin.from("roamly_social_queue").update({ scheduled_for: dueAt, retry_after: null, queue_status: "scheduled" }).eq("id", queueId),
      admin.from("roamly_scheduled_posts").update({ scheduled_for: dueAt, status: "scheduled" }).eq("queue_id", queueId),
      admin.from("roamly_publishing_jobs").update({ scheduled_for: dueAt, job_status: "scheduled" }).eq("queue_id", queueId)
    ]);

    const result = await runFacebookAutomationCycle(admin, { trigger: "cron", brand, force: true, limit: 1 });
    const [processingLogs, finalQueue, attempts] = await Promise.all([
      admin
        .from("roamly_facebook_media_processing")
        .select("*")
        .eq("queue_id", queueId)
        .order("created_at", { ascending: true }),
      admin
        .from("roamly_social_queue")
        .select("id,platform,queue_status,facebook_post_id,facebook_reel_id,facebook_media_id,facebook_url,published_at,attempt_count,last_error,meta_response,metadata")
        .eq("id", queueId)
        .maybeSingle(),
      admin
        .from("roamly_publishing_attempts")
        .select("id,platform,attempt_number,status,temporary_failure,facebook_post_id,facebook_reel_id,facebook_media_id,facebook_url,error_message,meta_response,finished_at")
        .eq("queue_id", queueId)
        .order("attempt_number", { ascending: true })
    ]);

    const ok = result.published === 1 && finalQueue.data?.queue_status === "published" && Boolean(finalQueue.data?.facebook_reel_id);
    const proofError = ok ? null : finalQueue.data?.last_error || result.blockingIssues?.[0] || "Proof Reel was not published.";
    let finalQueueData = finalQueue.data || null;
    if (!ok) {
      await Promise.all([
        admin
          .from("roamly_social_queue")
          .update({
            queue_status: "archived",
            retry_after: null,
            processing_lock_token: null,
            processing_locked_at: null,
            last_error: proofError
          })
          .eq("id", queueId),
        admin.from("roamly_scheduled_posts").update({ status: "archived" }).eq("queue_id", queueId),
        admin.from("roamly_publishing_jobs").update({ job_status: "archived", last_error: proofError }).eq("queue_id", queueId)
      ]);
      const refreshed = await admin
        .from("roamly_social_queue")
        .select("id,platform,queue_status,facebook_post_id,facebook_reel_id,facebook_media_id,facebook_url,published_at,attempt_count,last_error,meta_response,metadata")
        .eq("id", queueId)
        .maybeSingle();
      finalQueueData = refreshed.data || finalQueueData;
    }

    return NextResponse.json(
      {
        ok,
        brand,
        queueId,
        generated,
        result,
        processingLogs: processingLogs.data || [],
        attempts: attempts.data || [],
        finalQueue: finalQueueData,
        error: proofError
      },
      { status: ok ? 200 : 500 }
    );
  }

  const result = brand
    ? await runFacebookAutomationCycle(admin, { trigger: "cron", brand })
    : await runFacebookAutomationForAllBrands(admin, { trigger: "cron" });
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export async function GET(request: NextRequest) {
  return handle(request);
}

export async function POST(request: NextRequest) {
  return handle(request);
}
