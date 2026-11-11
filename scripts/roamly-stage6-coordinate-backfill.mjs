// Stage 6 — coordinate backfill OPERATOR script (prepared 2026-11-11,
// NOT applied; application rides a ship on the owner's tap).
//
// Purpose: trips generated before the 2026-11-09 coordinate-carry
// fix carry itinerary items with coordinates:null even where the
// item's place identity is provable. This script fills ONLY those
// nulls, ONLY from the same place identity the generation writers
// use — the candidate the item is bound to (item.candidateId),
// resolved through the very same extractor (marketResultCoordinates)
// against, in order:
//   S1  the trip's own stored price-discovery rows
//       (roamly_price_discoveries.metadata.marketResults — the
//       generation-time market pool, persisted per trip), newest
//       discovery first, an id already resolved is never replaced;
//   S2  the destination-pack candidate table
//       (roamly_destination_candidates lat/lon for candidate_key =
//       the item's "pack:<key>" id, restricted to packs of the
//       trip's destination; a key mapping to more than one distinct
//       point across that destination's pack versions is AMBIGUOUS
//       and resolves nothing).
// Anything else is UNDERIVABLE: listed, never guessed, never
// geocoded, left exactly as stored.
//
// Hard rules, enforced in code:
//  - OWNER EXCLUSION: the run refuses to start unless
//    --exclude-user <uuid> and --exclude-trip <uuid> are given;
//    trips of that user and that trip are out of scope, always
//    (the owner's own trips heal only on his word / regeneration).
//  - Archived trips are out of scope.
//  - Fills nulls only: an item with a valid existing point is
//    never overwritten. The fill writes the writers' exact shape
//    ({ latitude, longitude } + coordinateSource "candidate" +
//    coordinatePrecision "place").
//  - Only the LATEST roamly_itineraries row per trip is written,
//    under the repair_revision optimistic lock the override writer
//    uses; a raced row is skipped (it heals on regeneration).
//  - preview_json is regenerated from the healed full_json with
//    the app's own buildPreviewFromItinerary — the same pairing
//    every itinerary writer performs.
//  - roamly_activities is deliberately NOT written: it is a
//    projection copied from the itinerary at storage time; writing
//    it directly would fork the stored truth. It heals when the
//    trip is next stored/regenerated.
//  - Rollback: every apply run writes a restore file (pre-images)
//    + a run log (outcomes) BEFORE each update lands; --mode
//    rollback replays the pre-images for exactly the trips the run
//    log marks applied.
//
// Modes:
//   census   (default) read-only counts per derivation class
//   apply    requires --confirm and the two ROAMLY_BACKFILL_* envs
//   rollback requires --restore <restore.jsonl> --runlog <runlog.jsonl>
//
// Invocation (from the tree root):
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     --import ./scripts/roamly-test-server-only-register.mjs \
//     scripts/roamly-stage6-coordinate-backfill.mjs --mode census \
//     --exclude-user <owner-uuid> --exclude-trip <owner-trip-uuid>
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { marketResultCoordinates, validCoordinatePair } from "@/lib/roamly/timelineGrounding.ts";
import { buildPreviewFromItinerary } from "@/lib/itinerary.ts";

/* ------------------------------------------------------------ */
/* Pure derivation core (pinned by test:stage6-coordinate-backfill) */
/* ------------------------------------------------------------ */

function existingPoint(item) {
  const coordinates =
    item && typeof item === "object" && item.coordinates && typeof item.coordinates === "object" && !Array.isArray(item.coordinates)
      ? item.coordinates
      : null;
  if (!coordinates) return null;
  return (
    validCoordinatePair(coordinates.latitude, coordinates.longitude) ||
    validCoordinatePair(coordinates.lat, coordinates.lon) ||
    validCoordinatePair(coordinates.lat, coordinates.lng)
  );
}

/**
 * Build the candidateId → point map from the trip's discovery
 * market pools (S1) and pack candidate rows (S2).
 * discoveryPools: TravelMarketResult[][] in preference order
 * (newest first) — an id already resolved is never replaced.
 * packRows: [{ candidate_key, lat, lon }] for the trip's
 * destination packs — a key with more than one distinct point is
 * ambiguous and resolves nothing (reported in `ambiguousPackKeys`).
 */
export function deriveCandidatePoints({ discoveryPools = [], packRows = [] } = {}) {
  const points = new Map();
  for (const pool of discoveryPools) {
    for (const result of pool || []) {
      if (!result || typeof result.id !== "string" || points.has(result.id)) continue;
      const point = marketResultCoordinates(result);
      if (point) points.set(result.id, point);
    }
  }
  const packPointsByKey = new Map();
  const ambiguousPackKeys = new Set();
  for (const row of packRows || []) {
    if (!row || typeof row.candidate_key !== "string") continue;
    const point = validCoordinatePair(row.lat, row.lon);
    if (!point) continue;
    const key = row.candidate_key;
    const prior = packPointsByKey.get(key);
    if (prior && (prior.latitude !== point.latitude || prior.longitude !== point.longitude)) {
      ambiguousPackKeys.add(key);
      packPointsByKey.delete(key);
      continue;
    }
    if (!ambiguousPackKeys.has(key)) packPointsByKey.set(key, point);
  }
  for (const [key, point] of packPointsByKey) {
    const id = `pack:${key}`;
    if (!points.has(id)) points.set(id, point);
  }
  return { points, ambiguousPackKeys: [...ambiguousPackKeys] };
}

