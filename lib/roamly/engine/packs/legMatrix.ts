import type { Fetcher } from "@/lib/roamly/engine/packs/collectors";
import type { StoredCandidate } from "@/lib/roamly/engine/packs/types";
import { haversineKm, type EngineLegMatrix } from "@/lib/roamly/engine/util";
import { RANK } from "@/lib/roamly/engine/solver";
import type { UtcInstant } from "@/lib/roamly/engine/time";

/*
 * legMatrix — routed leg times for a pack (consolidation
 * 2026-11-06, places evaluation verdict: OSRM ADOPT AS PRIMARY —
 * WITH CONDITIONS).
 *
 * Roamly's straight-line haversine estimate is systematically
 * optimistic (measured circuity 1.3–3.0×, worst on the short
 * urban/waterfront legs travellers feel most). The fix is shaped
 * to the evaluation's conditions:
 *
 *   - ONE /table call per profile per destination, AT PACK BUILD
 *     — the matrix is cached in the pack version; generation and
 *     solving make ZERO routing calls per trip.
 *   - The public demo server (router.project-osrm.org) silently
 *     routes "foot" on the car graph, so walking times come from
 *     the FOSSGIS foot-profile server (routing.openstreetmap.de/
 *     routed-foot), which returns true pedestrian routes.
 *   - When routing is unreachable, the build carries NO matrix
 *     and the solver falls back to haversine — LABELLED
 *     "haversine-estimate" on every leg it produces, never
 *     silently presented as a routed time.
 *
 * The matrix covers the destination centre (key "base", the
 * solver's own name for the day base) plus a capped set of
 * candidate points, chosen so the set covers the stops the
 * solver can actually pick (fix round 2026-11-07):
 *
 *   1. SOLVER SHORTLIST FIRST — at pack build the builder runs
 *      the real solver over this pack for canonical trips
 *      (packs/builder.ts solverShortlistKeys — centre-anchored
 *      AND top-stay-anchored classes) and hands over every leg
 *      endpoint it chose, in solve order. Those keys fill the
 *      matrix first: they are, by construction, the candidates
 *      the solver chooses when it solves this pack.
 *   2. PER-KIND GUARANTEE, THEN A SPLIT TOP-UP — the nearest 2
 *      candidates of every kind enter on geography alone; the
 *      remaining slots split between a (RANK, distance) tranche
 *      and a pure-distance tranche. The single rank-ordered
 *      top-up this replaced shut a real Tokyo trip's three food
 *      stops out of a perfect 100-point matrix (food = rank 9,
 *      14,627 candidates — matrix-coverage fix, 2026-11-07);
 *      the earlier kind-priority fill it had itself replaced
 *      spent all 60 slots on kinds the solver's greedy chain
 *      rarely reaches (step-4 verification: Quebec City 0/18
 *      routed).
 *
 * The cap keeps one /table call per profile small (100 points
 * ≈ 10k cells per profile — still a single request, well under
 * a second at evaluation latency). The cap was raised 60 → 100
 * in the same fix round: on a 135-candidate thin pack the 60
 * cap still cut solver-chosen stops at the margin (Prayagraj
 * day-3 parks), while the shortlist + top-up order decides
 * WHICH points matter far more than the exact cap.
 */

export const OSRM_CAR_TABLE_URL = "https://router.project-osrm.org/table/v1/driving";
export const OSRM_FOOT_TABLE_URL = "https://routing.openstreetmap.de/routed-foot/table/v1/driving";
export const LEG_MATRIX_MAX_POINTS = 100;
export const LEG_MATRIX_PROVIDER = "osrm-table(car:router.project-osrm.org,foot:routing.openstreetmap.de)";

interface OsrmTablePayload {
  code?: string;
  durations?: (number | null)[][];
}

