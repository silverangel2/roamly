// Traveler booking corrections: a traveler may correct extracted or imported
// booking details, but a correction is a CUSTOMER ASSERTION, never provider
// confirmation. Corrections are stored as a separate pending assertion bound to
// the evidence they correct (see the confirm/review routes), and the booking
// row's own status/traveler_confirmed flags are never changed by a correction.
//
// This module is pure (no server imports) so both API routes and the check
// scripts can share the exact whitelist, sanitization, and diff rules.

const STRING_FIELDS = new Set([
  "booking_type",
  "title",
  "provider_name",
  "confirmation_number",
  "address",
  "city",
  "origin",
  "destination",
  "flight_number"
]);

const BOOKING_TYPES = new Set([
  "flight",
  "hotel",
  "attraction",
  "restaurant",
  "transport",
  "car_rental",
  "event",
  "other"
]);

function cleanText(value: unknown, maxLength: number): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!text) return null;
  return text.slice(0, maxLength);
}

function cleanDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const date = new Date(`${text}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text) return null;
  return text;
}

function cleanTime(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim();
  if (!/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return null;
  const [hour, minute] = text.split(":").map(Number);
  if (hour > 23 || minute > 59) return null;
  return text;
}

function cleanAmountCents(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const cents = Math.round(value);
  if (cents < 0 || cents > 100_000_000) return null;
  return cents;
}

function cleanCurrency(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(text)) return null;
  return text;
}

/**
 * Sanitize one raw corrections object into the whitelisted, typed field set.
 * Unknown fields are dropped; malformed values become null (never stored).
 */
export function sanitizeBookingCorrectionFields(input: unknown): Record<string, string | number | null> {
  const raw = input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : {};
  const out: Record<string, string | number | null> = {};
  for (const field of STRING_FIELDS) {
    if (field === "booking_type") {
      const text = typeof raw[field] === "string" ? raw[field].trim().toLowerCase() : "";
      out[field] = BOOKING_TYPES.has(text) ? text : null;
    } else {
      out[field] = cleanText(raw[field], field === "confirmation_number" || field === "flight_number" ? 100 : 200);
    }
  }
  out.start_date = cleanDate(raw.start_date);
  out.end_date = cleanDate(raw.end_date);
  out.start_time = cleanTime(raw.start_time);
  out.end_time = cleanTime(raw.end_time);
  out.amount_cents = cleanAmountCents(raw.amount_cents);
  out.currency = cleanCurrency(raw.currency);
  return out;
}

function sameValue(field: string, corrected: string | number | null, baseline: unknown): boolean {
  if (field === "amount_cents") {
    const base = typeof baseline === "number" && Number.isFinite(baseline) ? Math.round(baseline) : null;
    return corrected === base;
  }
  if (field === "currency") {
    const base = typeof baseline === "string" ? baseline.trim().toUpperCase() : null;
    return corrected === base || (corrected == null && !base);
  }
  const base = typeof baseline === "string" ? baseline.trim() : null;
  const value = typeof corrected === "string" ? corrected : null;
  return value === base || (value == null && !base);
}

/**
 * Diff sanitized corrections against a baseline record (extracted booking or
 * stored row). Returns only fields that actually differ, so a no-op review
 * stores no assertion at all. Returns null when nothing differs.
 */
export function diffBookingCorrections(
  input: unknown,
  baseline: Record<string, unknown>
): Record<string, string | number> | null {
  const sanitized = sanitizeBookingCorrectionFields(input);
  const diff: Record<string, string | number> = {};
  for (const [field, value] of Object.entries(sanitized)) {
    // A null sanitized value means "not supplied or malformed" — it never
    // erases a baseline value through the corrections channel.
    if (value == null) continue;
    if (!sameValue(field, value, baseline[field])) diff[field] = value;
  }
  return Object.keys(diff).length ? diff : null;
}
