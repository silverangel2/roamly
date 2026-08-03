import { spawn } from "node:child_process";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

const root = process.cwd();
const planPath = path.join(root, "content/social/roamly-25-day-reel-campaign/roamly-25-day-reel-campaign-2026-08-04.json");
const validationPath = path.join(root, "content/social/roamly-25-day-reel-campaign/validation/asset-validation.json");
const plan = JSON.parse(await readFile(planPath, "utf8"));

function runFfmpegInfo(file) {
  return new Promise((resolve) => {
    const child = spawn(ffmpegInstaller.path, ["-hide_banner", "-i", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", () => resolve(stderr));
  });
}

function parseMetadata(stderr) {
  const video = stderr.match(/Video:.*?,\s*(\d{3,5})x(\d{3,5})[,\s]/);
  const duration = stderr.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/);
  return {
    width: video ? Number(video[1]) : null,
    height: video ? Number(video[2]) : null,
    durationSeconds: duration
      ? Number(duration[1]) * 3600 + Number(duration[2]) * 60 + Number(duration[3])
      : null
  };
}

function uniqueCount(values) {
  return new Set(values).size;
}

function isConsecutive(posts) {
  for (let index = 1; index < posts.length; index += 1) {
    const prev = new Date(posts[index - 1].scheduledFor).getTime();
    const current = new Date(posts[index].scheduledFor).getTime();
    if (current - prev !== 24 * 60 * 60 * 1000) return false;
  }
  return true;
}

const assets = [];
for (const post of plan.posts) {
  const absolute = path.join(root, post.reelAsset);
  const info = parseMetadata(await runFfmpegInfo(absolute));
  const fileInfo = await stat(absolute);
  assets.push({
    dayNumber: post.dayNumber,
    destination: post.destination,
    theme: post.theme,
    file: post.reelAsset,
    width: info.width,
    height: info.height,
    isVerticalNineBySixteen: info.width === 1080 && info.height === 1920,
    durationSeconds: info.durationSeconds,
    expectedDurationSeconds: post.durationSeconds,
    bytes: fileInfo.size,
    valid: info.width === 1080 && info.height === 1920 && fileInfo.size > 0
  });
}

const summary = {
  validatedAt: new Date().toISOString(),
  planPath: path.relative(root, planPath),
  postCount: plan.posts.length,
  assetCount: assets.length,
  sourcePlateCount: plan.posts.flatMap((post) => post.sourcePlates).length,
  uniqueCaptions: uniqueCount(plan.posts.map((post) => post.caption)),
  uniqueHooks: uniqueCount(plan.posts.map((post) => post.hook)),
  uniqueCtas: uniqueCount(plan.posts.map((post) => post.cta)),
  uniqueDestinations: uniqueCount(plan.posts.map((post) => post.destination)),
  uniqueVisualConcepts: uniqueCount(plan.posts.map((post) => post.visualConcept)),
  queueDatesConsecutive: isConsecutive(plan.posts),
  firstScheduledFor: plan.posts[0]?.scheduledFor,
  lastScheduledFor: plan.posts.at(-1)?.scheduledFor,
  verticalNineBySixteenAssets: assets.filter((asset) => asset.isVerticalNineBySixteen).length,
  invalidAssets: assets.filter((asset) => !asset.valid),
  failedGenerations: assets.filter((asset) => !asset.valid).length,
  assets
};

await writeFile(validationPath, `${JSON.stringify(summary, null, 2)}\n`);
console.log(JSON.stringify(summary, null, 2));
