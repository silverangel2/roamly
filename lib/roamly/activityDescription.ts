// lib/roamly/activityDescription.ts — DISPLAY-ONLY activity
// description shortening (consistency repairs, 2026-10-28).
//
// WHERE THE TEXT COMES FROM: activity descriptions are STORED
// text, written into the day's `live_timeline` rows when the trip
// was generated (see lib/roamly/engine/generate.ts: the arrival
// leg's "Arrival travel from X to Y — make your way in, then
// settle at your stay.", the leg seeds' "Walk/Travel from A to B
// — about N min.", the stay seeds' "Check in at X — your base
// for this trip." / "Return to X for the night.", and activity
// rows' `item.sub` or "{name} — planned for day N of this
// trip."). Nothing here rewrites that stored text: this pure
// function shortens ONLY the string the render layer shows, and
// the stored row is never assigned to. Owner decision (a) — no
// regeneration of stored summaries — is honoured by construction.
//
// SELECTIVE flattening (owner decision (b)): cut generic /
// repetitive language, RETAIN useful travel guidance. Exactly one
// generic pattern is flattened in this round — the arrival leg's
// filler clause, which repeats the row's own title ("Travel from
// Saint John to Montreal") and adds no information:
//   "Arrival travel from Saint John to Montreal — make your way
//   in, then settle at your stay."  ->  "Travel from Saint John
//   to Montreal." (and when that sentence IS the row's title, it
//   is dropped as a title echo — the title already says it).
// Everything else passes through VERBATIM, in particular:
//   - walk/drive times ("Walk from Resto Végo to WIP — about
//     8 min.", "Travel from A to B — about 4 min.");
//   - dietary facts ("…marks it diet:vegan = yes…");
//   - opening-hour notes ("Opening hours weren't listed for…");
//   - genuine directions and stay instructions ("Check in at X
//     — your base for this trip.", "Return to X for the night.",
//     "Departure travel … — collect your luggage from your stay
//     and head out.");
// A pattern is only ever added here after it is observed in a
// real stored description and judged generic — never guessed.
//
// REST-BREAK WORDING (final refinements, 2026-10-28): the same
// display-only rule now covers the rest break, whose stored
// title ("A short pause — sit down, water, breathe", solver,
// lib/roamly/engine/solver.ts) and narrative line ("A short pause
// is built in here — sit down, water, nowhere to be for a few
// minutes.", lib/roamly/engine/frames.ts breakLine) repeat
// instruction-like language on every break day. Both shorten to
// "A short rest" (title) / "A short rest." (sentence) via
// displayRestTitle / displayActivityDescription. The rest row's
// clock time, rest kind/category, and non-stop status are
// untouched — only the shown words change.
// Pure function: no I/O, no mutation. Idempotent: shortening an
// already-shortened string returns it unchanged.

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** Normalised form for rest-break matching: dashes unified, spaces
 *  folded, case folded. Only used for matching — never rendered. */
function restNorm(value: string): string {
  return text(value)
    .replace(/[—–-]/g, "—")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

const REST_TITLE_NORM = "a short pause — sit down, water, breathe";
const REST_BREAKLINE_NORM =
  "a short pause is built in here — sit down, water, nowhere to be for a few minutes";

/** Display-only rest-break title. The solver's rest title
 *  ("A short pause — sit down, water, breathe") is a list of
 *  instructions, repeated verbatim on every break day; it is not
 *  information a traveler needs under the row. Displayed as
 *  "A short rest": still a rest break (never a stop — the row's
 *  kind/category/time are untouched, and the count derivation
 *  keys on those, not on this string), still short. Every other
 *  title passes through unchanged, including the already-concise
 *  "A short pause" and meal-window titles. Stored text is never
 *  modified — callers apply this to the shown title only. */
export function displayRestTitle(title: string): string {
  const clean = text(title);
  if (restNorm(clean).replace(/\.+$/, "") === REST_TITLE_NORM) return "A short rest";
  return title;
}

/** Shorten one stored activity description for display only.
 *  `title` is the row's own title; the stored description is
 *  never modified. Returns "" for an empty description, and also
 *  "" when the shortened sentence would exactly echo the title
 *  (the title already says it — showing it again underneath is
 *  the same repetition the owner flagged). */
export function displayActivityDescription(
  title: string,
  description: string
): string {
  const desc = text(description);
  if (!desc) return "";
  // Rest-break description variants (display-only, same rule as
  // the title mapping above): the narrative break line
  // ("A short pause is built in here — sit down, water, nowhere
  // to be for a few minutes.") shortens to a single sentence, and
  // the solver title (alone, or with the generic "planned for day
  // N" tail the engine appends) is a title echo — the displayed
  // title already carries it, so the detail line drops it.
  if (restNorm(desc).replace(/\.+$/, "") === REST_BREAKLINE_NORM) return "A short rest.";
  const descWithoutPlannedTail = desc.replace(/\s+— planned for day \d+ of this trip\.?$/i, "");
  if (restNorm(descWithoutPlannedTail).replace(/\.+$/, "") === REST_TITLE_NORM) return "";
  const cleanTitle = text(title);
  const dropTitleEcho = (value: string): string => {
    const bare = value.replace(/\.+$/, "").trim().toLowerCase();
    return bare && bare === cleanTitle.toLowerCase() ? "" : value;
  };
  // The arrival leg's generic sentence: its first half restates
  // the row title and its second half is filler. Shortened form:
  // "Travel from Saint John to Montreal." — and when that IS the
  // row's title, the echo rule drops it (title carries it).
  if (
    /^Arrival travel from .+? to .+? — make your way in, then settle at your stay\.?$/i.test(
      desc
    )
  ) {
    if (/^Travel from .+? to .+$/i.test(cleanTitle)) {
      return "";
    }
    const match = desc.match(/^Arrival travel from (.+?) to (.+?) — /i);
    if (match) return dropTitleEcho(`Travel from ${match[1].trim()} to ${match[2].trim()}.`);
  }
  // Trailing filler clause, title-independent form of the same
  // generic sentence (kept so a retitled arrival leg still
  // flattens): drop only the filler clause, keep the route half.
  const fillerStripped = desc.replace(
    /\s+— make your way in, then settle at your stay\.?$/i,
    ""
  );
  if (fillerStripped !== desc) {
    const route = fillerStripped.replace(/^Arrival travel from /i, "Travel from ");
    return dropTitleEcho(route.endsWith(".") ? route : `${route}.`);
  }
  return desc;
}
