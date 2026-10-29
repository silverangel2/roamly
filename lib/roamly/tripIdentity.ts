/*
 * Trip-identity header (Roamly UX repair ROUND 2, builder C).
 *
 * Failure: Alerts, Live, and event sheets rendered trips from mixed
 * tester data (Montreal Oct 26–30, Toronto Nov 10–14, and the owner's
 * personal Montreal Oct 30–Nov 2) with no unmistakable "which trip is
 * this" header, so one trip's data could pass for another's.
 *
 * This module formats the identity line every surface must carry:
 * destination + dates + origin, from the SELECTED trip's own stored
 * fields only. It never invents a missing piece — a missing origin
 * or date is omitted, never guessed — and it formats dates from the
 * stored calendar date (first 10 chars, local midnight), so the same
 * trip reads the same dates under America/Moncton and under UTC.
 * Pure module: no imports, directly importable by the check script.
 */

function shortDate(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" }).format(date);
}

/** "Oct 30 – Nov 2", a single date, or null when neither parses. */
export function formatTripDateRange(
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string | null {
  const start = shortDate(startDate);
  const end = shortDate(endDate);
  if (start && end) return start === end ? start : `${start} – ${end}`;
  return start || end;
}

/**
 * Gate eyebrow in the owner-approved mock's form:
 * "Montreal, Canada · Oct 26 – Oct 30, 2026" — month repeated on both
 * ends, year on the end date. Unlike formatTripDateRange (which
 * collapses same-month ranges), the gate eyebrow repeats the month
 * because that is the approved design. Missing pieces are omitted,
 * never invented; a trip with no usable dates yields just the
 * destination (or null when there is nothing at all).
 */
export function formatGateEyebrow(
  destination: string | null | undefined,
  startDate: string | null | undefined,
  endDate: string | null | undefined
): string | null {
  const dest = String(destination || "").trim();
  const start = shortDate(startDate);
  const end = shortDate(endDate);
  const startYear = startDate ? String(startDate).slice(0, 4) : null;
  const endYear = endDate ? String(endDate).slice(0, 4) : null;
  let range: string | null = null;
  if (start && end) {
    range = start === end ? start : `${start} – ${end}`;
    if (/^\d{4}$/.test(endYear || "")) range += `, ${endYear}`;
    else if (/^\d{4}$/.test(startYear || "")) range += `, ${startYear}`;
  } else {
    range = start || end;
    if (range && /^\d{4}$/.test(startYear || "")) range += `, ${startYear}`;
  }
  if (dest && range) return `${dest} · ${range}`;
  return dest || range;
}

/**
 * "Montreal · Oct 30 – Nov 2 · From Saint John" — segments present
 * only when the selected trip actually carries them. Returns null
 * when the trip carries nothing identifiable (the caller then renders
 * no identity line rather than a fabricated one).
 */
export function tripIdentityLine(input: {
  destination?: string | null;
  origin?: string | null;
  startDate?: string | null;
  endDate?: string | null;
}): string | null {
  const segments: string[] = [];
  const destination = String(input.destination || "").trim();
  if (destination) segments.push(destination);
  const range = formatTripDateRange(input.startDate, input.endDate);
  if (range) segments.push(range);
  const origin = String(input.origin || "").trim();
  if (origin) segments.push(`From ${origin}`);
  return segments.length ? segments.join(" · ") : null;
}
