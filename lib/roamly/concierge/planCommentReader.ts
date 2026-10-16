/**
 * Concierge Comment Reader — deterministic reading of free-text comments a
 * traveler leaves on their own plan/itinerary.
 *
 * STORAGE GAP (stated plainly, 2026-10-16): no comment storage exists in the
 * Roamly codebase today. trip_feedback has free-text fields (free_text_feedback)
 * but is post-trip and structured; the live companion is one-way (no traveler
 * replies stored); no plan-comment table and no comment UI were found in
 * lib/, app/, components/, or supabase/migrations/. The reader therefore works
 * against the documented `PlanCommentSource` adapter interface below. Whoever
 * builds the comment UI wires `listComments` to the new table; the reader
 * itself changes nothing. No table and no UI are invented here.
 *
 * Interpretation is deterministic (zero LLM): negation-aware
 * keyword/dimension extraction over comment clauses. Output per comment:
 * signals (dimension + polarity + detail) or, when nothing classifies,
 * an "unread comment — needs a human look" entry. Unclassifiable comments
 * are NEVER silently dropped.
 *
 * PRIORITY (Junel's standing order): an explicit comment requirement
 * ("no early starts") is an EXPLICIT HARD REQUIREMENT — same tier as a
 * stated hard requirement, outranking recommendations and pattern picks,
 * below only confirmed bookings. A comment can veto a pattern suggestion;
 * a pattern can never override a comment.
 *
 * Ship path: lib/roamly/concierge/planCommentReader.ts (this file).
 */

/* ── Adapter interface ──────────────────────────────────────────── */

export type PlanComment = {
  /** Stable id of the comment record. */
  id: string;
  /** Raw free text. */
  text: string;
  createdAt?: string | null;
  /** Where it was left: e.g. "itinerary" | "day" | "item". May be null. */
  scope?: string | null;
  /** Optional stable ref to the day/item it was left on. */
  ref?: string | null;
};

/**
 * Whoever owns comment storage implements this. The reader calls only this.
 */
export type PlanCommentSource = {
  listComments: (params: { tripId: string; userId?: string | null }) => Promise<PlanComment[]>;
};

/* ── Reading output ─────────────────────────────────────────────── */

export type CommentDimension = "pace" | "food" | "mobility" | "interests" | "budget" | "dislike";

export type CommentPolarity = "hard_requirement" | "want_more" | "want_less";

export type CommentSignal = {
  commentId: string;
  dimension: CommentDimension;
  polarity: CommentPolarity;
  /** Canonical detail: "late_start", "seafood", "aquarium", "shellfish_allergy"... */
  detail: string;
  /** The matched keyword/phrase that fired the rule (for blocking logic). */
  phrase: string;
  /** The comment clause that produced it (for the human audit trail). */
  clause: string;
};

export type UnreadComment = {
  commentId: string;
  text: string;
  note: string;
};

export type CommentReading = {
  signals: CommentSignal[];
  unread: UnreadComment[];
};

/* ── Negation-aware extraction ──────────────────────────────────── */

