import { normText } from "@/lib/roamly/engine/util";

/*
 * Typo tolerance for named-place asks (owner requirement,
 * 2026-11-09: "there should be a consideration in typo errors and
 * still land on the nearest place to it. the app is not super
 * intelligent enough.").
 *
 * The must-see requirement path (mustSeeRequirement in
 * understand.ts) anchors a pure named-place ask on the place's own
 * name, and every consumer — the solver's grounding match, the
 * staged verification pass, the annotation reconciliation — tests
 * that anchor EXACTLY (substring on normText-folded names). A
 * traveller who types "Coloseum", "Versaills" or "Eifel Towr"
 * therefore got the honest gap even when the real place sat in the
 * destination's own data: the app demanded a spelling the
 * traveller never promised to have.
 *
 * This module is the ONE fuzzy tier for all three consumers — a
 * tier BELOW exact / whole-name matching, consulted only when the
 * exact tiers found nothing. It answers one question: given the
 * traveller's (possibly misspelled) name patterns and a set of
 * candidate names, is there a single genuine place the ask
 * unmistakably means? It returns that candidate, or null — null
 * keeps the honest gap, by design: a wrong landing is worse than
 * no landing (the Banff / Histoire des Plantes law — a same-word
 * or near-word neighbour must never silently stand in for the
 * asked-for place).
 *
 * Acceptance needs ALL of:
 *  (a) HIGH SIMILARITY — Damerau-style edit distance (adjacent
 *      transposition costs one edit, like a substitution, an
 *      insertion or a deletion — the shapes real typos take:
 *      one missing letter, one doubled letter, two letters
 *      swapped) on normText-folded names (case and accents are
 *      already folded by normText, so accent/case variants never
 *      reach this tier — the exact tier owns them). The budget
 *      scales with needle length: needles under 4 characters get
 *      NO fuzzy tier (a 1-edit change to a 3-letter word is a
 *      different word, not a typo), 4–6 characters allow 1 edit,
 *      longer needles allow 2.
 *  (b) A UNIQUE CLEAR WINNER — the best candidate must win
 *      outright: either it is the only candidate at the minimum
 *      distance, or, among candidates tied at the minimum, it is
 *      the only one whose WHOLE name sits at that distance (the
 *      place itself, over a longer name that merely contains the
 *      near-miss word). A tie the whole-name preference cannot
 *      break — a typo'd word sitting inside two different places'
 *      names — refuses: the word does not identify one place.
 *  (c) A GENUINE PLACE — when the winning match is on PART of a
 *      longer name (the ask's word inside "Palace of
 *      Versailles"), the rest of that name must be the place's own
 *      words, never a name-trading shell: a leftover lodging /
 *      commerce token (apartments, hotel, suites, tours, tickets…)
 *      rejects the winner outright ("Colosseum Apartments" can
 *      never receive a Colosseum ask, exactly as in the exact
 *      tier's Rome fix), and the matched part must cover a real
 *      share (≥ 34%) of the whole name, so a long junk name cannot
 *      capture a short ask through one word buried inside it.
 * Scope: candidate names already come from the destination's own
 * pack / the trip's own itinerary (the callers' sets), so the
 * tier is destination-scoped by construction. It serves
 * traveller-typed PLACE ASKS only — callers gate it to pure
 * name-anchor requirements (requiredPatterns with no
 * requiredKinds). Booking references, codes, confirmed-booking
 * hotel names and addresses never pass through here.
 *
 * On a landing, the caller schedules / satisfies with the REAL
 * candidate record — its true name, coordinates and source. The
 * traveller's typo is never rendered as a place name anywhere.
 */

/** Name folding for comparison: normText (lowercase, accents
 *  folded) with punctuation collapsed to single spaces — the same
 *  folding the pattern ladder applies to pool names. */
