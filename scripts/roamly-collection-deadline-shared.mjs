// Shared OFFLINE assertions for the POI collection deadline contract
// (lib/roamly/engine/packs/collectors.ts collectPoiCandidates).
//
// Used by BOTH:
//   - scripts/roamly-collection-deadline-checks.mjs (standalone suite)
//   - section H of scripts/roamly-wiring-phase3-checks.mjs
// so the two surfaces can never drift apart.
//
// ZERO live network: collectPoiCandidates takes its transport as an
// injected Fetcher (collectors.ts:48-53,422-427) — that is the seam.
// The scripted fetcher below is the ONLY transport these assertions
// use; it never calls the global fetch, serves canned Overpass-shaped
// payloads after scripted latencies, and — like the real fetch —
// settles a hanging request only when the caller's AbortSignal fires.
// As a tripwire the runner also replaces globalThis.fetch with a
// counting thrower for the duration and asserts it was never called.
//
// The contract under test (collectors.ts):
//   - chunks run SEQUENTIALLY, one coverage box's 5 main chunks then
//     the wide chunk (322-332, 453): 6 chunks for a single-box
//     destination, in the order tourism, historic-parks, amenities,
//     food, markets, wide;
//   - the deadline is a START gate: a chunk whose start check finds
//     remainingMs <= 0 never starts — it is recorded in failedChunks
//     and makes the collection partial (454-459);
//   - a chunk that completes is KEPT even when later chunks fail
//     or never start: its elements are appended as it lands, its id
//     lands in succeededChunks, and its candidates survive into the
//     returned collection (479-489). (Per-attempt caps are a third
//     of the remaining budget, so a succeeding chunk in fact lands
//     before the deadline instant; a chunk whose answer cannot fit
//     that cap fails by abort and rotation, it does not slip past.)
//   - evidence reports partial = failedChunks.length > 0, the exact
//     succeeded/failed chunk lists, and per-lane element counts
//     (507-522);
//   - if NO chunk succeeds the collection throws instead of
//     returning an empty pack (496-500);
//   - each in-flight attempt is aborted via AbortController after
//     attemptTimeoutMs (77-93), and a chunk's attempts rotate over
//     the three Overpass endpoints in ONE round (361-393, chunk
//     policy maxRounds: 1 at 460-478). The per-attempt cap is a third
//     of the remaining budget with no floor, so three hanging
//     attempts fit inside the budget remaining when the chunk
//     started — the collection returns by the deadline, not a
//     floor-sized tail after it.

import { collectPoiCandidates, OVERPASS_ENDPOINTS } from "@/lib/roamly/engine/packs/collectors.ts";

export const COLLECTION_DEADLINE_DEST = {
  destinationId: "dst-collection-deadline-offline",
  centre: { lat: 46.81, lon: -71.21 },
  bbox: { minLat: 46.7, minLon: -71.35, maxLat: 46.92, maxLon: -71.07 }
};

const POLICY = { attemptTimeoutMs: 5_000, maxRounds: 1, backoffBaseMs: 1 };
export const ALL_CHUNK_IDS = ["tourism", "historic-parks", "amenities", "food", "markets", "wide"];

const el = (id, tags) => ({ type: "node", id, lat: 46.81, lon: -71.21, tags });
const ELEMENTS_BY_CHUNK = {
  tourism: [el(101, { name: "Deadline Museum", tourism: "museum" })],
  "historic-parks": [el(102, { name: "Deadline Park", leisure: "park" })],
  amenities: [el(103, { name: "Deadline Ferry", amenity: "ferry_terminal" })],
  food: [el(104, { name: "Deadline Bistro", amenity: "restaurant" })],
  markets: [el(105, { name: "Deadline Market", shop: "farm" })],
  wide: [el(106, { name: "Deadline Falls", waterway: "waterfall" })]
};
export const CANDIDATE_NAMES_BY_CHUNK = {
  tourism: "Deadline Museum",
  "historic-parks": "Deadline Park",
  amenities: "Deadline Ferry",
  food: "Deadline Bistro",
  markets: "Deadline Market",
  wide: "Deadline Falls"
};

export function chunkIdOfQuery(query) {
  if (query.includes('"waterfall"')) return "wide";
  if (query.includes('"tourism"')) return "tourism";
  if (query.includes("fast_food")) return "food";
  if (query.includes("ferry_terminal")) return "amenities";
  if (query.includes('"shop"')) return "markets";
  return "historic-parks";
}

function abortError() {
  return Object.assign(new Error("The operation was aborted"), { name: "AbortError" });
}

/** A delay that, like real fetch, rejects as soon as the signal aborts. */
function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** A request that never answers on its own; only the AbortSignal
 *  (i.e. the production attempt timeout) can settle it. */
function hangUntilAbort(signal) {
  return new Promise((_, reject) => {
    if (signal?.aborted) return reject(abortError());
    signal?.addEventListener("abort", () => reject(abortError()), { once: true });
  });
}