const NEGATORS = new Set([
  "no", "not", "n't", "never", "without", "avoid", "avoiding",
  "can't", "cannot", "won't", "don't", "doesn't", "didn't",
  "less", "fewer", "hardly", "barely", "skip", "skipping"
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function hasNegatorBefore(tokens: string[], phraseStart: number): boolean {
  for (let i = Math.max(0, phraseStart - 4); i < phraseStart; i++) {
    const token = tokens[i];
    if (NEGATORS.has(token) || token.endsWith("n't")) return true;
  }
  return false;
}

function findPhrase(tokens: string[], phrase: string): number {
  const words = phrase.split(" ");
  outer: for (let i = 0; i <= tokens.length - words.length; i++) {
    for (let j = 0; j < words.length; j++) {
      if (tokens[i + j] !== words[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function splitClauses(text: string): string[] {
  return text
    .split(/[.!?;\n]+/)
    .map((clause) => clause.trim())
    .filter((clause) => clause.length >= 3);
}

type RuleHit = { dimension: CommentDimension; polarity: CommentPolarity; detail: string; phrase: string };

type Rule = {
  dimension: CommentDimension;
  phrases: string[];
  /** Polarity when no negator precedes the phrase. */
  affirmative: CommentPolarity;
  /** Polarity when a negator precedes the phrase (null = no rule). */
  negated: CommentPolarity | null;
  detail: string;
};

const RULES: Rule[] = [
  // — pace —
  { dimension: "pace", phrases: ["early morning", "early mornings", "early start", "early starts", "wake up early", "morning person"], affirmative: "want_more", negated: "hard_requirement", detail: "late_start" },
  { dimension: "pace", phrases: ["sleep in", "late start", "slow morning", "slow mornings"], affirmative: "hard_requirement", negated: null, detail: "late_start" },
  { dimension: "pace", phrases: ["slow day", "slow days", "take it easy", "relaxed pace", "not rushed", "slow pace"], affirmative: "want_more", negated: null, detail: "relaxed" },
  { dimension: "pace", phrases: ["packed", "see as much as possible", "cram", "jam packed"], affirmative: "want_less", negated: null, detail: "relaxed" },
  // — food —
  { dimension: "food", phrases: ["seafood", "sushi", "fish", "shellfish", "ramen", "street food", "local food", "food market"], affirmative: "want_more", negated: "want_less", detail: "" },
  { dimension: "food", phrases: ["spicy", "pork", "beef", "dairy", "gluten", "peanut"], affirmative: "want_more", negated: "want_less", detail: "" },
  { dimension: "food", phrases: ["vegetarian", "vegan", "halal", "kosher"], affirmative: "hard_requirement", negated: null, detail: "" },
  // — mobility —
  { dimension: "mobility", phrases: ["wheelchair", "limited mobility", "walk far", "bad knee", "knee problem", "stairs"], affirmative: "hard_requirement", negated: null, detail: "low_walking" },
  // — budget —
  { dimension: "budget", phrases: ["too expensive", "expensive", "cheaper", "on a budget", "tight budget", "afford", "save money"], affirmative: "want_less", negated: null, detail: "cost" },
  // — interests (reuses the repo's tripInterests vocabulary) —
  { dimension: "interests", phrases: ["museum", "museums", "gallery", "art", "temple", "church", "historic", "history", "culture"], affirmative: "want_more", negated: "want_less", detail: "Culture" },
  { dimension: "interests", phrases: ["beach", "beaches", "hiking", "hike", "nature", "park", "mountain"], affirmative: "want_more", negated: "want_less", detail: "Nature" },
  { dimension: "interests", phrases: ["nightlife", "bar", "club", "night market"], affirmative: "want_more", negated: "want_less", detail: "Nightlife" },
  { dimension: "interests", phrases: ["shopping", "market", "souvenir"], affirmative: "want_more", negated: "want_less", detail: "Shopping" },
  { dimension: "interests", phrases: ["adventure", "kayak", "diving", "dive", "snorkel"], affirmative: "want_more", negated: "want_less", detail: "Adventure" }
];

const DISLIKE_VERBS = ["didn't like", "don't like", "do not like", "hate", "hated", "dislike", "disliked", "not a fan of", "skip", "boring", "not interested in"];

function captureDislikeDetail(tokens: string[], verbEnd: number): string {
  const words: string[] = [];
  for (let i = verbEnd; i < Math.min(tokens.length, verbEnd + 5); i++) {
    const word = tokens[i];
    if (["the", "a", "an", "that", "this", "of", "to"].includes(word) && !words.length) continue;
    // A new negator / dislike verb starts a new clause — stop the capture.
    if (["and", "or", "but", "because", "so", "it"].includes(word)) break;
    if (NEGATORS.has(word) || word.endsWith("n't")) break;
    words.push(word);
    if (words.length >= 4) break;
  }
  return words.join(" ").slice(0, 60);
}

function allergyDetail(tokens: string[], at: number): string {
  // "allergic to X" → "X_allergy"
  const toIndex = tokens.indexOf("to", at);
  if (toIndex < 0 || toIndex + 1 >= tokens.length) return "allergy";
  const what = tokens.slice(toIndex + 1, toIndex + 3).filter((word) => !["the", "a", "any"].includes(word)).join("_");
  return what ? `${what}_allergy` : "allergy";
}

function readClause(commentId: string, clause: string): RuleHit[] {
  const hits: RuleHit[] = [];
  const tokens = tokenize(clause);
  if (!tokens.length) return hits;

  for (const rule of RULES) {
    for (const phrase of rule.phrases) {
      const at = findPhrase(tokens, phrase);
      if (at < 0) continue;
      const negated = hasNegatorBefore(tokens, at);
      const polarity = negated ? rule.negated : rule.affirmative;
      if (!polarity) continue;
      let detail = rule.detail || phrase.replace(/\s+/g, "_");
      if (phrase === "allergic to" || phrase === "allergy") detail = allergyDetail(tokens, at);
      hits.push({ dimension: rule.dimension, polarity, detail, phrase });
      break;
    }
  }

  // Allergy is a hard requirement even without other rules.
  const allergyAt = findPhrase(tokens, "allergic to");
  if (allergyAt >= 0) {
    hits.push({ dimension: "food", polarity: "hard_requirement", detail: allergyDetail(tokens, allergyAt), phrase: "allergic to" });
  } else if (findPhrase(tokens, "allergy") >= 0) {
    hits.push({ dimension: "food", polarity: "hard_requirement", detail: "allergy", phrase: "allergy" });
  }

  // Dislike verbs: capture the specific pick the traveler rejects.
  for (const verb of DISLIKE_VERBS) {
    const at = findPhrase(tokens, verb);
    if (at < 0) continue;
    const detail = captureDislikeDetail(tokens, at + verb.split(" ").length);
    if (detail) {
      hits.push({ dimension: "dislike", polarity: "want_less", detail, phrase: verb });
      break;
    }
  }

  return hits;
}

/**
 * Read a batch of plan comments. Pure, deterministic, never throws.
 * Comments that yield no signal land in `unread` — never the void.
 */
export function readPlanComments(comments: PlanComment[] | null | undefined): CommentReading {
  const signals: CommentSignal[] = [];
  const unread: UnreadComment[] = [];
  try {
    const list = Array.isArray(comments) ? comments : [];
    for (const comment of list) {
      if (!comment || typeof comment.text !== "string" || !comment.text.trim()) continue;
      const commentSignals: CommentSignal[] = [];
      for (const clause of splitClauses(comment.text)) {
        for (const hit of readClause(comment.id, clause)) {
          commentSignals.push({ commentId: comment.id, dimension: hit.dimension, polarity: hit.polarity, detail: hit.detail, phrase: hit.phrase, clause });
        }
      }
      if (commentSignals.length) {
        signals.push(...commentSignals);
      } else {
        unread.push({
          commentId: comment.id,
          text: comment.text.trim().slice(0, 280),
          note: "unread comment — needs a human look; no bot action taken"
        });
      }
    }
  } catch {
    // fail-soft: return what was read so far
  }
  return { signals, unread };
}

/** Async loader: reads comments through the adapter, then interprets them. */
export async function loadAndReadPlanComments(params: {
  source: PlanCommentSource;
  tripId: string;
  userId?: string | null;
}): Promise<CommentReading> {
  try {
    const comments = await params.source.listComments({ tripId: params.tripId, userId: params.userId });
    return readPlanComments(comments);
  } catch {
    return { signals: [], unread: [] };
  }
}

/* ── Priority helpers used by the Concierge engines ─────────────── */

/** Hard-requirement texts the engines must treat like stated hard requirements. */
export function commentHardRequirementTexts(reading: CommentReading): string[] {
  return reading.signals
    .filter((signal) => signal.polarity === "hard_requirement")
    .map((signal) => signal.detail.replace(/_/g, " "));
}

/** True when a comment demands late starts (vetoes early pattern picks). */
export function commentRequiresLateStart(reading: CommentReading): boolean {
  return reading.signals.some((signal) => signal.polarity === "hard_requirement" && signal.detail === "late_start");
}

/** Specific picks the traveler rejects — engines must not promote or move them. */
export function commentBlockedPhrases(reading: CommentReading): string[] {
  const blocked: string[] = [];
  for (const signal of reading.signals) {
    if (signal.polarity === "want_less" && (signal.dimension === "dislike" || signal.dimension === "food" || signal.dimension === "interests")) {
      const phrase = (signal.phrase || signal.detail).replace(/_/g, " ");
      if (phrase.length >= 4) blocked.push(phrase);
    }
  }
  return blocked;
}

/** Foods the traveler asked for more of (for reason text). */
export function commentFoodDetails(reading: CommentReading): string[] {
  return [...new Set(
    reading.signals
      .filter((signal) => signal.polarity === "want_more" && signal.dimension === "food" && signal.detail)
      .map((signal) => signal.detail.replace(/_/g, " "))
  )];
}

/** Comment-driven interest boosts, merged into the rerank engine's interests. */
export function commentInterestBoosts(reading: CommentReading): string[] {
  const boosts: string[] = [];
  for (const signal of reading.signals) {
    if (signal.polarity === "want_more" && signal.dimension === "interests" && signal.detail) {
      boosts.push(signal.detail);
    }
    if (signal.polarity === "want_more" && signal.dimension === "food" && signal.detail) {
      boosts.push("Food");
    }
  }
  return [...new Set(boosts)];
}
