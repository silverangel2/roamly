import { spawn } from "child_process";
import { createRequire } from "module";
import { mkdir, readFile, writeFile } from "fs/promises";
import Module from "module";
import path from "path";
import ts from "typescript";

const root = process.cwd();
const require = createRequire(import.meta.url);
const originalResolve = Module._resolveFilename;

Module._resolveFilename = function resolveAlias(request, parent, isMain, options) {
  if (typeof request === "string" && request.startsWith("@/")) {
    return originalResolve.call(this, path.join(root, request.slice(2)), parent, isMain, options);
  }
  return originalResolve.call(this, request, parent, isMain, options);
};

Module._extensions[".ts"] = function compileTypescript(module, filename) {
  const source = require("fs").readFileSync(filename, "utf8");
  const output = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
      moduleResolution: ts.ModuleResolutionKind.NodeJs,
      jsx: ts.JsxEmit.ReactJSX
    },
    fileName: filename
  });
  module._compile(output.outputText, filename);
};

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(stderr.trim() || `${path.basename(command)} exited with code ${code}`));
    });
  });
}

function responseJson(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" }
  });
}

async function bodyToBuffer(body) {
  if (!body) return Buffer.alloc(0);
  if (Buffer.isBuffer(body)) return body;
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body.arrayBuffer === "function") return Buffer.from(await body.arrayBuffer());
  throw new Error(`Unsupported upload body type: ${typeof body}`);
}

async function main() {
  const generator = require(path.join(root, "lib/roamly/socialReelGenerator.ts"));
  const uploads = new Map();

  const fetcher = async (url, init = {}) => {
    const method = String(init.method || "GET").toUpperCase();
    const parsed = new URL(String(url));

    if (parsed.pathname.startsWith("/storage/v1/bucket/")) {
      return responseJson({ id: "roamly-social-public", name: "roamly-social-public", public: true });
    }

    if (method === "POST" && parsed.pathname.startsWith("/storage/v1/object/")) {
      const buffer = await bodyToBuffer(init.body);
      uploads.set(parsed.pathname, buffer);
      return responseJson({ Key: parsed.pathname });
    }

    if ((method === "HEAD" || method === "GET") && parsed.pathname.startsWith("/storage/v1/object/public/")) {
      return new Response(method === "HEAD" ? null : Buffer.from("ok"), { status: 200 });
    }

    return responseJson({ error: `Unexpected mocked fetch: ${method} ${parsed.pathname}` }, 500);
  };

  const result = await generator.generateFreshSocialReelVideo({
    brand: "roamly",
    topic: "Facebook Reel audio regression proof",
    hook: "Roamly plans the trip before the day gets crowded.",
    support: "Flights, hotels, routes, meals, and backup timing stay connected in one practical travel plan.",
    cta: "Plan your next trip with Roamly",
    caption: "Non-publishing local proof.",
    hashtags: ["Roamly", "TravelPlanning"],
    websiteUrl: "https://roamlyhq.com/plan",
    supabaseUrl: "https://example.supabase.co",
    serviceKey: "local-proof-service-key",
    audioSeed: "roamly-local-audio-proof",
    fetcher
  });

  assert(result.audioTrack?.sourcePath === "public/audio/reels/roamly-theme.mp3", "generator did not report roamly-theme.mp3 as the audio source");
  assert(result.publicUrl.includes(result.objectPath), "mock upload did not return the generated public object URL");
  assert(uploads.size === 1, "expected exactly one mocked storage upload");

  await mkdir(path.join(root, "runtime-proofs"), { recursive: true });
  const outputPath = path.join(root, "runtime-proofs", `facebook-roamly-audio-proof-${Date.now()}.mp4`);
  await writeFile(outputPath, [...uploads.values()][0]);

  const ffprobePath = require("ffprobe-static").path;
  const raw = await run(ffprobePath, ["-v", "error", "-print_format", "json", "-show_streams", "-show_format", outputPath]);
  const probe = JSON.parse(raw);
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === "video");
  const audio = streams.find((stream) => stream.codec_type === "audio");

  assert(video?.codec_name === "h264", "generated MP4 does not contain H.264 video");
  assert(Number(video?.width) === 1080 && Number(video?.height) === 1920, "generated video is not 1080x1920");
  assert(audio?.codec_name === "aac", "generated MP4 does not contain AAC audio");
  assert(Number(audio?.duration || probe.format?.duration) > 0, "generated AAC audio has no duration");

  const source = await readFile(path.join(root, "lib/roamly/socialReelGenerator.ts"), "utf8");
  assert(!/sine=/i.test(source), "active generator still references sine audio");
  assert(!/anoisesrc|aevalsrc|frequency/i.test(source), "active generator still references synthetic frequency audio");
  assert(!/lavfi/.test(source), "active generator still references lavfi audio");

  console.log(JSON.stringify({
    ok: true,
    outputPath,
    objectPath: result.objectPath,
    audioSource: result.audioTrack.sourcePath,
    streams: {
      video: { codec: video.codec_name, width: video.width, height: video.height },
      audio: { codec: audio.codec_name, duration: audio.duration || probe.format?.duration }
    },
    published: false
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
