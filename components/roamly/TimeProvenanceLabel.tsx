import type { TimeProvenance } from "@/lib/roamly/timeProvenance";
import { timeProvenanceLabel } from "@/lib/roamly/timeProvenance";

/**
 * The provenance pill for one displayed time (conditional-acceptance
 * round, item 1). Every timed row renders exactly one of these (or
 * the legacy same-position pill it replaces) next to its time, so a
 * reader can never mistake a live-computed time for a planned one —
 * or an estimate for a confirmed booking time. "Confirmed" renders
 * only where the caller proved a verified record (see
 * lib/roamly/timeProvenance.ts); this component never upgrades a kind
 * on its own.
 */
export function TimeProvenanceLabel({
  kind,
  className
}: {
  kind: TimeProvenance;
  className?: string;
}) {
  return (
    <span
      className={
        className ||
        "mt-0.5 inline-block rounded-md bg-[rgba(31,45,77,0.08)] px-2 py-0.5 text-xs font-semibold text-chead"
      }
    >
      {timeProvenanceLabel(kind)}
    </span>
  );
}
