// Overture Places extract slicer (SPEED FIX F1, 2026-11-07) — the
// offline half of the prebuilt-extract pack lane.
//
// Roamly's pack builder used to collect every fresh destination
// LIVE from Overpass mirrors (up to the 210 s collection deadline,
// behind an hourly cron). This tool cuts a per-destination extract
// from the Overture Maps Places public S3 parquet release
// (CDLA Permissive 2.0) using HTTP RANGE READS ONLY: it lists the
// release's part files, reads each file's parquet footer metadata
// (a few MB), keeps only the row groups whose bbox statistics
// intersect the destination's box, and reads only those row
// groups' needed columns. A city slice reads tens of MB, never
// the ~11 GB dataset.
//
// The output is a static JSON extract
//   <outDir>/<destinationId>.json
// in the "roamly-overture-extract-1" format that the runtime
// collector (lib/roamly/engine/packs/overtureExtract.ts) consumes.
// Publish the extracts anywhere static (object storage / CDN) and
// point ROAMLY_PACK_EXTRACT_URL_TEMPLATE or
// ROAMLY_PACK_EXTRACT_DIR at them; re-slice on each monthly
// Overture release. Extract destinations are ordinary registry
// destinations: the destinationId and collection bbox are derived
// with the codebase's own destinationRegistryId + shadowBBox, so a
// slice always matches the registry row production registers for
// the same (country, name, centre).
//
// Deps: hyparquet + hyparquet-compressors (devDependencies, pure
// JS). No AWS credentials: the bucket is public and reads are
// plain HTTPS range requests.
//
// Run:
//   node --experimental-strip-types --import ./scripts/roamly-phase5-test-register.mjs \
//     scripts/roamly-overture-extract-slice.mjs \
//     --name Fukuoka --country Japan --lat 33.5904 --lon 130.4017 \
//     --kind "big city" --tz Asia/Tokyo [--release 2026-10-21.0] [--out DIR]
//
// The extract intentionally carries the destination's seed bbox
// ONLY. Deliberate subregion coverage boxes stay a live-collection
// concern: a destination with coverageBoxes should keep the
// Overpass lane (the runtime collector falls back when an
// extract's classified sights are thin, and an extract sliced
// without the subregions would look exactly that thin).

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parquetMetadataAsync, parquetRead } from "hyparquet";
import { compressors } from "hyparquet-compressors";
import { destinationRegistryId, shadowBBox } from "@/lib/roamly/engine/packs/destinations.ts";

export const OVERTURE_S3_BASE = "https://overturemaps-us-west-2.s3.amazonaws.com";
export const OVERTURE_EXTRACT_FORMAT = "roamly-overture-extract-1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Fetch with a hard per-attempt timeout and bounded retries —
 *  the sandbox/proxy lesson of the first slice run: a single
 *  stalled range request must never hang the slicer. */
async function fetchRetry(url, init, attempts = 4) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { ...init, signal: AbortSignal.timeout(120_000) });
    } catch (err) {
      last = err;
      await sleep(800 * (i + 1));
    }
  }
  throw last;
}

/** hyparquet AsyncBuffer over HTTP range requests. */
function rangeBuffer(url, byteLength) {
  return {
    byteLength,
    async slice(start, end = byteLength) {
      const res = await fetchRetry(url, { headers: { Range: `bytes=${start}-${end - 1}` } });
      if (!res.ok && res.status !== 206) throw new Error(`range request failed: HTTP ${res.status} for ${url}`);
      return res.arrayBuffer();
    }
  };
}

async function listKeys(prefix) {
  const keys = [];
  let token = null;
  for (;;) {
    const params = new URLSearchParams({ "list-type": "2", prefix, "max-keys": "1000" });
    if (token) params.set("continuation-token", token);
    const xml = await (await fetchRetry(`${OVERTURE_S3_BASE}/?${params}`)).text();
    for (const m of xml.matchAll(/<Key>([^<]+)<\/Key>/g)) keys.push(m[1]);
    const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
    const next = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    if (!truncated || !next) return keys;
    token = next;
  }
}

export async function latestOvertureRelease() {
  const keys = await listKeys("release/");
  const releases = [...new Set(keys.map((k) => k.split("/")[1]).filter(Boolean))].sort();
  const latest = releases[releases.length - 1];
  if (!latest) throw new Error("no Overture releases found on S3");
  return latest;
}

function bboxStat(rg, leaf) {
  const col = rg.columns.find((c) => (c.meta_data?.path_in_schema || []).join(".") === `bbox.${leaf}`);
  const s = col?.meta_data.statistics;
  return s ? { min: Number(s.min_value), max: Number(s.max_value) } : null;
}

function rowGroupIntersects(rg, bbox) {
  const x0 = bboxStat(rg, "xmin");
  const x1 = bboxStat(rg, "xmax");
  const y0 = bboxStat(rg, "ymin");
  const y1 = bboxStat(rg, "ymax");
  if (!x0 || !x1 || !y0 || !y1) return false;
  return x1.max >= bbox.minLon && x0.min <= bbox.maxLon && y1.max >= bbox.minLat && y0.min <= bbox.maxLat;
}

const SLICE_COLUMNS = ["id", "names", "taxonomy", "websites", "bbox", "operating_status", "confidence"];

