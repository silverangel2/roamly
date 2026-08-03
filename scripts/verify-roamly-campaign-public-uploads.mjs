import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const campaignId = "roamly-premium-reels-2026-08";
const planPath = path.join(root, "content/social/roamly-25-day-reel-campaign/roamly-25-day-reel-campaign-2026-08-04.json");
const outputPath = path.join(root, "content/social/roamly-25-day-reel-campaign/validation/upload-validation.json");

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

function storageBucketName() {
  return (
    clean(process.env.ROAMLY_PUBLIC_SOCIAL_MEDIA_BUCKET) ||
    clean(process.env.SUPABASE_PUBLIC_SOCIAL_MEDIA_BUCKET) ||
    clean(process.env.SUPABASE_SOCIAL_MEDIA_BUCKET) ||
    "roamly-social-public"
  );
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

await loadEnvFile(path.join(root, ".env.local"));
const supabaseUrl = (clean(process.env.NEXT_PUBLIC_SUPABASE_URL) || clean(process.env.SUPABASE_URL)).replace(/\/$/, "");
if (!supabaseUrl) throw new Error("NEXT_PUBLIC_SUPABASE_URL or SUPABASE_URL is required.");

const storageBucket = storageBucketName();
const plan = JSON.parse(await readFile(planPath, "utf8"));
const results = [];
for (const post of plan.posts) {
  const publicMediaUrl = publicObjectUrl({ supabaseUrl, storageBucket, objectPath: post.publicObjectPath });
  const probe = await probePublicUrl(publicMediaUrl);
  results.push({
    dayNumber: post.dayNumber,
    destination: post.destination,
    theme: post.theme,
    reelAsset: post.reelAsset,
    publicObjectPath: post.publicObjectPath,
    publicMediaUrl,
    probe
  });
}

const summary = {
  validatedAt: new Date().toISOString(),
  campaignId,
  storageBucket,
  total: results.length,
  validPublicUrls: results.filter((result) => result.probe.ok).length,
  invalidPublicUrls: results.filter((result) => !result.probe.ok),
  results
};

await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
