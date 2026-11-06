/**
 * BoardUI `cx` — Roamly port.
 *
 * Provenance: BoardUI's `cx` foundation (BoardUI/boardui, MIT) is a
 * tailwind-merge wrapper. Roamly's tree has no tailwind-merge and this
 * port adds zero runtime dependencies, so this is the documented
 * lightweight form: conditional class joining only (falsy values are
 * dropped). It does NOT resolve conflicting utilities the way
 * tailwind-merge does — callers pass final, non-conflicting classes,
 * the same convention the existing codebase already uses.
 */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
