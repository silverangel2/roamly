function text(value: unknown) { return typeof value === "string" ? value.trim() : ""; }

/** UTC storage is converted before assigning a confirmed booking to a local day. */
export function bookingExactTiming(booking: Record<string, unknown>) {
  const metadata = booking.metadata && typeof booking.metadata === "object" ? booking.metadata as Record<string, unknown> : {};
  const zone = text(booking.timezone) || text(metadata.timezone);
  function parts(value: unknown, timeZone: string) {
    const iso = text(value);
    if (!iso) return null;
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return null;
    if (timeZone) {
      try {
        const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map(part => [part.type, part.value]));
        return { date: `${p.year}-${p.month}-${p.day}`, clock: `${p.hour}:${p.minute}` };
      } catch { /* Preserve legacy UTC display when old metadata has no usable zone. */ }
    }
    return { date: iso.slice(0, 10), clock: iso.match(/T(\d{2}:\d{2})/)?.[1] || "" };
  }
  const start = parts(booking.start_at || booking.check_in_at, zone);
  const end = parts(booking.end_at || booking.check_out_at, text(metadata.arrivalTimezone) || zone);
  const date = start?.date || text(booking.start_date).slice(0, 10);
  return {
    date,
    start: start?.clock || text(booking.start_time),
    // A multi-night hotel's checkout is not the end of its check-in-day window.
    end: end ? end.date === date ? end.clock : "" : text(booking.end_time)
  };
}
