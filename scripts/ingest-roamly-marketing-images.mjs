import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const root = process.cwd();
const campaignId = "roamly-premium-reels-2026-08";
const campaignDir = path.join(root, "content/social/roamly-25-day-reel-campaign");
const sourceDir = path.join(campaignDir, "sources");
const manifestPath = path.join(campaignDir, "marketing-image-rights.json");
const productionProjectRef = "ikrfkpnbtkdohoxnbphu";
const storageBucket = "roamly-social-public";
const allowedTypes = new Map([
  [".png", { contentType: "image/png", signature: Buffer.from([0x89, 0x50, 0x4e, 0x47]) }],
  [".jpg", { contentType: "image/jpeg", signature: Buffer.from([0xff, 0xd8, 0xff]) }],
  [".jpeg", { contentType: "image/jpeg", signature: Buffer.from([0xff, 0xd8, 0xff]) }],
  [".webp", { contentType: "image/webp", signature: Buffer.from("RIFF") }]
]);

function clean(value) {
  return String(value || "").trim();
}

function parseEnvValue(value) {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

async function loadEnvFile(file) {
  let text = "";
  try { text = await readFile(file, "utf8"); } catch { return; }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (match && process.env[match[1]] === undefined) process.env[match[1]] = parseEnvValue(match[2]);
  }
}

