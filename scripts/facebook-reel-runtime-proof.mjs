import { spawn } from "child_process";
import { createServer } from "net";
import { mkdir, readFile, writeFile } from "fs/promises";
import path from "path";

const root = process.cwd();
const proofDir = path.join(root, "runtime-proofs");
const reviewIntelEnvPath = process.env.REVIEWINTEL_ENV_PATH || "/Users/junel/review-insight-ai/.env.local";

function parseEnv(raw) {
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    const key = match[1];
    let value = match[2].trim();
    if (!value || value.startsWith("#")) continue;
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (redactedEnvValue(value)) continue;
    env[key] = value;
  }
  return env;
}

function redactedEnvValue(value) {
  const text = String(value || "").trim();
  return (
    !text ||
    /^\[(sensitive|redacted|secret|token|private)\]$/i.test(text) ||
    /^(changeme|change_me|your[_-]?token|your[_-]?secret|placeholder)$/i.test(text)
  );
}

async function readEnvFile(file) {
  try {
    return parseEnv(await readFile(file, "utf8"));
  } catch {
    return {};
  }
}

async function mergedEnv() {
  const roamly = await readEnvFile(path.join(root, ".env.local"));
  const reviewintel = await readEnvFile(reviewIntelEnvPath);
  const env = { ...process.env, ...roamly };

  if (!env.REVIEWINTEL_META_PAGE_ID && reviewintel.FACEBOOK_PAGE_ID) {
    env.REVIEWINTEL_META_PAGE_ID = reviewintel.FACEBOOK_PAGE_ID;
  }
  if (!env.REVIEWINTEL_META_ACCESS_TOKEN && reviewintel.FACEBOOK_PAGE_ACCESS_TOKEN) {
    env.REVIEWINTEL_META_ACCESS_TOKEN = reviewintel.FACEBOOK_PAGE_ACCESS_TOKEN;
  }
  if (!env.REVIEWINTEL_META_GRAPH_VERSION && reviewintel.FACEBOOK_GRAPH_API_VERSION) {
    env.REVIEWINTEL_META_GRAPH_VERSION = reviewintel.FACEBOOK_GRAPH_API_VERSION;
  }
  if (!env.REVIEWINTEL_SITE_URL) {
    env.REVIEWINTEL_SITE_URL = reviewintel.NEXT_PUBLIC_SITE_URL || reviewintel.NEXT_PUBLIC_APP_URL || "https://getreviewintel.com";
  }

  env.REVIEWINTEL_SOCIAL_FACEBOOK_ENABLED ||= "true";
  env.REVIEWINTEL_SOCIAL_AUTOPOST_ENABLED ||= "true";
  env.ROAMLY_SOCIAL_FACEBOOK_ENABLED = "true";
  env.ROAMLY_SOCIAL_AUTOPOST_ENABLED = "true";
  env.NODE_ENV ||= "development";

  return env;
}

function required(value, label) {
  if (redactedEnvValue(value)) throw new Error(`${label} is required for runtime proof.`);
  return String(value).trim();
}

async function availablePort(preferred = 3219) {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(preferred, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => resolve(typeof address === "object" && address ? address.port : preferred));
    });
    server.on("error", () => {
      const fallback = createServer();
      fallback.listen(0, "127.0.0.1", () => {
        const address = fallback.address();
        fallback.close(() => resolve(typeof address === "object" && address ? address.port : preferred + 1));
      });
    });
  });
}

