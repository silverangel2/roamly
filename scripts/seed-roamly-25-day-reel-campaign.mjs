import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const campaignId = "roamly-premium-reels-2026-08";
const platform = "facebook_roamly";
const brand = "roamly";
const planPath = path.join(root, "content/social/roamly-25-day-reel-campaign/roamly-25-day-reel-campaign-2026-08-04.json");
const seededPlanPath = path.join(root, "content/social/roamly-25-day-reel-campaign/roamly-25-day-reel-campaign-2026-08-04.seeded.json");
const summaryPath = path.join(root, "content/social/roamly-25-day-reel-campaign/validation/seed-summary.json");
const defaultPublicDomain = "https://roamlyhq.com";
const defaultBucket = "roamly-social-public";

function clean(value) {
  return String(value || "").trim();
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvFile(file) {
  let text = "";
  try {
    text = await readFile(file, "utf8");
  } catch {
    return;
  }

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const [, key, value] = match;
    if (process.env[key] === undefined) process.env[key] = parseEnvValue(value);
  }
}

function hash(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}

function uuidFor(value) {
  const bytes = createHash("sha256").update(String(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function slugFromPost(post) {
  return post.reelAssetFilename
    .replace(/^roamly-2026-08-day-\d{2}-/, "")
    .replace(/\.mp4$/, "");
}

function mediaAssetIdFor(dayNumber) {
  return uuidFor(`${campaignId}:media:${String(dayNumber).padStart(2, "0")}`);
}

function draftIdFor(dayNumber) {
  return uuidFor(`${campaignId}:draft:${String(dayNumber).padStart(2, "0")}`);
}

function queueIdFor(dayNumber) {
  return uuidFor(`${campaignId}:queue:${String(dayNumber).padStart(2, "0")}`);
}

function scheduledPostIdFor(dayNumber) {
  return uuidFor(`${campaignId}:scheduled-post:${String(dayNumber).padStart(2, "0")}`);
}

function publishingJobIdFor(dayNumber) {
  return uuidFor(`${campaignId}:publishing-job:${String(dayNumber).padStart(2, "0")}`);
}

function facebookProcessingIdFor(dayNumber) {
  return uuidFor(`${campaignId}:facebook-processing:${String(dayNumber).padStart(2, "0")}`);
}

function qualityCheckIdFor(dayNumber) {
  return uuidFor(`${campaignId}:quality-check:${String(dayNumber).padStart(2, "0")}`);
}

function asHashtagNames(post) {
  return post.captionHashtags.map((tag) => tag.replace(/^#/, "")).filter(Boolean);
}

function storageBucketName() {
  return (
    clean(process.env.ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET) ||
    clean(process.env.SUPABASE_PUBLIC_SOCIAL_MEDIA_BUCKET) ||
    clean(process.env.SUPABASE_SOCIAL_MEDIA_BUCKET) ||
    defaultBucket
  );
}

function cleanSupabaseUrl(value) {
  return value.replace(/\/$/, "");
}

function storageHeaders(serviceKey, extra = {}) {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json",
    ...extra
  };
}

async function responseDetail(response) {
  const text = await response.text().catch(() => "");
  if (!text) return "";
  try {
    const data = JSON.parse(text);
    return String(data.message || data.error || text);
  } catch {
    return text;
  }
}

async function ensurePublicBucket({ supabaseUrl, serviceKey, storageBucket }) {
  if (!storageBucket) throw new Error("Public social media storage bucket is required.");
  if (["roamly-private", "review-screenshots", "reviewintel-media"].includes(storageBucket)) {
    throw new Error(`Refusing to upload Roamly public Reels to reserved bucket ${storageBucket}.`);
  }

  const bucketUrl = `${supabaseUrl}/storage/v1/bucket/${encodeURIComponent(storageBucket)}`;
  const payload = {
    public: true,
    file_size_limit: 100_000_000,
    allowed_mime_types: ["video/mp4"]
  };

  const lookup = await fetch(bucketUrl, {
    headers: storageHeaders(serviceKey),
    cache: "no-store"
  });

  if (lookup.ok) {
    const bucket = await lookup.json().catch(() => null);
    if (bucket?.public === true) return bucket;
    const updated = await fetch(bucketUrl, {
      method: "PUT",
      headers: storageHeaders(serviceKey),
      body: JSON.stringify(payload),
      cache: "no-store"
    });
    if (!updated.ok) throw new Error((await responseDetail(updated)) || "Storage bucket could not be made public.");
    return updated.json().catch(() => ({ id: storageBucket, public: true }));
  }

  if (lookup.status !== 404) throw new Error((await responseDetail(lookup)) || "Storage bucket lookup failed.");

  const created = await fetch(`${supabaseUrl}/storage/v1/bucket`, {
    method: "POST",
    headers: storageHeaders(serviceKey),
    body: JSON.stringify({ id: storageBucket, name: storageBucket, ...payload }),
    cache: "no-store"
  });

  if (!created.ok && created.status !== 409) {
    throw new Error((await responseDetail(created)) || "Storage bucket could not be created.");
  }

  return { id: storageBucket, public: true };
}

function publicObjectUrl({ supabaseUrl, storageBucket, objectPath }) {
  return `${supabaseUrl}/storage/v1/object/public/${encodeURIComponent(storageBucket)}/${objectPath}`;
}

async function probePublicUrl(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const head = await fetch(url, { method: "HEAD", cache: "no-store", signal: controller.signal });
    if (head.ok) return { ok: true, status: head.status, method: "HEAD" };
    if (![405, 501].includes(head.status)) return { ok: false, status: head.status, method: "HEAD" };
  } catch (error) {
    if (error?.name !== "AbortError") {
      clearTimeout(timeout);
      return { ok: false, error: error?.message || "HEAD probe failed.", method: "HEAD" };
    }
  }
  clearTimeout(timeout);

  const rangeController = new AbortController();
  const rangeTimeout = setTimeout(() => rangeController.abort(), timeoutMs);
  try {
    const ranged = await fetch(url, {
      method: "GET",
      headers: { Range: "bytes=0-0" },
      cache: "no-store",
      signal: rangeController.signal
    });
    return { ok: ranged.ok || ranged.status === 206, status: ranged.status, method: "GET" };
  } catch (error) {
    return { ok: false, error: error?.message || "Range probe failed.", method: "GET" };
  } finally {
    clearTimeout(rangeTimeout);
  }
}

async function assertRequiredRestTables({ supabaseUrl, serviceKey }) {
  const requiredTables = [
    "roamly_content_generation_batches",
    "roamly_social_media_assets",
    "roamly_social_drafts",
    "roamly_social_queue",
    "roamly_scheduled_posts",
    "roamly_publishing_jobs",
    "roamly_facebook_media_processing",
    "roamly_content_quality_checks",
    "roamly_admin_activity_logs"
  ];
  const missing = [];

  for (const table of requiredTables) {
    const response = await fetch(`${supabaseUrl}/rest/v1/${table}?select=id&limit=1`, {
      headers: {
        apikey: serviceKey,
        Authorization: `Bearer ${serviceKey}`
      },
      cache: "no-store"
    });
    if (!response.ok) {
      missing.push({ table, status: response.status, detail: (await responseDetail(response)).slice(0, 240) });
    }
  }

  if (missing.length) {
    throw new Error(
      `Required Supabase table endpoint(s) are unavailable: ${missing
        .map((item) => `${item.table} HTTP ${item.status}`)
        .join(", ")}. Apply the existing Supabase social support migration before seeding DB rows.`
    );
  }
}

async function uploadAsset({ supabaseUrl, serviceKey, storageBucket, post }) {
  const absoluteFile = path.join(root, post.reelAsset);
  const info = await stat(absoluteFile);
  if (!info.size) throw new Error(`Asset is empty: ${post.reelAsset}`);

  const body = await readFile(absoluteFile);
  const uploadUrl = `${supabaseUrl}/storage/v1/object/${encodeURIComponent(storageBucket)}/${post.publicObjectPath}`;
  const response = await fetch(uploadUrl, {
    method: "POST",
    headers: storageHeaders(serviceKey, {
      "Content-Type": "video/mp4",
      "Cache-Control": "31536000",
      "x-upsert": "true"
    }),
    body,
    cache: "no-store"
  });

  if (!response.ok) throw new Error((await responseDetail(response)) || `Upload failed for day ${post.dayNumber}.`);

  const publicUrl = publicObjectUrl({ supabaseUrl, storageBucket, objectPath: post.publicObjectPath });
  const probe = await probePublicUrl(publicUrl);
  if (!probe.ok) throw new Error(`Uploaded asset is not publicly reachable for day ${post.dayNumber}: ${probe.error || probe.status}`);

  return {
    publicUrl,
    bytes: info.size,
    publicProbe: probe
  };
}

function baseMetadata(post, extra = {}) {
  return {
    brand,
    campaignId,
    campaignName: "Roamly Premium 25-Day Reel Campaign",
    dayNumber: post.dayNumber,
    theme: post.theme,
    destination: post.destination,
    hook: post.hook,
    cta: post.cta,
    visualConcept: post.visualConcept,
    reelScript: post.reelScript,
    onScreenText: post.onScreenText,
    voiceover: post.voiceover,
    musicDirection: post.musicDirection,
    localAssetPath: post.reelAsset,
    publicObjectPath: post.publicObjectPath,
    scheduledLocal: post.scheduledLocal,
    publishingInstruction: "Do not publish until final queue approval.",
    ...extra
  };
}

function qualityReasons(post) {
  return [
    `Unique destination: ${post.destination}`,
    "Vertical 9:16 MP4 validated at 1080x1920",
    "Premium Roamly-only travel creative",
    "Public media URL verified before queue registration"
  ];
}

function rowsForPost(post, uploaded) {
  const slug = slugFromPost(post);
  const day = String(post.dayNumber).padStart(2, "0");
  const mediaAssetId = mediaAssetIdFor(post.dayNumber);
  const draftId = draftIdFor(post.dayNumber);
  const queueId = queueIdFor(post.dayNumber);
  const scheduledPostId = scheduledPostIdFor(post.dayNumber);
  const publishingJobId = publishingJobIdFor(post.dayNumber);
  const facebookProcessingId = facebookProcessingIdFor(post.dayNumber);
  const qualityCheckId = qualityCheckIdFor(post.dayNumber);
  const hashtags = asHashtagNames(post);
  const metadata = baseMetadata(post, {
    slug,
    mediaAssetId,
    draftId,
    queueId,
    publicMediaUrl: uploaded.publicUrl,
    fileSizeBytes: uploaded.bytes,
    publicProbe: uploaded.publicProbe
  });
  const idempotencyKey = hash(`${platform}:${draftId}:${post.scheduledFor}`);
  const publishKey = hash(`${platform}:publish:${draftId}:${post.scheduledFor}`);
  const jobIdempotencyKey = hash(`${platform}:job:${queueId}:${post.scheduledFor}`);

  return {
    mediaAsset: {
      id: mediaAssetId,
      platform,
      status: "approved",
      title: `Roamly Reel Day ${day}: ${post.theme}`,
      caption: post.caption,
      hashtags,
      media_url: uploaded.publicUrl,
      destination: post.destination,
      topic: post.theme,
      scheduled_for: post.scheduledFor,
      asset_type: "video",
      approved_for_automation: true,
      excluded_from_automation: false,
      use_count: 0,
      width: 1080,
      height: 1920,
      duration_seconds: post.durationSeconds,
      is_vertical: true,
      source: "codex_roamly_premium_reel_campaign",
      rights_note: "Generated Roamly campaign asset. No ReviewIntel, Sophie, or third-party stock assets.",
      metadata
    },
    draft: {
      id: draftId,
      batch_id: uuidFor(`${campaignId}:batch`),
      platform,
      content_type: post.theme,
      post_format: "reel",
      topic: post.destination,
      topic_key: `${campaignId}:day-${day}`,
      concept_key: `${campaignId}:day-${day}:${slug}`,
      hook: post.hook,
      hook_hash: hash(post.hook),
      caption: post.caption,
      caption_hash: hash(post.caption),
      on_screen_text: post.onScreenText.join(" | "),
      media_direction: post.visualConcept,
      suggested_media: uploaded.publicUrl,
      selected_media_asset_id: mediaAssetId,
      selected_media_url: uploaded.publicUrl,
      media_hash: hash(uploaded.publicUrl),
      call_to_action: post.cta,
      hashtags,
      hashtag_hash: hash(JSON.stringify(hashtags)),
      music_or_audio_mood: post.musicDirection,
      roamly_link: clean(process.env.ROAMLY_PUBLIC_DOMAIN) || clean(process.env.NEXT_PUBLIC_SITE_URL) || defaultPublicDomain,
      link_hash: hash(clean(process.env.ROAMLY_PUBLIC_DOMAIN) || clean(process.env.NEXT_PUBLIC_SITE_URL) || defaultPublicDomain),
      generation_source: "codex_premium_reel_campaign",
      status: "scheduled",
      quality_score: 98,
      quality_reasons: qualityReasons(post),
      metadata
    },
    queue: {
      id: queueId,
      draft_id: draftId,
      platform,
      queue_status: "scheduled",
      scheduled_for: post.scheduledFor,
      scheduled_date: post.scheduledFor.slice(0, 10),
      idempotency_key: idempotencyKey,
      publish_key: publishKey,
      attempt_count: 0,
      permanent_failure: false,
      meta_response: {},
      metadata
    },
    scheduledPost: {
      id: scheduledPostId,
      queue_id: queueId,
      draft_id: draftId,
      platform,
      scheduled_for: post.scheduledFor,
      status: "scheduled",
      metadata
    },
    publishingJob: {
      id: publishingJobId,
      queue_id: queueId,
      draft_id: draftId,
      platform,
      job_status: "scheduled",
      idempotency_key: jobIdempotencyKey,
      scheduled_for: post.scheduledFor,
      attempt_count: 0,
      metadata
    },
    facebookProcessing: {
      id: facebookProcessingId,
      queue_id: queueId,
      draft_id: draftId,
      processing_status: "ready",
      checked_at: new Date().toISOString(),
      metadata: baseMetadata(post, {
        slug,
        mediaAssetId,
        draftId,
        queueId,
        publicMediaUrl: uploaded.publicUrl,
        stage: "campaign_asset_registered",
        noMetaPublishAttempted: true
      })
    },
    qualityCheck: {
      id: qualityCheckId,
      draft_id: draftId,
      batch_id: uuidFor(`${campaignId}:batch`),
      score: 98,
      status: "passed",
      reasons: qualityReasons(post),
      metadata
    }
  };
}

async function existingIdSet(admin, table, ids) {
  if (!ids.length) return new Set();
  const { data, error } = await admin.from(table).select("id").in("id", ids);
  if (error) throw new Error(`${table} pre-count failed: ${error.message}`);
  return new Set((data || []).map((row) => row.id));
}

async function upsertRows(admin, table, rows) {
  const { error } = await admin.from(table).upsert(rows, { onConflict: "id" });
  if (error) throw new Error(`${table} upsert failed: ${error.message}`);
}

async function countByIds(admin, table, ids) {
  const { count, error } = await admin.from(table).select("id", { count: "exact", head: true }).in("id", ids);
  if (error) throw new Error(`${table} count failed: ${error.message}`);
  return count || 0;
}

async function failOnConflictingQueue(admin, posts) {
  const activeStatuses = ["scheduled", "processing", "retrying", "published"];
  const { data, error } = await admin
    .from("roamly_social_queue")
    .select("id,scheduled_for,metadata,queue_status")
    .in("scheduled_for", posts.map((post) => post.scheduledFor))
    .in("queue_status", activeStatuses);
  if (error) throw new Error(`Queue preflight failed: ${error.message}`);
  const conflicts = (data || []).filter((row) => row.metadata?.campaignId !== campaignId);
  if (conflicts.length) {
    throw new Error(
      `Found ${conflicts.length} active queue row(s) in the requested schedule window that do not belong to ${campaignId}.`
    );
  }
}

function assertPlan(plan) {
  if (!Array.isArray(plan.posts) || plan.posts.length !== 25) throw new Error("Seed requires exactly 25 plan posts.");
  const uniqueAssets = new Set(plan.posts.map((post) => post.reelAsset));
  if (uniqueAssets.size !== 25) throw new Error("Seed requires 25 unique Reel assets.");
  const uniqueCaptions = new Set(plan.posts.map((post) => post.caption));
  if (uniqueCaptions.size !== 25) throw new Error("Seed requires 25 unique captions.");
  for (let index = 1; index < plan.posts.length; index += 1) {
    const prev = new Date(plan.posts[index - 1].scheduledFor).getTime();
    const current = new Date(plan.posts[index].scheduledFor).getTime();
    if (current - prev !== 24 * 60 * 60 * 1000) throw new Error("Schedule dates are not consecutive.");
  }
}

async function main() {
  await loadEnvFile(path.join(root, ".env.local"));

  const supabaseUrl = cleanSupabaseUrl(clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || clean(process.env.SUPABASE_URL));
  const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!supabaseUrl || !serviceKey) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");

  const plan = JSON.parse(await readFile(planPath, "utf8"));
  assertPlan(plan);

  const storageBucket = storageBucketName();
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  await assertRequiredRestTables({ supabaseUrl, serviceKey });
  await failOnConflictingQueue(admin, plan.posts);
  await ensurePublicBucket({ supabaseUrl, serviceKey, storageBucket });

  const uploads = [];
  for (const post of plan.posts) {
    process.stdout.write(`Uploading day ${post.dayNumber}: ${post.destination}... `);
    const uploaded = await uploadAsset({ supabaseUrl, serviceKey, storageBucket, post });
    uploads.push({ post, uploaded });
    process.stdout.write("done\n");
  }

  const batchId = uuidFor(`${campaignId}:batch`);
  const auditLogId = uuidFor(`${campaignId}:audit-log:queue-prepared`);
  const rows = uploads.map(({ post, uploaded }) => rowsForPost(post, uploaded));
  const ids = {
    batches: [batchId],
    mediaAssets: rows.map((row) => row.mediaAsset.id),
    drafts: rows.map((row) => row.draft.id),
    queue: rows.map((row) => row.queue.id),
    scheduledPosts: rows.map((row) => row.scheduledPost.id),
    publishingJobs: rows.map((row) => row.publishingJob.id),
    facebookProcessing: rows.map((row) => row.facebookProcessing.id),
    qualityChecks: rows.map((row) => row.qualityCheck.id),
    auditLogs: [auditLogId]
  };

  const before = {
    batches: await existingIdSet(admin, "roamly_content_generation_batches", ids.batches),
    mediaAssets: await existingIdSet(admin, "roamly_social_media_assets", ids.mediaAssets),
    drafts: await existingIdSet(admin, "roamly_social_drafts", ids.drafts),
    queue: await existingIdSet(admin, "roamly_social_queue", ids.queue),
    scheduledPosts: await existingIdSet(admin, "roamly_scheduled_posts", ids.scheduledPosts),
    publishingJobs: await existingIdSet(admin, "roamly_publishing_jobs", ids.publishingJobs),
    facebookProcessing: await existingIdSet(admin, "roamly_facebook_media_processing", ids.facebookProcessing),
    qualityChecks: await existingIdSet(admin, "roamly_content_quality_checks", ids.qualityChecks),
    auditLogs: await existingIdSet(admin, "roamly_admin_activity_logs", ids.auditLogs)
  };

  const batch = {
    id: batchId,
    platform,
    requested_count: 25,
    created_count: 25,
    rejected_count: 0,
    generation_source: "codex_premium_reel_campaign",
    status: "completed",
    started_by: "codex",
    started_at: plan.generatedAt || new Date().toISOString(),
    finished_at: new Date().toISOString(),
    metadata: {
      brand,
      campaignId,
      campaignName: plan.campaignName,
      planPath: path.relative(root, planPath),
      generatedAssetCount: 25,
      sourcePlateCount: 75,
      publicStorageBucket: storageBucket,
      noMetaPublishAttempted: true
    }
  };

  const auditLog = {
    id: auditLogId,
    actor_email: null,
    action: "roamly_premium_reel_campaign_queue_prepared",
    target_type: "campaign",
    target_id: campaignId,
    status: "completed",
    message: "Prepared 25-day Roamly Facebook/Instagram Reel queue. No Meta publish or test was attempted.",
    metadata: {
      brand,
      campaignId,
      campaignName: plan.campaignName,
      planPath: path.relative(root, planPath),
      seededPlanPath: path.relative(root, seededPlanPath),
      scheduledStart: plan.posts[0].scheduledFor,
      scheduledEnd: plan.posts.at(-1).scheduledFor,
      publicStorageBucket: storageBucket,
      noMetaPublishAttempted: true
    }
  };

  await upsertRows(admin, "roamly_content_generation_batches", [batch]);
  await upsertRows(admin, "roamly_social_media_assets", rows.map((row) => row.mediaAsset));
  await upsertRows(admin, "roamly_social_drafts", rows.map((row) => row.draft));
  await upsertRows(admin, "roamly_social_queue", rows.map((row) => row.queue));
  await upsertRows(admin, "roamly_scheduled_posts", rows.map((row) => row.scheduledPost));
  await upsertRows(admin, "roamly_publishing_jobs", rows.map((row) => row.publishingJob));
  await upsertRows(admin, "roamly_facebook_media_processing", rows.map((row) => row.facebookProcessing));
  await upsertRows(admin, "roamly_content_quality_checks", rows.map((row) => row.qualityCheck));
  await upsertRows(admin, "roamly_admin_activity_logs", [auditLog]);

  const presentCounts = {
    batches: await countByIds(admin, "roamly_content_generation_batches", ids.batches),
    mediaAssets: await countByIds(admin, "roamly_social_media_assets", ids.mediaAssets),
    drafts: await countByIds(admin, "roamly_social_drafts", ids.drafts),
    queue: await countByIds(admin, "roamly_social_queue", ids.queue),
    scheduledPosts: await countByIds(admin, "roamly_scheduled_posts", ids.scheduledPosts),
    publishingJobs: await countByIds(admin, "roamly_publishing_jobs", ids.publishingJobs),
    facebookProcessing: await countByIds(admin, "roamly_facebook_media_processing", ids.facebookProcessing),
    qualityChecks: await countByIds(admin, "roamly_content_quality_checks", ids.qualityChecks),
    auditLogs: await countByIds(admin, "roamly_admin_activity_logs", ids.auditLogs)
  };

  const createdCounts = Object.fromEntries(
    Object.entries(ids).map(([key, value]) => [key, value.length - before[key].size])
  );
  const publicUrls = uploads.map(({ post, uploaded }) => ({
    dayNumber: post.dayNumber,
    destination: post.destination,
    mediaUrl: uploaded.publicUrl,
    probe: uploaded.publicProbe
  }));
  const seededPlan = {
    ...plan,
    storageBucket,
    seededAt: new Date().toISOString(),
    posts: plan.posts.map((post, index) => ({
      ...post,
      publicMediaUrl: uploads[index].uploaded.publicUrl,
      databaseIds: {
        mediaAssetId: rows[index].mediaAsset.id,
        draftId: rows[index].draft.id,
        queueId: rows[index].queue.id,
        scheduledPostId: rows[index].scheduledPost.id,
        publishingJobId: rows[index].publishingJob.id,
        facebookProcessingId: rows[index].facebookProcessing.id,
        qualityCheckId: rows[index].qualityCheck.id
      },
      status: "scheduled"
    }))
  };
  const summary = {
    seededAt: new Date().toISOString(),
    campaignId,
    brand,
    platform,
    storageBucket,
    planPath: path.relative(root, planPath),
    seededPlanPath: path.relative(root, seededPlanPath),
    noMetaPublishAttempted: true,
    allPublicUrlsValid: publicUrls.every((item) => item.probe.ok),
    failedUploads: 0,
    failedGenerations: 0,
    presentCounts,
    createdCounts,
    schedule: plan.posts.map((post, index) => ({
      dayNumber: post.dayNumber,
      theme: post.theme,
      destination: post.destination,
      scheduledFor: post.scheduledFor,
      scheduledLocal: post.scheduledLocal,
      status: "scheduled",
      reelAsset: post.reelAsset,
      publicMediaUrl: uploads[index].uploaded.publicUrl
    })),
    publicUrls
  };

  await writeFile(seededPlanPath, `${JSON.stringify(seededPlan, null, 2)}\n`);
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
