import { createHash, randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import sharp from "sharp";
import ffprobeInstaller from "ffprobe-static";
import { publicSocialMediaStorageBucket, uploadPublicSupabaseObject } from "@/lib/roamly/publicSocialStorage";

export type SocialReelBrand = "roamly" | "reviewintel";

export type SocialReelVideoResult = {
  filename: string;
  objectPath: string;
  publicUrl: string;
  size: number;
  width: number;
  height: number;
  durationSeconds: number;
  mimeType: "video/mp4";
  ffprobe: Record<string, unknown>;
  audioTrack: ApprovedAudioTrack;
};

export type ApprovedAudioTrack = {
  id: string;
  name: string;
  license: string;
  lavfi: string;
  volume: number;
};

type GenerateFreshSocialReelVideoInput = {
  brand: SocialReelBrand;
  topic: string;
  hook: string;
  support: string;
  cta: string;
  caption: string;
  hashtags: string[];
  websiteUrl: string;
  affiliateUrl?: string;
  supabaseUrl: string;
  serviceKey: string;
  audioSeed: string;
  fetcher?: typeof fetch;
};

const width = 1080;
const height = 1920;
const sceneSeconds = 3;
const totalSeconds = sceneSeconds * 3;
const publicSocialMaxBytes = 50 * 1024 * 1024;

const approvedGeneratedAudioTracks: ApprovedAudioTrack[] = [
  {
    id: "roamly-original-soft-pulse",
    name: "Roamly Original Soft Pulse",
    license: "Original generated tone bed; royalty-free for owned brand social media.",
    lavfi: "sine=frequency=196:sample_rate=44100",
    volume: 0.032
  },
  {
    id: "roamly-original-warm-lift",
    name: "Roamly Original Warm Lift",
    license: "Original generated tone bed; royalty-free for owned brand social media.",
    lavfi: "sine=frequency=261.63:sample_rate=44100",
    volume: 0.029
  },
  {
    id: "roamly-original-light-motion",
    name: "Roamly Original Light Motion",
    license: "Original generated tone bed; royalty-free for owned brand social media.",
    lavfi: "sine=frequency=329.63:sample_rate=44100",
    volume: 0.025
  }
];

function cleanSupabaseUrl(value: string) {
  return value.replace(/\/$/, "");
}

function safeText(value: unknown, fallback = "") {
  return String(value || fallback).replace(/\s+/g, " ").trim();
}

function compactText(value: unknown, maxLength: number) {
  const clean = safeText(value);
  if (clean.length <= maxLength) return clean;
  return `${clean.slice(0, Math.max(0, maxLength - 3)).trim()}...`;
}

function xmlEscape(value: unknown) {
  return safeText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function wrapLines(value: unknown, maxChars: number, maxLines: number) {
  const words = safeText(value).split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";

  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > maxChars && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }

    if (lines.length === maxLines) break;
  }

  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

function textTspans(lines: string[], x: number, y: number, size: number, gap: number, color: string, weight = 900) {
  return lines
    .map(
      (line, index) =>
        `<tspan x="${x}" y="${y + index * gap}" font-size="${size}" font-weight="${weight}" fill="${color}">${xmlEscape(line)}</tspan>`
    )
    .join("");
}

function seedNumber(seed: string) {
  return Array.from(seed).reduce((acc, char) => acc + char.charCodeAt(0), 0);
}

function selectApprovedAudioTrack(seed: string) {
  const index = Math.abs(seedNumber(seed)) % approvedGeneratedAudioTracks.length;
  return approvedGeneratedAudioTracks[index];
}

function brandTheme(brand: SocialReelBrand) {
  if (brand === "reviewintel") {
    return {
      label: "REVIEWINTEL",
      bg: "#06111f",
      bg2: "#0f766e",
      accent: "#22d3ee",
      accent2: "#fbbf24",
      panel: "#f8fafc",
      ink: "#0f172a",
      muted: "#475569"
    };
  }

  return {
    label: "ROAMLY",
    bg: "#092f35",
    bg2: "#2f6f73",
    accent: "#7dd3fc",
    accent2: "#facc15",
    panel: "#ffffff",
    ink: "#102027",
    muted: "#45605f"
  };
}

function sceneSvg(input: {
  brand: SocialReelBrand;
  topic: string;
  hook: string;
  support: string;
  cta: string;
  websiteUrl: string;
  affiliateUrl?: string;
  scene: number;
}) {
  const theme = brandTheme(input.brand);
  const hook = compactText(input.hook, 78);
  const support = compactText(input.support, 112);
  const cta = compactText(input.cta, 44);
  const topic = compactText(input.topic, 42);
  const siteHost = compactText(hostLabel(input.websiteUrl), 34);
  const affiliateHost = input.affiliateUrl ? compactText(hostLabel(input.affiliateUrl), 34) : "";
  const hookLines = wrapLines(hook, input.scene === 2 ? 18 : 20, input.scene === 2 ? 3 : 2);
  const supportLines = wrapLines(support, 35, 3);
  const ctaLines = wrapLines(cta, 24, 2);
  const lowerLabel = input.scene === 3 ? (affiliateHost ? `CTA: ${siteHost} + ${affiliateHost}` : `CTA: ${siteHost}`) : topic;

  const mainPanelTop = input.scene === 2 ? 640 : 710;
  const mainPanelHeight = input.scene === 2 ? 610 : 520;

  return Buffer.from(`
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${theme.bg}"/>
        <stop offset="0.56" stop-color="${theme.bg2}"/>
        <stop offset="1" stop-color="#111827"/>
      </linearGradient>
      <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
        <feDropShadow dx="0" dy="24" stdDeviation="34" flood-color="#03101e" flood-opacity="0.34"/>
      </filter>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)"/>
    <path d="M-120 450 C 190 250, 410 330, 640 126 C 860 -68, 1130 14, 1220 220 L1220 -100 L-120 -100 Z" fill="${theme.accent}" opacity="0.28"/>
    <path d="M-160 1720 C 140 1460, 390 1510, 650 1350 C 910 1190, 1120 1320, 1240 1460 L1240 2060 L-160 2060 Z" fill="${theme.accent2}" opacity="0.20"/>
    <rect x="76" y="94" width="${input.brand === "reviewintel" ? 510 : 330}" height="76" rx="38" fill="#ffffff" opacity="0.93"/>
    <text x="124" y="144" font-family="Inter, Arial, sans-serif" font-size="28" font-weight="950" letter-spacing="4" fill="${theme.ink}">${theme.label}</text>
    <text x="86" y="294" font-family="Inter, Arial, sans-serif" font-size="35" font-weight="850" fill="#e5faff" opacity="0.92">${xmlEscape(sceneLabel(input.scene))}</text>
    <rect x="78" y="${mainPanelTop}" width="924" height="${mainPanelHeight}" rx="46" fill="${theme.panel}" opacity="0.95" filter="url(#shadow)"/>
    <text font-family="Inter, Arial, sans-serif">${textTspans(hookLines, 132, mainPanelTop + 130, input.scene === 2 ? 70 : 74, 84, theme.ink)}</text>
    ${
      input.scene === 1 || input.scene === 2
        ? `<text font-family="Inter, Arial, sans-serif">${textTspans(supportLines, 136, mainPanelTop + 350, 39, 55, theme.muted, 760)}</text>`
        : `<rect x="136" y="${mainPanelTop + 330}" width="470" height="88" rx="44" fill="${theme.accent}" opacity="0.20"/>
           <text font-family="Inter, Arial, sans-serif">${textTspans(ctaLines, 176, mainPanelTop + 388, 37, 48, theme.ink, 850)}</text>`
    }
    <rect x="78" y="1568" width="924" height="150" rx="38" fill="#ffffff" opacity="0.16"/>
    <text x="124" y="1630" font-family="Inter, Arial, sans-serif" font-size="30" font-weight="850" fill="#ffffff">${xmlEscape(lowerLabel)}</text>
    <text x="124" y="1686" font-family="Inter, Arial, sans-serif" font-size="24" font-weight="700" fill="#d7fffb" opacity="0.92">Generated vertical Reel - 9:16 MP4</text>
  </svg>`);
}

function sceneLabel(scene: number) {
  if (scene === 1) return "Plan";
  if (scene === 2) return "Check";
  return "Act";
}

function hostLabel(value: string) {
  try {
    const parsed = new URL(value);
    return parsed.hostname.replace(/^www\./, "");
  } catch {
    return value;
  }
}

async function createSceneFrame(input: {
  brand: SocialReelBrand;
  topic: string;
  hook: string;
  support: string;
  cta: string;
  websiteUrl: string;
  affiliateUrl?: string;
  scene: number;
  destination: string;
}) {
  await sharp(
    sceneSvg({
      brand: input.brand,
      topic: input.topic,
      hook: input.hook,
      support: input.support,
      cta: input.cta,
      websiteUrl: input.websiteUrl,
      affiliateUrl: input.affiliateUrl,
      scene: input.scene
    })
  )
    .png()
    .toFile(input.destination);
}

function runProcess(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}`));
    });
  });
}

async function resolveFfmpegPath() {
  const candidates = [
    process.env.FFMPEG_PATH?.trim(),
    process.platform === "linux" ? path.join(process.cwd(), "node_modules/@ffmpeg-installer/linux-x64/ffmpeg") : "",
    process.platform === "darwin" && process.arch === "arm64" ? path.join(process.cwd(), "node_modules/@ffmpeg-installer/darwin-arm64/ffmpeg") : "",
    process.platform === "darwin" ? path.join(process.cwd(), "node_modules/@ffmpeg-installer/darwin-x64/ffmpeg") : ""
  ].filter(Boolean);
  const binary = candidates.find((candidate) => typeof candidate === "string" && existsSync(candidate)) as string | undefined;
  if (!binary) throw new Error("ffmpeg binary path is not available.");
  return binary;
}

function runProcessOutput(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}`));
    });
  });
}