export function placeNameKey(value: unknown): string {
  return normText(value ?? "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Damerau-style edit distance (optimal string alignment):
 *  insertion, deletion, substitution and one adjacent
 *  transposition each cost 1. `cap` prunes: any distance above
 *  the cap is reported as cap + 1, which is all the acceptance
 *  test ever needs to know. */
export function damerauDistance(a: string, b: string, cap = Number.POSITIVE_INFINITY): number {
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > cap) return cap + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;
  let prev2: number[] | null = null;
  let prev: number[] = Array.from({ length: lb + 1 }, (_, j) => j);
  for (let i = 1; i <= la; i++) {
    const cur: number[] = [i];
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (prev2 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > cap) return cap + 1;
    prev2 = prev;
    prev = cur;
  }
  return prev[lb];
}

/** The edit budget for a normalized needle, scaled by its length
 *  (spaces excluded — a phrase's letters are what can be
 *  mistyped). 0 = no fuzzy tier for this needle. */
export function fuzzyMaxDistance(needleKey: string): number {
  const len = needleKey.replace(/ /g, "").length;
  if (len < 4) return 0;
  if (len <= 6) return 1;
  return 2;
}

/** Leftover words that mark a name as TRADING on a place rather
 *  than being the place: lodging shells and ticket/tour products.
 *  A part-name fuzzy winner carrying one of these outside the
 *  matched part is refused — the Rome law ("Colosseum
 *  Apartments"), extended to the fuzzy tier. */
const NAME_TRADING_TOKENS: ReadonlySet<string> = new Set([
  "apartment", "apartments", "aparthotel",
  "hotel", "hotels", "hostel", "hostels", "motel", "motels",
  "suite", "suites", "residence", "residences",
  "guesthouse", "guesthouses", "bnb",
  "tour", "tours", "ticket", "tickets", "crawl"
]);

/** Minimum share of the candidate's whole name the matched part
 *  must cover for a part-name landing (see (c) above). */
const MIN_PART_COVERAGE = 0.34;

interface PreparedCandidate<T> {
  ref: T;
  key: string;
  tokens: string[];
}

interface NeedleScore {
  bestDist: number;
  /** True when the candidate's WHOLE name achieves bestDist. */
  wholeForm: boolean;
  /** For a part-form best: the matched part and its token span. */
  part: string;
  spanStart: number;
  spanLength: number;
}

function scoreCandidate<T>(needleKey: string, needleTokens: string[], cand: PreparedCandidate<T>, cap: number): NeedleScore {
  const wholeDist = damerauDistance(needleKey, cand.key, cap);
  let bestDist = wholeDist;
  let part = "";
  let spanStart = -1;
  let spanLength = 0;
  if (needleTokens.length === 1) {
    cand.tokens.forEach((token, i) => {
      if (token.length < 4 && token !== cand.key) return;
      const d = damerauDistance(needleKey, token, cap);
      if (d < bestDist) {
        bestDist = d;
        part = token;
        spanStart = i;
        spanLength = 1;
      }
    });
  } else {
    const k = needleTokens.length;
    for (let i = 0; i + k <= cand.tokens.length; i++) {
      const window = cand.tokens.slice(i, i + k).join(" ");
      const d = damerauDistance(needleKey, window, cap);
      if (d < bestDist) {
        bestDist = d;
        part = window;
        spanStart = i;
        spanLength = k;
      }
    }
  }
  return { bestDist, wholeForm: wholeDist === bestDist, part, spanStart, spanLength };
}

function winnerForNeedle<T>(needleKey: string, prepared: PreparedCandidate<T>[]): T | null {
  const cap = fuzzyMaxDistance(needleKey);
  if (cap === 0) return null;
  const needleTokens = needleKey.split(" ").filter(Boolean);
  if (!needleTokens.length) return null;
  const scored: Array<{ cand: PreparedCandidate<T>; score: NeedleScore }> = [];
  for (const cand of prepared) {
    const score = scoreCandidate(needleKey, needleTokens, cand, cap);
    if (score.bestDist <= cap) scored.push({ cand, score });
  }
  if (!scored.length) return null;
  const dmin = Math.min(...scored.map((s) => s.score.bestDist));
  const atMin = scored.filter((s) => s.score.bestDist === dmin);
  const wholeWinners = atMin.filter((s) => s.score.wholeForm);
  if (wholeWinners.length === 1) return wholeWinners[0].cand.ref;
  if (wholeWinners.length > 1) return null; // two whole names equally near: ambiguous
  if (atMin.length !== 1) return null; // the near word sits inside several names: it identifies none
  const { cand, score } = atMin[0];
  // Part-form winner: the genuine-place guards (c).
  if (score.part.length / cand.key.length < MIN_PART_COVERAGE) return null;
  const leftover = cand.tokens.filter((_, i) => i < score.spanStart || i >= score.spanStart + score.spanLength);
  if (leftover.some((token) => NAME_TRADING_TOKENS.has(token))) return null;
  return cand.ref;
}

/**
 * The fuzzy tier's one entry point. `patterns` are the must-see's
 * name-anchor patterns (the traveller's words for the place);
 * `candidates` are the destination-scoped records carrying real
 * names. Returns the single candidate the ask unmistakably
 * means, or null to keep the honest gap.
 *
 * Each pattern is tried on its own, plus — for a multi-word
 * place name whose anchor arrived as separate tokens ("eifel",
 * "tower") — the patterns joined as the phrase the traveller
 * wrote. Every needle must agree on the SAME candidate: two
 * needles crowning two different places is ambiguity, and
 * ambiguity refuses.
 */
export function fuzzyPlaceWinner<T extends { name: string }>(patterns: string[], candidates: readonly T[]): T | null {
  const needles = [...new Set((patterns || []).map((p) => placeNameKey(p)).filter(Boolean))];
  if (needles.length > 1) {
    const phrase = placeNameKey((patterns || []).join(" "));
    if (phrase && !needles.includes(phrase)) needles.push(phrase);
  }
  if (!needles.length || !candidates.length) return null;
  const byKey = new Map<string, PreparedCandidate<T>>();
  for (const ref of candidates) {
    const key = placeNameKey(ref?.name);
    if (!key || byKey.has(key)) continue; // same name twice = the same place for this test
    byKey.set(key, { ref, key, tokens: key.split(" ") });
  }
  const prepared = [...byKey.values()];
  if (!prepared.length) return null;
  const winners = new Set<T>();
  for (const needle of needles) {
    const winner = winnerForNeedle(needle, prepared);
    if (winner) winners.add(winner);
  }
  return winners.size === 1 ? [...winners][0] : null;
}