/**
 * Fill null item points in one stored itinerary from the resolved
 * candidate points. Pure: returns a new itinerary object plus the
 * fill and underivable ledgers. Fills nulls only; an item whose
 * candidate cannot be resolved is listed, never guessed.
 */
export function fillItineraryCoordinates(fullJson, points) {
  const fills = [];
  const underivable = [];
  if (!fullJson || typeof fullJson !== "object" || !Array.isArray(fullJson.daily_itinerary)) {
    return { itinerary: fullJson, fills, underivable, malformed: true };
  }
  const days = fullJson.daily_itinerary.map((day) => {
    if (!day || typeof day !== "object" || !Array.isArray(day.live_timeline)) return day;
    const items = day.live_timeline.map((item) => {
      if (!item || typeof item !== "object") return item;
      if (existingPoint(item)) return item;
      const candidateId = typeof item.candidateId === "string" ? item.candidateId : "";
      const point = candidateId ? points.get(candidateId) : undefined;
      if (!point) {
        underivable.push({
          dayNumber: day.day_number ?? null,
          title: typeof item.title === "string" ? item.title : null,
          candidateId: candidateId || null,
          reason: candidateId ? "candidate_point_not_provable" : "no_candidate_id"
        });
        return item;
      }
      fills.push({
        dayNumber: day.day_number ?? null,
        title: typeof item.title === "string" ? item.title : null,
        candidateId,
        latitude: point.latitude,
        longitude: point.longitude
      });
      return {
        ...item,
        coordinates: { latitude: point.latitude, longitude: point.longitude },
        coordinateSource: "candidate",
        coordinatePrecision: "place"
      };
    });
    return { ...day, live_timeline: items };
  });
  return { itinerary: { ...fullJson, daily_itinerary: days }, fills, underivable, malformed: false };
}

/* ------------------------------------------------------------ */
/* Operator shell (never runs under the test suite)              */
/* ------------------------------------------------------------ */

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] || "" : "";
}