async function probeGeneratedMp4(filePath: string, ffprobePath: string) {
  const raw = await runProcessOutput(ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath]);
  const probe = JSON.parse(raw) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const formatName = String(probe.format?.format_name || "").split(",")[0];
  const widthValue = Number(video?.width);
  const heightValue = Number(video?.height);
  const durationValue = Number(video?.duration || probe.format?.duration);
  const sizeValue = Number(probe.format?.size);
  if (formatName !== "mp4" || video?.codec_name !== "h264" || !Number.isFinite(widthValue) || !Number.isFinite(heightValue) || Math.abs(widthValue / heightValue - 9 / 16) > 0.01 || !Number.isFinite(durationValue) || durationValue <= 0 || !Number.isFinite(sizeValue) || sizeValue <= 0 || sizeValue > publicSocialMaxBytes) {
    throw new Error("Generated Reel failed ffprobe validation for MP4, H.264, 9:16, duration, or file size.");
  }
  return { probe, width: widthValue, height: heightValue, durationSeconds: durationValue, size: sizeValue };
}

function safeFilenamePart(value: string) {
  return value
    .replace(/[^a-z0-9-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 48);
}

export async function generateFreshSocialReelVideo(input: GenerateFreshSocialReelVideoInput): Promise<SocialReelVideoResult> {
  const audioTrack = selectApprovedAudioTrack(input.audioSeed || input.topic || input.brand);
  const cleanTopic = safeFilenamePart(input.topic || "social-reel") || "social-reel";
  const digest = createHash("sha1")
    .update(`${input.brand}-${cleanTopic}-${input.caption}-${input.audioSeed}`)
    .digest("hex")
    .slice(0, 10);
  const filename = `${input.brand}-fresh-reel-${new Date().toISOString().slice(0, 10)}-${cleanTopic}-${digest}.mp4`;
  const objectPath = `social/videos/${input.brand}/${filename}`;
  const tmpDir = path.join(os.tmpdir(), `${input.brand}-fresh-reel-${cleanTopic}-${randomUUID()}`);
  const outputPath = path.join(tmpDir, filename);

  await mkdir(tmpDir, { recursive: true });

  try {
    const frames = [1, 2, 3].map((scene) => path.join(tmpDir, `scene-${scene}.png`));
    const support =
      compactText(input.support, 112) ||
      (input.brand === "reviewintel"
        ? "ReviewIntel turns review patterns into clearer buying and seller decisions."
        : "Roamly keeps trip details, booking links, and daily pacing in one practical plan.");

    for (let scene = 1; scene <= 3; scene += 1) {
      await createSceneFrame({
        brand: input.brand,
        topic: input.topic,
        hook: input.hook,
        support,
        cta: input.cta,
        websiteUrl: input.websiteUrl,
        affiliateUrl: input.affiliateUrl,
        scene,
        destination: frames[scene - 1]
      });
    }

    const ffmpegPath = await resolveFfmpegPath();
    await runProcess(ffmpegPath, [
      "-y",
      "-loop",
      "1",
      "-t",
      String(sceneSeconds),
      "-i",
      frames[0],
      "-loop",
      "1",
      "-t",
      String(sceneSeconds),
      "-i",
      frames[1],
      "-loop",
      "1",
      "-t",
      String(sceneSeconds),
      "-i",
      frames[2],
      "-f",
      "lavfi",
      "-t",
      String(totalSeconds),
      "-i",
      audioTrack.lavfi,
      "-filter_complex",
      `[0:v][1:v][2:v]concat=n=3:v=1:a=0,format=yuv420p,fps=30[v];[3:a]volume=${audioTrack.volume},afade=t=in:st=0:d=0.5,afade=t=out:st=8.2:d=0.8[a]`,
      "-map",
      "[v]",
      "-map",
      "[a]",
      "-shortest",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      "-c:a",
      "aac",
      "-b:a",
      "96k",
      outputPath
    ]);

    const ffprobePath = existsSync((ffprobeInstaller as { path?: string }).path || "") ? (ffprobeInstaller as { path: string }).path : path.join(process.cwd(), "node_modules/ffprobe-static/bin/linux/x64/ffprobe");
    const validated = await probeGeneratedMp4(outputPath, ffprobePath);
    const buffer = await readFile(outputPath);
    const size = await stat(outputPath).then((item) => item.size).catch(() => buffer.length);
    const { storageBucket } = publicSocialMediaStorageBucket();
    const publicUrl = await uploadPublicSupabaseObject({
      supabaseUrl: cleanSupabaseUrl(input.supabaseUrl),
      serviceKey: input.serviceKey,
      storageBucket,
      objectPath,
      body: new Blob([new Uint8Array(buffer)], { type: "video/mp4" }),
      contentType: "video/mp4",
      allowedMimeTypes: ["video/mp4", "image/png", "image/jpeg", "image/webp"],
      fileSizeLimit: publicSocialMaxBytes,
      fetcher: input.fetcher
    });

    return {
      filename,
      objectPath,
      publicUrl,
      size,
      width,
      height,
      durationSeconds: validated.durationSeconds,
      mimeType: "video/mp4",
      ffprobe: validated.probe,
      audioTrack
    };
  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => null);
  }
}
