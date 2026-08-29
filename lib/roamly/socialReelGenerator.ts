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

type GenerateStaticSocialPosterReelVideoInput = {
  brand: SocialReelBrand;
  sourceImageUrl: string;
  topic: string;
  supabaseUrl: string;
  serviceKey: string;
  audioSeed: string;
  fetcher?: typeof fetch;
};

const width = 1080;
const height = 1920;
const sceneSeconds = 4;
const sceneCount = 5;
const totalSeconds = sceneSeconds * sceneCount;
const publicSocialMaxBytes = 50 * 1024 * 1024;

const approvedGeneratedAudioTracks: ApprovedAudioTrack[] = [
  {
    id: "silent-facebook-reel",
    name: "Silent Facebook Reel",
    license: "No generated audio. Uploaded videos keep their own audio; generated fallback videos are silent.",
    lavfi: "",
    volume: 0
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
  fontBase64: string;
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
  const lowerLabel = input.scene === 3 ? (affiliateHost ? `CTA: ${siteHost} + ${affiliateHost}` : `CTA: ${siteHost}`) : topic;

  const mainPanelTop = input.scene === 2 ? 640 : input.scene === 4 ? 580 : 710;
  const mainPanelHeight = input.scene === 2 ? 610 : input.scene === 4 ? 700 : 520;
  const font = "Roamly Sans, Arial, sans-serif";
  const panelContent = input.scene === 4
    ? `<circle cx="540" cy="940" r="205" fill="${theme.bg}" stroke="${theme.accent2}" stroke-width="14"/><text x="540" y="1025" text-anchor="middle" font-family="${font}" font-size="188" font-weight="900" fill="#ffffff">9.2</text><text x="540" y="1105" text-anchor="middle" font-family="${font}" font-size="28" font-weight="800" fill="${theme.accent}">TRIP CONFIDENCE</text><rect x="136" y="1195" width="808" height="22" rx="11" fill="#d1d5db"/><rect x="136" y="1195" width="690" height="22" rx="11" fill="${theme.accent2}"/><text x="136" y="1305" font-family="${font}" font-size="34" font-weight="800" fill="${theme.muted}">Pacing</text><text x="800" y="1305" font-family="${font}" font-size="34" font-weight="800" fill="${theme.ink}">Balanced</text>`
    : input.scene === 5
      ? `<text font-family="${font}">${textTspans(["Make room for", "the good parts."], 132, 900, 72, 84, theme.ink)}</text><text font-family="${font}">${textTspans(wrapLines(cta, 25, 2), 136, 1130, 40, 54, theme.muted, 760)}</text><rect x="136" y="1280" width="510" height="92" rx="46" fill="${theme.accent2}"/><text x="391" y="1340" text-anchor="middle" font-family="${font}" font-size="33" font-weight="850" fill="${theme.ink}">PLAN WITH ROAMLY</text>`
      : input.scene === 3
        ? `<rect x="136" y="${mainPanelTop + 310}" width="790" height="20" rx="10" fill="#d1d5db"/><rect x="136" y="${mainPanelTop + 310}" width="610" height="20" rx="10" fill="${theme.accent}"/><text x="136" y="${mainPanelTop + 420}" font-family="${font}" font-size="34" font-weight="800" fill="${theme.muted}">Stops organized</text><text x="790" y="${mainPanelTop + 420}" font-family="${font}" font-size="38" font-weight="850" fill="${theme.ink}">12</text>`
        : `<text font-family="${font}">${textTspans(input.scene === 2 ? supportLines : hookLines, 136, mainPanelTop + 350, 39, 55, theme.muted, 760)}</text>`;

  return Buffer.from(`
  <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>@font-face{font-family:'Roamly Sans';src:url('data:font/ttf;base64,${input.fontBase64}') format('truetype');font-weight:100 900;}</style>
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
    <text x="124" y="144" font-family="${font}" font-size="28" font-weight="950" letter-spacing="4" fill="${theme.ink}">${theme.label}</text>
    <text x="86" y="294" font-family="${font}" font-size="35" font-weight="850" fill="#e5faff" opacity="0.92">${xmlEscape(sceneLabel(input.scene))}</text>
    <rect x="78" y="${mainPanelTop}" width="924" height="${mainPanelHeight}" rx="46" fill="${theme.panel}" opacity="0.95" filter="url(#shadow)"/>
    ${input.scene < 4 ? `<text font-family="${font}">${textTspans(hookLines, 132, mainPanelTop + 130, input.scene === 2 ? 70 : 74, 84, theme.ink)}</text>` : ""}
    ${panelContent}
    <rect x="78" y="1568" width="924" height="150" rx="38" fill="#ffffff" opacity="0.16"/>
    <text x="124" y="1630" font-family="${font}" font-size="30" font-weight="850" fill="#ffffff">${xmlEscape(lowerLabel)}</text>
    <text x="124" y="1686" font-family="${font}" font-size="24" font-weight="700" fill="#d7fffb" opacity="0.92">A clearer trip, built around you.</text>
  </svg>`);
}

function sceneLabel(scene: number) {
  if (scene === 1) return "Plan";
  if (scene === 2) return "Check";
  if (scene === 3) return "Organize";
  if (scene === 4) return "Refine";
  return "Go";
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
  const fontBase64 = (await readFile(path.join(process.cwd(), "public/fonts/RoamlySans.ttf"))).toString("base64");
  await sharp(
    sceneSvg({
      brand: input.brand,
      topic: input.topic,
      hook: input.hook,
      support: input.support,
      cta: input.cta,
      websiteUrl: input.websiteUrl,
      affiliateUrl: input.affiliateUrl,
      scene: input.scene,
      fontBase64
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

function resolveFfprobePath() {
  const packagePath = (ffprobeInstaller as { path?: string }).path || "";
  const candidates = [
    packagePath,
    process.platform === "darwin" && process.arch === "arm64" ? path.join(process.cwd(), "node_modules/ffprobe-static/bin/darwin/arm64/ffprobe") : "",
    process.platform === "darwin" ? path.join(process.cwd(), "node_modules/ffprobe-static/bin/darwin/x64/ffprobe") : "",
    process.platform === "linux" && process.arch === "x64" ? path.join(process.cwd(), "node_modules/ffprobe-static/bin/linux/x64/ffprobe") : "",
  ].filter(Boolean);
  const binary = candidates.find((candidate) => existsSync(candidate));
  if (!binary) throw new Error("ffprobe binary path is not available.");
  return binary;
}

async function probeGeneratedMp4(filePath: string, ffprobePath: string) {
  const raw = await runProcessOutput(ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", filePath]);
  const probe = JSON.parse(raw) as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const video = (probe.streams || []).find((stream) => stream.codec_type === "video");
  const formatNames = String(probe.format?.format_name || "")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);

  const widthValue = Number(video?.width);
  const heightValue = Number(video?.height);
  const durationValue = Number(video?.duration || probe.format?.duration);
  const sizeValue = Number(probe.format?.size);

  const isMp4 = formatNames.includes("mp4");
  const isH264 = video?.codec_name === "h264";
  const isVertical916 =
    Number.isFinite(widthValue) &&
    Number.isFinite(heightValue) &&
    Math.abs(widthValue / heightValue - 9 / 16) <= 0.01;

  const hasValidDuration =
    Number.isFinite(durationValue) &&
    durationValue > 0;

  const hasValidSize =
    Number.isFinite(sizeValue) &&
    sizeValue > 0 &&
    sizeValue <= publicSocialMaxBytes;

  if (!isMp4 || !isH264 || !isVertical916 || !hasValidDuration || !hasValidSize) {
    console.error("[ROAMLY_REEL_VALIDATION_FAILED]", {
      formatNames,
      codec: video?.codec_name || null,
      width: widthValue,
      height: heightValue,
      durationSeconds: durationValue,
      sizeBytes: sizeValue,
      publicSocialMaxBytes,
      isMp4,
      isH264,
      isVertical916,
      hasValidDuration,
      hasValidSize
    });

    throw new Error(
      "Generated Reel failed ffprobe validation for MP4, H.264, 9:16, duration, or file size."
    );
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

async function fetchImageBuffer(url: string, fetcher: typeof fetch) {
  const response = await fetcher(url, { cache: "no-store" });
  if (!response.ok) throw new Error(`Source image returned HTTP ${response.status}.`);
  const contentType = response.headers.get("content-type") || "";
  if (contentType && !/^image\//i.test(contentType)) {
    throw new Error("Source media is not an image.");
  }
  return Buffer.from(await response.arrayBuffer());
}


export async function generateStaticSocialPosterReelVideo(input: GenerateStaticSocialPosterReelVideoInput): Promise<SocialReelVideoResult> {
  const fetcher = input.fetcher || fetch;
  const audioTrack = selectApprovedAudioTrack(input.audioSeed || input.topic || input.brand);
  const cleanTopic = safeFilenamePart(input.topic || "social-photo-reel") || "social-photo-reel";
  const digest = createHash("sha1")
    .update(`${input.brand}-${cleanTopic}-${input.sourceImageUrl}-${input.audioSeed}`)
    .digest("hex")
    .slice(0, 10);
  const filename = `${input.brand}-static-photo-reel-${new Date().toISOString().slice(0, 10)}-${cleanTopic}-${digest}.mp4`;
  const objectPath = `social/videos/${input.brand}/${filename}`;
  const tmpDir = path.join(os.tmpdir(), `${input.brand}-static-photo-reel-${cleanTopic}-${randomUUID()}`);
  const framePath = path.join(tmpDir, "source-frame.png");
  const outputPath = path.join(tmpDir, filename);

  await mkdir(tmpDir, { recursive: true });

  try {
    const image = await fetchImageBuffer(input.sourceImageUrl, fetcher);
    const theme = brandTheme(input.brand);
    await sharp(image)
      .rotate()
      .resize(width, height, {
        fit: "contain",
        background: theme.bg
      })
      .png()
      .toFile(framePath);

    const ffmpegPath = await resolveFfmpegPath();

    await runProcess(ffmpegPath, [
      "-y",
      "-loop",
      "1",
      "-framerate",
      "30",
      "-t",
      "15",
      "-i",
      framePath,
      "-vf",
      "format=yuv420p",
      "-map",
      "0:v",
      "-t",
      "15",
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",
      "-an",
      outputPath
    ]);

    const ffprobePath = resolveFfprobePath();
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
      fetcher
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
    const frames = Array.from({ length: sceneCount }, (_, index) => path.join(tmpDir, `scene-${index + 1}.png`));
    const support =
      compactText(input.support, 112) ||
      (input.brand === "reviewintel"
        ? "ReviewIntel turns review patterns into clearer buying and seller decisions."
        : "Roamly keeps trip details, booking links, and daily pacing in one practical plan.");

    for (let scene = 1; scene <= sceneCount; scene += 1) {
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

    const sceneFilters = frames
      .map(
        (_, index) =>
          `[${index}:v]zoompan=z='min(zoom+0.0015,1.12)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=${sceneSeconds * 30}:s=${width}x${height}:fps=30,format=yuv420p[v${index}]`
      )
      .join(";");

    const concatInputs = Array.from(
      { length: sceneCount },
      (_, index) => `[v${index}]`
    ).join("");

    const videoFilter =
      `${sceneFilters};${concatInputs}concat=n=${sceneCount}:v=1:a=0,format=yuv420p[v]`;

    await runProcess(ffmpegPath, [
      "-y",

      ...frames.flatMap((frame) => ["-i", frame]),

      "-filter_complex",
      videoFilter,

      "-map",
      "[v]",

      "-t",
      String(totalSeconds),
      "-c:v",
      "libx264",
      "-preset",
      "veryfast",
      "-movflags",
      "+faststart",
      "-pix_fmt",
      "yuv420p",

      "-an",

      outputPath
    ]);

    const ffprobePath = resolveFfprobePath();
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