function hash(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function stableUuid(value) {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function isPrivateOrCustomerPath(value) {
  return /(^|[/\\])(?:customer|customers|private|trip|trips|gmail|uploads|profile|profiles)([/\\]|$)/i.test(clean(value));
}

function isApprovedRightsDeclaration(entry) {
  return Boolean(
    entry &&
    entry.rightsStatus === "approved" &&
    clean(entry.rightsBasis) &&
    entry.marketingUseAllowed === true &&
    entry.publicSocialUseAllowed === true &&
    !isPrivateOrCustomerPath(entry.source)
  );
}

function assetRecord({ source, contentHash, objectPath, publicUrl, declaration, campaign }) {
  const sourceName = path.basename(source);
  return {
    id: stableUuid(`${campaignId}:marketing-image:${contentHash}`),
    platform: "facebook_roamly",
    status: "approved",
    title: `Roamly marketing source - ${sourceName}`,
    media_url: publicUrl,
    asset_type: "image",
    approved_for_automation: true,
    excluded_from_automation: false,
    use_count: 0,
    source: "roamly_owned_marketing_campaign_source",
    rights_note: declaration.rightsBasis,
    metadata: {
      brand: "roamly",
      campaignId,
      sourceFilename: sourceName,
      objectPath,
      contentSha256: contentHash,
      rightsStatus: declaration.rightsStatus,
      rightsBasis: declaration.rightsBasis,
      marketingUseAllowed: declaration.marketingUseAllowed,
      publicSocialUseAllowed: declaration.publicSocialUseAllowed,
      attribution: declaration.attribution || null,
      sourceReference: declaration.sourceReference || null,
      destination: campaign?.destination || null,
      topic: campaign?.topic || null,
      ingestion: "explicit_marketing_rights_manifest"
    }
  };
}

async function readManifest() {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.schemaVersion !== 1 || manifest.campaignId !== campaignId || !Array.isArray(manifest.assets)) {
    throw new Error("Marketing rights manifest has an invalid schema or campaign ID.");
  }
  return manifest;
}

async function scanSources(manifest) {
  const declarations = new Map(manifest.assets.map((entry) => [clean(entry.source), entry]));
  const files = (await readdir(sourceDir)).filter((name) => allowedTypes.has(path.extname(name).toLowerCase())).sort();
  const accepted = [];
  const rejected = [];
  for (const name of files) {
    const declaration = declarations.get(name);
    if (!declaration || !isApprovedRightsDeclaration(declaration)) {
      rejected.push({ source: name, reason: !declaration ? "missing rights declaration" : "rights declaration is not approved or is unsafe" });
      continue;
    }
    if (isPrivateOrCustomerPath(name)) {
      rejected.push({ source: name, reason: "private/customer path rejected" });
      continue;
    }
    const type = allowedTypes.get(path.extname(name).toLowerCase());
    const filePath = path.join(sourceDir, name);
    const info = await stat(filePath);
    const buffer = await readFile(filePath);
    if (!info.isFile() || !buffer.subarray(0, type.signature.length).equals(type.signature)) {
      rejected.push({ source: name, reason: "unsupported or invalid image content" });
      continue;
    }
    accepted.push({ source: name, filePath, buffer, contentHash: hash(buffer), contentType: type.contentType, declaration });
  }
  return { files, accepted, rejected };
}

function deduplicateApprovedAssets(entries) {
  const unique = new Map();
  const duplicates = [];
  for (const entry of entries) {
    if (unique.has(entry.contentHash)) duplicates.push({ source: entry.source, duplicateOf: unique.get(entry.contentHash).source });
    else unique.set(entry.contentHash, entry);
  }
  return { unique: [...unique.values()], duplicates };
}

function parseArgs(argv) {
  return { dryRun: argv.includes("--dry-run"), production: argv.includes("--production") };
}

function projectRefFromUrl(value) {
  try { return new URL(value).hostname.split(".")[0]; } catch { return ""; }
}

async function ingest({ dryRun, production }) {
  await loadEnvFile(path.join(root, ".env.local"));
  const manifest = await readManifest();
  const scanned = await scanSources(manifest);
  const deduped = deduplicateApprovedAssets(scanned.accepted);
  const summary = {
    sourcePlatesScanned: scanned.files.length,
    rightsApproved: scanned.accepted.length,
    rightsRejectedOrUnverified: scanned.rejected.length,
    uniqueApproved: deduped.unique.length,
    duplicates: deduped.duplicates.length,
    wouldUpload: deduped.unique.length,
    wouldRegister: deduped.unique.length,
    uploaded: 0,
    registered: 0,
    alreadyPresent: 0,
    errors: []
  };

  if (!dryRun && deduped.unique.length) {
    const supabaseUrl = clean(process.env.NEXT_PUBLIC_SUPABASE_URL);
    const serviceKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
    if (!supabaseUrl || !serviceKey) throw new Error("Supabase credentials are required for non-dry-run ingestion.");
    const projectRef = projectRefFromUrl(supabaseUrl);
    if (production && projectRef !== productionProjectRef) throw new Error(`Refusing production ingestion for project ${projectRef || "unknown"}.`);
    if (!production) throw new Error("Pass --production for an explicit verified production ingestion.");
    const db = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    for (const entry of deduped.unique) {
      const ext = path.extname(entry.source).toLowerCase();
      const objectPath = `social/images/roamly/${campaignId}/${entry.contentHash}${ext}`;
      const publicUrl = `${supabaseUrl.replace(/\/$/, "")}/storage/v1/object/public/${storageBucket}/${objectPath}`;
      const uploaded = await db.storage.from(storageBucket).upload(objectPath, entry.buffer, { contentType: entry.contentType, cacheControl: "31536000", upsert: true });
      if (uploaded.error) throw new Error(`Upload failed for ${entry.source}: ${uploaded.error.message}`);
      const campaign = { destination: "Roamly campaign", topic: campaignId };
      const record = assetRecord({ source: entry.source, contentHash: entry.contentHash, objectPath, publicUrl, declaration: entry.declaration, campaign });
      const existing = await db.from("roamly_social_media_assets").select("id").eq("id", record.id).maybeSingle();
      if (existing.error) throw new Error(`Registration lookup failed for ${entry.source}: ${existing.error.message}`);
      if (existing.data) {
        summary.alreadyPresent += 1;
      } else {
        const registered = await db.from("roamly_social_media_assets").insert(record);
        if (registered.error) throw new Error(`Registration failed for ${entry.source}: ${registered.error.message}`);
        summary.registered += 1;
      }
      summary.uploaded += 1;
    }
  }

  console.log(JSON.stringify({ mode: dryRun ? "dry-run" : "production", ...summary }, null, 2));
  return summary;
}

export { assetRecord, deduplicateApprovedAssets, ingest, isApprovedRightsDeclaration, isPrivateOrCustomerPath };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dryRun && !args.production) {
    console.error("Refusing to write. Use --dry-run or explicitly pass --production.");
    process.exit(2);
  }
  ingest(args).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