async function fetchJson(url, init = {}, timeoutMs = 240000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = { raw: text };
    }
    if (!response.ok) {
      const error = new Error(data?.error || `HTTP ${response.status}`);
      error.response = data;
      throw error;
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

async function waitForServer(baseUrl, secret) {
  const statusUrl = `${baseUrl}/api/cron/roamly-social-autopost?action=status`;
  const started = Date.now();
  let lastError = "";
  while (Date.now() - started < 120000) {
    try {
      return await fetchJson(statusUrl, {
        headers: { Authorization: `Bearer ${secret}` }
      }, 15000);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
  throw new Error(`Next server did not become ready: ${lastError}`);
}

function sanitizeProof(value) {
  if (Array.isArray(value)) return value.map(sanitizeProof);
  if (!value || typeof value !== "object") return value;
  const result = {};
  for (const [key, inner] of Object.entries(value)) {
    if (/token|secret|authorization|access_token/i.test(key)) {
      result[key] = "[redacted]";
    } else {
      result[key] = sanitizeProof(inner);
    }
  }
  return result;
}

function stageSummary(logs) {
  return (logs || []).map((log) => ({
    status: log.processing_status,
    facebookVideoId: log.facebook_video_id || null,
    stage: log.metadata?.stage || null,
    generatedVideo: log.metadata?.generatedVideo
      ? {
          publicUrl: log.metadata.generatedVideo.publicUrl,
          width: log.metadata.generatedVideo.width,
          height: log.metadata.generatedVideo.height,
          durationSeconds: log.metadata.generatedVideo.durationSeconds,
          size: log.metadata.generatedVideo.size
        }
      : null,
    hasUploadResponse: Boolean(log.metadata?.upload),
    hasFinishResponse: Boolean(log.metadata?.finish),
    hasConfirmation: Boolean(log.metadata?.confirmation)
  }));
}

async function runProof(baseUrl, secret, brand) {
  const proof = await fetchJson(
    `${baseUrl}/api/cron/roamly-social-autopost?action=proof_reel&brand=${encodeURIComponent(brand)}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secret}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ action: "proof_reel", brand })
    }
  );

  const finalQueue = proof.finalQueue || {};
  if (finalQueue.platform && !String(finalQueue.platform).includes(brand)) {
    throw new Error(`${brand} proof returned mismatched platform ${finalQueue.platform}.`);
  }
  if (!finalQueue.facebook_reel_id) {
    throw new Error(`${brand} proof did not publish a Facebook Reel.`);
  }
  if (finalQueue.facebook_post_id) {
    throw new Error(`${brand} proof unexpectedly created a normal Facebook post id.`);
  }

  return proof;
}

async function main() {
  const env = await mergedEnv();
  const secret = required(env.ROAMLY_SOCIAL_CRON_SECRET || env.CRON_SECRET, "ROAMLY_SOCIAL_CRON_SECRET or CRON_SECRET");
  required(env.ROAMLY_META_PAGE_ID, "ROAMLY_META_PAGE_ID");
  required(env.ROAMLY_META_ACCESS_TOKEN, "ROAMLY_META_ACCESS_TOKEN");
  required(env.REVIEWINTEL_META_PAGE_ID, "REVIEWINTEL_META_PAGE_ID");
  required(env.REVIEWINTEL_META_ACCESS_TOKEN, "REVIEWINTEL_META_ACCESS_TOKEN");

  const externalBaseUrl = process.env.FACEBOOK_PROOF_BASE_URL?.replace(/\/$/, "");
  const port = externalBaseUrl ? 0 : await availablePort(Number(process.env.FACEBOOK_PROOF_PORT || 3219));
  const baseUrl = externalBaseUrl || `http://127.0.0.1:${port}`;
  let server = null;

  if (!externalBaseUrl) {
    server = spawn(path.join(root, "node_modules/.bin/next"), ["dev", "-H", "127.0.0.1", "-p", String(port)], {
      cwd: root,
      env,
      stdio: ["ignore", "pipe", "pipe"]
    });
    server.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      if (/ready|started server/i.test(text)) process.stdout.write(text);
    });
    server.stderr.on("data", (chunk) => process.stderr.write(chunk.toString()));
  }

  try {
    const status = await waitForServer(baseUrl, secret);
    for (const brand of ["roamly", "reviewintel"]) {
      const summary = status.summaries?.[brand];
      if (summary?.settings?.manualReviewRequired) {
        throw new Error(`${brand} manual review is enabled; proof runner will not bypass approval flow.`);
      }
    }

    const roamly = await runProof(baseUrl, secret, "roamly");
    const reviewintel = await runProof(baseUrl, secret, "reviewintel");
    const roamlyPage = roamly.finalQueue?.meta_response?.pageId;
    const reviewintelPage = reviewintel.finalQueue?.meta_response?.pageId;
    if (!roamlyPage || !reviewintelPage) throw new Error("Both proofs must include final Meta page IDs.");
    if (String(roamlyPage) === String(reviewintelPage)) {
      throw new Error("Roamly and ReviewIntel resolved to the same Facebook Page ID; cross-posting guard failed.");
    }

    const proof = sanitizeProof({
      ok: true,
      generatedAt: new Date().toISOString(),
      baseUrl,
      verification: {
        correctPages: {
          roamly: roamlyPage,
          reviewintel: reviewintelPage
        },
        noCrossPosting: true,
        duplicatePrevention: {
          roamlyQueueId: roamly.queueId,
          reviewintelQueueId: reviewintel.queueId,
          distinctQueueIds: roamly.queueId !== reviewintel.queueId
        },
        boundedRetry: {
          roamlyAttemptCount: roamly.finalQueue?.attempt_count,
          reviewintelAttemptCount: reviewintel.finalQueue?.attempt_count
        },
        approvalFlow: "manual review checked before posting and not bypassed"
      },
      proofs: {
        roamly: {
          queueId: roamly.queueId,
          finalQueue: roamly.finalQueue,
          processingStages: stageSummary(roamly.processingLogs),
          attempts: roamly.attempts
        },
        reviewintel: {
          queueId: reviewintel.queueId,
          finalQueue: reviewintel.finalQueue,
          processingStages: stageSummary(reviewintel.processingLogs),
          attempts: reviewintel.attempts
        }
      }
    });

    await mkdir(proofDir, { recursive: true });
    const proofPath = path.join(proofDir, `facebook-reel-proof-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(proofPath, `${JSON.stringify(proof, null, 2)}\n`);

    console.log(JSON.stringify({
      ok: true,
      proofPath,
      roamly: {
        queueId: roamly.queueId,
        pageId: roamlyPage,
        facebookReelId: roamly.finalQueue?.facebook_reel_id,
        facebookUrl: roamly.finalQueue?.facebook_url,
        stages: stageSummary(roamly.processingLogs)
      },
      reviewintel: {
        queueId: reviewintel.queueId,
        pageId: reviewintelPage,
        facebookReelId: reviewintel.finalQueue?.facebook_reel_id,
        facebookUrl: reviewintel.finalQueue?.facebook_url,
        stages: stageSummary(reviewintel.processingLogs)
      }
    }, null, 2));
  } finally {
    if (server) {
      server.kill("SIGTERM");
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Facebook Reel runtime proof failed.");
  if (error?.response) console.error(JSON.stringify(sanitizeProof(error.response), null, 2));
  process.exit(1);
});