/**
 * Build the fake transport. `script(chunkId)` returns
 * { latencyMs } for a canned success or { hang: true } for a request
 * that only an abort can end. Every call is recorded on .calls as
 * { chunkId, url } — the suite asserts those are the only calls and
 * that they all target the known Overpass endpoints (i.e. the fake
 * fully intercepts the transport seam; nothing escapes to a network).
 */
export function makeScriptedFetcher(script) {
  const calls = [];
  const fetcher = async (url, init) => {
    const query = decodeURIComponent((init?.body || "").replace(/^data=/, ""));
    const chunkId = chunkIdOfQuery(query);
    calls.push({ chunkId, url });
    const step = script(chunkId);
    if (step.hang) await hangUntilAbort(init?.signal);
    else await abortableDelay(step.latencyMs, init?.signal);
    return {
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ elements: ELEMENTS_BY_CHUNK[chunkId] })
    };
  };
  fetcher.calls = calls;
  return fetcher;
}

export async function runCollectionDeadlineChecks({ ok, eq }, prefix = "deadline") {
  const P = (label) => `${prefix}: ${label}`;
  const allFetchers = [];
  const scripted = (script) => {
    const f = makeScriptedFetcher(script);
    allFetchers.push(f);
    return f;
  };

  // Tripwire: the global fetch must play no part at all.
  const realFetch = globalThis.fetch;
  let globalFetchCalls = 0;
  globalThis.fetch = () => {
    globalFetchCalls += 1;
    throw new Error("offline collection-deadline checks: global fetch is forbidden");
  };
  try {
    /* (0) All-fast control: everything lands well inside the budget. */
    {
      const fetcher = scripted(() => ({ latencyMs: 15 }));
      const started = Date.now();
      const col = await collectPoiCandidates(fetcher, COLLECTION_DEADLINE_DEST, POLICY, () => new Date(), 900);
      const elapsed = Date.now() - started;
      eq(JSON.stringify(col.evidence.succeededChunks), JSON.stringify(ALL_CHUNK_IDS), P("all-fast: all 6 chunks succeed in order"));
      eq(JSON.stringify(col.evidence.failedChunks), "[]", P("all-fast: no chunk fails"));
      eq(col.evidence.partial, false, P("all-fast: collection is complete, not partial"));
      eq(
        JSON.stringify(col.candidates.map((c) => c.name)),
        JSON.stringify(ALL_CHUNK_IDS.map((id) => CANDIDATE_NAMES_BY_CHUNK[id])),
        P("all-fast: every chunk's candidate is kept, in chunk order")
      );
      eq(col.evidence.mainElements, 5, P("all-fast: main element count is the 5 main chunks"));
      eq(col.evidence.wideElements, 1, P("all-fast: wide element count is the wide chunk"));
      eq(col.evidence.mainEndpoint, OVERPASS_ENDPOINTS[0], P("all-fast: main endpoint is the first Overpass endpoint"));
      eq(col.evidence.wideEndpoint, OVERPASS_ENDPOINTS[0], P("all-fast: wide endpoint is the first Overpass endpoint"));
      eq(fetcher.calls.length, 6, P("all-fast: exactly one transport call per chunk"));
      ok(elapsed < 900, P(`all-fast: collection returned inside the 900 ms deadline (no per-call timing is printed, keeping suite output deterministic)`));
    }

    /* (a)+(b) Slow chunks crossing the deadline midway. Scripted
     * latencies are sized against the code's own per-attempt cap —
     * a chunk only succeeds if an endpoint answers within a third
     * of the budget remaining when it starts (collectors.ts chunk
     * policy) — so the first three chunks land (200/150/100 ms
     * against a 900 ms deadline), the fourth starts at ~450 ms with
     * only ~450 ms left: its scripted 400 ms answer can never fit
     * its ~150 ms per-attempt cap, its three bounded attempts
     * consume exactly the remaining budget, and chunks 5-6 must
     * never start. The results of chunks 1-3 must be KEPT with
     * partial honestly flagged, and the collection must return at
     * the deadline — NOT after every chunk's full latency. */
    {
      const latencies = { tourism: 200, "historic-parks": 150, amenities: 100, food: 400, markets: 400, wide: 400 };
      const fetcher = scripted((chunkId) => ({ latencyMs: latencies[chunkId] }));
      const started = Date.now();
      const col = await collectPoiCandidates(fetcher, COLLECTION_DEADLINE_DEST, POLICY, () => new Date(), 900);
      const elapsed = Date.now() - started;
      eq(
        JSON.stringify(col.evidence.succeededChunks),
        JSON.stringify(["tourism", "historic-parks", "amenities"]),
        P("deadline: exactly the chunks that completed inside the budget succeed")
      );
      eq(
        JSON.stringify(col.evidence.failedChunks),
        JSON.stringify(["food", "markets", "wide"]),
        P("deadline: the crossing chunk and every chunk past the deadline are recorded failed, in order")
      );
      eq(col.evidence.partial, true, P("deadline: partial is flagged when the deadline cuts the collection"));
      eq(
        JSON.stringify(col.candidates.map((c) => c.name)),
        JSON.stringify(["Deadline Museum", "Deadline Park", "Deadline Ferry"]),
        P("deadline: partial results are KEPT — candidates from completed chunks survive")
      );
      eq(col.evidence.mainElements, 3, P("deadline: main element count covers only the kept chunks"));
      eq(col.evidence.wideElements, 0, P("deadline: wide element count is zero — the wide chunk never ran"));
      eq(col.evidence.wideEndpoint, "", P("deadline: wide endpoint is empty — the wide chunk never ran"));
      eq(fetcher.calls.filter((c) => c.chunkId === "markets" || c.chunkId === "wide").length, 0, P("deadline: never-started chunks make ZERO transport calls"));
      eq(fetcher.calls.length, 6, P("deadline: transport calls are the 3 kept chunks (1 each) plus the crossing chunk's 3 bounded endpoint attempts"));
      ok(elapsed < 900 + 300, P("deadline: return is bounded by the deadline + slack, not the all-chunks total"));
      ok(elapsed >= 700, P("deadline: the crossing chunk's bounded attempts really consumed the remaining budget"));
    }

    /* (c) A single chunk hangs past the deadline: chunk 1 lands
     * fast, chunk 2 never answers (only the production AbortSignal
     * can end it). The collection must still return near the 600 ms
     * deadline — bounded by the hanging chunk's three endpoint
     * attempts fitting inside the remaining budget — with chunk 1's
     * result kept and everything else honestly failed/partial. */
    {
      const fetcher = scripted((chunkId) => (chunkId === "historic-parks" ? { hang: true } : { latencyMs: 20 }));
      const started = Date.now();
      const col = await collectPoiCandidates(fetcher, COLLECTION_DEADLINE_DEST, POLICY, () => new Date(), 600);
      const elapsed = Date.now() - started;
      eq(JSON.stringify(col.evidence.succeededChunks), JSON.stringify(["tourism"]), P("hang: only the chunk completed before the hanging chunk succeeds"));
      eq(
        JSON.stringify(col.evidence.failedChunks),
        JSON.stringify(["historic-parks", "amenities", "food", "markets", "wide"]),
        P("hang: the hanging chunk and every later chunk are recorded failed")
      );
      eq(col.evidence.partial, true, P("hang: partial is flagged"));
      eq(
        JSON.stringify(col.candidates.map((c) => c.name)),
        JSON.stringify(["Deadline Museum"]),
        P("hang: the completed chunk's candidate is kept despite the hang")
      );
      const hangCalls = fetcher.calls.filter((c) => c.chunkId === "historic-parks");
      eq(hangCalls.length, 3, P("hang: the hanging chunk is attempted exactly once per endpoint (one round)"));
      eq(
        JSON.stringify(hangCalls.map((c) => c.url)),
        JSON.stringify([...OVERPASS_ENDPOINTS]),
        P("hang: the hanging chunk's attempts rotate over all three Overpass endpoints in order")
      );
      ok(elapsed < 600 + 600, P("hang: collection returns within deadline + slack despite a chunk that never answers"));
      ok(elapsed >= 400, P("hang: the hanging chunk really consumed the budget (the abort, not an instant error, ended it)"));
    }

    /* (c2) Every chunk hangs: the first chunk's bounded attempts
     * exhaust the budget, the rest never start, and the collection
     * throws its honest total-failure error instead of hanging. */
    {
      const fetcher = scripted(() => ({ hang: true }));
      const started = Date.now();
      let threw = "";
      try {
        await collectPoiCandidates(fetcher, COLLECTION_DEADLINE_DEST, POLICY, () => new Date(), 600);
      } catch (err) {
        threw = err instanceof Error ? err.message : String(err);
      }
      const elapsed = Date.now() - started;
      ok(threw.includes("Overpass collection failed for every chunk"), P("all-hang: total failure throws honestly instead of returning an empty or hanging collection"));
      eq(fetcher.calls.filter((c) => c.chunkId === "tourism").length, 3, P("all-hang: the first chunk's attempts are bounded to one round over the endpoints"));
      ok(elapsed < 600 + 600, P("all-hang: even total hang returns (throws) within deadline + slack"));
    }
  } finally {
    globalThis.fetch = realFetch;
  }

  eq(globalFetchCalls, 0, P("offline: the global fetch was never called — zero live network in this regression"));
  const everyCall = allFetchers.flatMap((f) => f.calls);
  ok(everyCall.length > 0, P("offline: the scripted transport really served the collections"));
  ok(
    everyCall.every((c) => OVERPASS_ENDPOINTS.includes(c.url)),
    P("offline: every transport call went to a known Overpass endpoint URL through the injected fetcher only")
  );
}