/** Overture stores bbox as float32, so a point's xmin/xmax differ
 *  by ~1 m of rounding: the point is the box's centre. */
function rowToRecord(row) {
  const name = row.names?.primary || null;
  if (!name || !row.bbox) return null;
  const lat = (Number(row.bbox.ymin) + Number(row.bbox.ymax)) / 2;
  const lon = (Number(row.bbox.xmin) + Number(row.bbox.xmax)) / 2;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const primary = row.taxonomy?.primary || null;
  const alternates = Array.isArray(row.taxonomy?.alternates) ? row.taxonomy.alternates.filter((v) => typeof v === "string") : [];
  const categories = [...new Set([primary, ...alternates].filter(Boolean))];
  return {
    place_id: `overture:${row.id}`,
    name,
    lat,
    lon,
    category: primary,
    categories,
    category_hierarchy: Array.isArray(row.taxonomy?.hierarchy) ? row.taxonomy.hierarchy.filter((v) => typeof v === "string") : [],
    website: Array.isArray(row.websites) && typeof row.websites[0] === "string" ? row.websites[0] : null,
    confidence: typeof row.confidence === "number" ? row.confidence : null,
    operating_status: typeof row.operating_status === "string" ? row.operating_status : null
  };
}

export async function sliceOvertureExtract({ release, bbox, concurrency = 6 }) {
  const startedAt = Date.now();
  const prefix = `release/${release}/theme=places/type=place/`;
  const keys = (await listKeys(prefix)).filter((k) => k.endsWith(".parquet"));
  if (!keys.length) throw new Error(`no parquet files under ${prefix}`);

  const hits = [];
  const queue = [...keys];
  let scanned = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (queue.length) {
        const key = queue.shift();
        const url = `${OVERTURE_S3_BASE}/${key}`;
        const head = await fetchRetry(url, { method: "HEAD" });
        const file = rangeBuffer(url, Number(head.headers.get("content-length")));
        const metadata = await parquetMetadataAsync(file);
        scanned += 1;
        let rowStart = 0;
        metadata.row_groups.forEach((rg, rgIndex) => {
          const rows = Number(rg.num_rows);
          if (rowGroupIntersects(rg, bbox)) hits.push({ key, file, rgIndex, rowStart, rowEnd: rowStart + rows });
          rowStart += rows;
        });
      }
    })
  );
  const scanMs = Date.now() - startedAt;

  const byId = new Map();
  let rowsRead = 0;
  for (const hit of hits) {
    await parquetRead({
      file: hit.file,
      compressors,
      columns: SLICE_COLUMNS,
      rowStart: hit.rowStart,
      rowEnd: hit.rowEnd,
      rowFormat: "object",
      onComplete: (data) => {
        rowsRead += data.length;
        for (const row of data) {
          const rec = rowToRecord(row);
          if (!rec) continue;
          if (rec.lat < bbox.minLat || rec.lat > bbox.maxLat || rec.lon < bbox.minLon || rec.lon > bbox.maxLon) continue;
          if (!byId.has(rec.place_id)) byId.set(rec.place_id, rec);
        }
      }
    });
  }
  return {
    release,
    records: [...byId.values()],
    stats: {
      filesScanned: scanned,
      rowGroupsRead: hits.length,
      rowsRead,
      scanMs,
      totalMs: Date.now() - startedAt
    }
  };
}

function arg(name, fallback = null) {
  const idx = process.argv.indexOf(`--${name}`);
  return idx >= 0 && process.argv[idx + 1] ? process.argv[idx + 1] : fallback;
}

async function main() {
  const displayName = arg("name");
  const country = arg("country");
  const lat = Number(arg("lat"));
  const lon = Number(arg("lon"));
  const kind = arg("kind", "city");
  const timeZone = arg("tz", "UTC");
  if (!displayName || !country || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    throw new Error("required: --name, --country, --lat, --lon (optional: --kind, --tz, --release, --out)");
  }
  const centre = { lat, lon };
  const bbox = shadowBBox(centre, kind);
  const destinationId = destinationRegistryId(country, displayName, centre);
  const release = arg("release") || (await latestOvertureRelease());
  const outDir = arg("out", process.env.ROAMLY_PACK_EXTRACT_DIR || "pack-extracts");

  console.log(`slicing ${displayName} (${country}) from Overture release ${release} ...`);
  const { records, stats } = await sliceOvertureExtract({ release, bbox });
  const extract = {
    format: OVERTURE_EXTRACT_FORMAT,
    release,
    slicedAt: new Date().toISOString(),
    destination: { destinationId, displayName, country, centre, bbox, timeZone },
    records
  };
  await mkdir(outDir, { recursive: true });
  const outPath = path.join(outDir, `${destinationId}.json`);
  await writeFile(outPath, JSON.stringify(extract));
  const byPrimary = {};
  for (const r of records) byPrimary[r.category || "(none)"] = (byPrimary[r.category || "(none)"] || 0) + 1;
  const top = Object.entries(byPrimary).sort((a, b) => b[1] - a[1]).slice(0, 12);
  console.log(
    JSON.stringify(
      { destinationId, outPath, records: records.length, stats, topCategories: top },
      null,
      1
    )
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