async function main() {
  const mode = argValue("--mode") || "census";
  const excludeUser = argValue("--exclude-user");
  const excludeTrip = argValue("--exclude-trip");
  if (!excludeUser || !excludeTrip) {
    console.error("REFUSED: --exclude-user <uuid> and --exclude-trip <uuid> are required (owner exclusion is structural, not optional).");
    process.exit(2);
  }
  const url = process.env.ROAMLY_BACKFILL_SUPABASE_URL || "";
  const serviceKey = process.env.ROAMLY_BACKFILL_SERVICE_ROLE_KEY || "";
  if (!url || !serviceKey) {
    console.error("REFUSED: ROAMLY_BACKFILL_SUPABASE_URL and ROAMLY_BACKFILL_SERVICE_ROLE_KEY must be set (dedicated names on purpose).");
    process.exit(2);
  }
  const supabase = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (mode === "rollback") {
    const restorePath = argValue("--restore");
    const runlogPath = argValue("--runlog");
    if (!restorePath || !runlogPath) {
      console.error("REFUSED: rollback needs --restore <file> and --runlog <file> from the same apply run.");
      process.exit(2);
    }
    const applied = new Map(
      readFileSync(runlogPath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => row.applied).map((row) => [row.itinerary_id, row])
    );
    const preImages = readFileSync(restorePath, "utf8").split("\n").filter(Boolean).map((line) => JSON.parse(line)).filter((row) => applied.has(row.itinerary_id));
    for (const pre of preImages) {
      // Restore ONLY a row nothing else has written since the apply:
      // its current revision must still equal the apply run's
      // revision_after. A moved row was regenerated or repaired in
      // the meantime — restoring its pre-image would clobber newer
      // truth, so it is skipped for manual review instead.
      const expected = applied.get(pre.itinerary_id).revision_after;
      const { data: current } = await supabase
        .from("roamly_itineraries")
        .select("repair_revision")
        .eq("id", pre.itinerary_id)
        .maybeSingle();
      if (!current || Number(current.repair_revision) !== expected) {
        console.log(`rollback ${pre.itinerary_id}: SKIPPED (row moved since apply — manual review)`);
        continue;
      }
      const { data } = await supabase
        .from("roamly_itineraries")
        .update({ full_json: pre.full_json, preview_json: buildPreviewFromItinerary(pre.full_json), repair_revision: expected + 1 })
        .eq("id", pre.itinerary_id)
        .eq("repair_revision", expected)
        .select("id");
      console.log(`rollback ${pre.itinerary_id}: ${data?.length ? "restored" : "NOT RESTORED (raced)"}`);
    }
    return;
  }

  if (mode !== "census" && mode !== "apply") {
    console.error(`REFUSED: unknown --mode ${mode}`);
    process.exit(2);
  }
  if (mode === "apply" && !process.argv.includes("--confirm")) {
    console.error("REFUSED: apply mode needs --confirm.");
    process.exit(2);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const restorePath = `stage6-backfill-restore-${stamp}.jsonl`;
  const runlogPath = `stage6-backfill-runlog-${stamp}.jsonl`;
  if (mode === "apply") {
    writeFileSync(restorePath, "");
    writeFileSync(runlogPath, "");
  }

  const { data: trips, error: tripsError } = await supabase
    .from("roamly_trips")
    .select("id,user_id,status,destination,destination_name,destination_city,latest_price_discovery_id")
    .neq("status", "archived")
    .neq("user_id", excludeUser)
    .neq("id", excludeTrip)
    .order("created_at", { ascending: true });
  if (tripsError) throw new Error(`trip census read failed: ${tripsError.message}`);

  const totals = { trips: 0, filledItems: 0, underivable: 0, byReason: {} };
  for (const trip of trips || []) {
    const { data: itinRows } = await supabase
      .from("roamly_itineraries")
      .select("id,full_json,repair_revision,created_at")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false })
      .limit(1);
    const itin = itinRows?.[0];
    if (!itin?.full_json) continue;

    const { data: discoveries } = await supabase
      .from("roamly_price_discoveries")
      .select("id,metadata,created_at")
      .eq("trip_id", trip.id)
      .order("created_at", { ascending: false });
    const pools = [...(discoveries || [])]
      .sort((a, b) => (a.id === trip.latest_price_discovery_id ? -1 : b.id === trip.latest_price_discovery_id ? 1 : 0))
      .map((row) => (Array.isArray(row?.metadata?.marketResults) ? row.metadata.marketResults : []));

    const destinationText = String(trip.destination_name || trip.destination_city || trip.destination || "").trim().toLowerCase();
    let packRows = [];
    if (destinationText) {
      const { data: packs } = await supabase
        .from("roamly_destination_packs")
        .select("id,destination_name")
        .eq("status", "ready");
      const packIds = (packs || []).filter((pack) => String(pack.destination_name || "").trim().toLowerCase() === destinationText).map((pack) => pack.id);
      if (packIds.length) {
        const { data: candidates } = await supabase
          .from("roamly_destination_candidates")
          .select("candidate_key,lat,lon")
          .in("pack_id", packIds)
          .not("lat", "is", null)
          .not("lon", "is", null);
        packRows = candidates || [];
      }
    }

    const { points } = deriveCandidatePoints({ discoveryPools: pools, packRows });
    const { itinerary, fills, underivable } = fillItineraryCoordinates(itin.full_json, points);
    totals.trips += 1;
    totals.filledItems += fills.length;
    totals.underivable += underivable.length;
    for (const entry of underivable) totals.byReason[entry.reason] = (totals.byReason[entry.reason] || 0) + 1;
    if (!fills.length) continue;

    if (mode === "census") {
      console.log(`census trip ${trip.id}: ${fills.length} fillable, ${underivable.length} underivable`);
      continue;
    }

    const revision = Number(itin.repair_revision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      appendFileSync(runlogPath, JSON.stringify({ itinerary_id: itin.id, trip_id: trip.id, applied: false, reason: "REPAIR_REVISION_UNAVAILABLE" }) + "\n");
      continue;
    }
    appendFileSync(restorePath, JSON.stringify({ itinerary_id: itin.id, trip_id: trip.id, repair_revision: revision, full_json: itin.full_json }) + "\n");
    const { data: updated } = await supabase
      .from("roamly_itineraries")
      .update({ full_json: itinerary, preview_json: buildPreviewFromItinerary(itinerary), repair_revision: revision + 1 })
      .eq("id", itin.id)
      .eq("repair_revision", revision)
      .select("id");
    const applied = Boolean(updated?.length);
    appendFileSync(runlogPath, JSON.stringify({ itinerary_id: itin.id, trip_id: trip.id, applied, revision_after: applied ? revision + 1 : null, fills: fills.length, reason: applied ? null : "RACED_OR_MISSING" }) + "\n");
    console.log(`apply trip ${trip.id}: ${applied ? `${fills.length} items filled` : "SKIPPED (raced)"}`);
  }

  console.log(JSON.stringify({ mode, ...totals, restorePath: mode === "apply" ? restorePath : null, runlogPath: mode === "apply" ? runlogPath : null }, null, 2));
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith("roamly-stage6-coordinate-backfill.mjs");
if (invokedDirectly) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