async function fetchOsrmDurations(
  fetcher: Fetcher,
  baseUrl: string,
  points: { lat: number; lon: number }[],
  timeoutMs: number
): Promise<(number | null)[][] | null> {
  const coords = points.map((p) => `${p.lon},${p.lat}`).join(";");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetcher(`${baseUrl}/${coords}?annotations=duration`, {
      headers: { "User-Agent": "RoamlyZeroEngine/1.0 (pack leg matrix; contact: support@roamlyhq.com)" },
      signal: controller.signal
    });
    if (!res.ok) return null;
    const json = JSON.parse(await res.text()) as OsrmTablePayload;
    if (json.code !== "Ok" || !Array.isArray(json.durations)) return null;
    if (json.durations.length !== points.length) return null;
    return json.durations;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Per-kind near-centre guarantee size (matrix-coverage fix,
 *  2026-11-07): the nearest this-many candidates of EVERY kind
 *  enter the point set on geography alone, so no kind — food and
 *  stay above all, the solver's rank-9 defaults — can be shut
 *  out of the matrix entirely by the rank order. */
export const LEG_MATRIX_KIND_GUARANTEE = 2;

/** Choose the matrix points: centre first (key "base"), then the
 *  solver shortlist in solve order, then the per-kind near-centre
 *  guarantee, then the remaining slots split between a
 *  solver-rank tranche and a pure-distance tranche (backfilled
 *  from the rank order), capped. Candidates without a position
 *  never enter a solve, so they never enter the matrix either.
 *
 *  Why the split (matrix-coverage fix, 2026-11-07): the Tokyo
 *  pack held 14,627 candidates; the old single (RANK, distance)
 *  top-up spent all 99 slots on headline kinds and shut out the
 *  three food stops a real trip actually picked — food defaults
 *  to rank 9, so EVERY headline candidate outranked EVERY
 *  restaurant regardless of distance. The distance tranche lets
 *  near-centre candidates in on geography; the rank tranche
 *  keeps headline-kind priority for the far half (the Prayagraj
 *  day-3-parks case that motivated rank-first). Solver RANK
 *  itself is untouched. */
export function legMatrixPoints(
  centre: { lat: number; lon: number },
  candidates: readonly StoredCandidate[],
  shortlistKeys: readonly string[] = []
): { key: string; lat: number; lon: number }[] {
  const placed = candidates.filter((c) => c.pos);
  const byKey = new Map(placed.map((c) => [c.osmKey, c]));
  const chosen: StoredCandidate[] = [];
  const seen = new Set<string>();
  const take = (c: StoredCandidate | undefined): void => {
    if (c && !seen.has(c.osmKey)) {
      seen.add(c.osmKey);
      chosen.push(c);
    }
  };
  const cap = LEG_MATRIX_MAX_POINTS - 1;
  const dist = (c: StoredCandidate): number => haversineKm(centre, c.pos!);
  const rest = (): StoredCandidate[] => placed.filter((c) => !seen.has(c.osmKey));

  // 1. Solver shortlist first, in solve order (truncated at the
  // cap exactly as before when a shortlist alone overflows it).
  for (const key of shortlistKeys) take(byKey.get(key));
  if (chosen.length > cap) chosen.length = cap;

  // 2. Per-kind near-centre guarantee: the nearest few of every
  // kind, whatever its solver rank.
  if (chosen.length < cap) {
    const kinds = [...new Set(rest().map((c) => c.kind))].sort();
    for (const kind of kinds) {
      if (chosen.length >= cap) break;
      rest()
        .filter((c) => c.kind === kind)
        .sort((a, b) => dist(a) - dist(b))
        .slice(0, LEG_MATRIX_KIND_GUARANTEE)
        .forEach(take);
    }
  }

  // 3. Tranches: half the remaining slots by (RANK, distance),
  // half by pure distance; any slot one tranche cannot fill is
  // backfilled from the rank order, so the cap is still used.
  const slots = cap - chosen.length;
  if (slots > 0) {
    const rankOrder = rest().sort((a, b) => {
      const ra = RANK[a.kind] ?? 9;
      const rb = RANK[b.kind] ?? 9;
      if (ra !== rb) return ra - rb;
      return dist(a) - dist(b);
    });
    rankOrder.slice(0, Math.ceil(slots / 2)).forEach(take);
    rest()
      .sort((a, b) => dist(a) - dist(b))
      .forEach((c) => {
        if (chosen.length < cap) take(c);
      });
    rankOrder.forEach((c) => {
      if (chosen.length < cap) take(c);
    });
  }

  return [
    { key: "base", lat: centre.lat, lon: centre.lon },
    ...chosen.map((c) => ({ key: c.osmKey, lat: c.pos!.lat, lon: c.pos!.lon }))
  ];
}

/** Build the leg matrix for one pack build. Returns null when
 *  routing is unreachable for BOTH profiles (the honest fallback
 *  signal); a single-profile success still yields a matrix, with
 *  the missing profile's cells null (per-leg fallback at solve
 *  time) AND the failure recorded on `profiles` — a blank profile
 *  is a stated fact of the artefact, never a silent one
 *  (matrix-coverage fix, 2026-11-07). Never throws.
 *
 *  The foot call gets its own timeout budget plus ONE retry: the
 *  100-point foot table is the heavy call, and travellers walk
 *  most legs, so a transient foot failure is worth one more
 *  attempt before the profile is recorded dead. */
export async function buildLegMatrix(
  fetcher: Fetcher,
  centre: { lat: number; lon: number },
  candidates: readonly StoredCandidate[],
  now: () => Date = () => new Date(),
  timeoutMs = 20_000,
  shortlistKeys: readonly string[] = []
): Promise<EngineLegMatrix | null> {
  const points = legMatrixPoints(centre, candidates, shortlistKeys);
  if (points.length < 2) return null;
  const drivePromise = fetchOsrmDurations(fetcher, OSRM_CAR_TABLE_URL, points, timeoutMs);
  const walkPromise = (async (): Promise<(number | null)[][] | null> => {
    const first = await fetchOsrmDurations(fetcher, OSRM_FOOT_TABLE_URL, points, timeoutMs);
    if (first) return first;
    // One retry on the foot profile's own budget: a single
    // transient timeout must not blank every walk leg of a pack.
    return fetchOsrmDurations(fetcher, OSRM_FOOT_TABLE_URL, points, timeoutMs);
  })();
  const [drive, walk] = await Promise.all([drivePromise, walkPromise]);
  if (!drive && !walk) return null;
  const blank = (): (number | null)[][] => points.map(() => points.map(() => null));
  return {
    provider: LEG_MATRIX_PROVIDER,
    builtAt: now().toISOString() as UtcInstant,
    keys: points.map((p) => p.key),
    driveSeconds: drive ?? blank(),
    walkSeconds: walk ?? blank(),
    profiles: { drive: drive != null, walk: walk != null }
  };
}
