/** Offset-free travel clocks require an explicit IANA zone; never use the host zone. */
export function bookingTimestamp(value: unknown, timeZone?: string | null): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  if (/(?:Z|[+-]\d{2}:?\d{2})$/i.test(text)) {
    const date = new Date(text);
    return Number.isFinite(date.getTime()) ? date.toISOString() : null;
  }
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (!match || !timeZone) return null;
  const wanted = match.slice(1).map((v) => Number(v || 0));
  const wall = Date.UTC(wanted[0], wanted[1] - 1, wanted[2], wanted[3], wanted[4], wanted[5]);
  try {
    const format = new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const parts = (ms: number) => {
      const p = Object.fromEntries(format.formatToParts(ms).map((v) => [v.type, v.value]));
      return [Number(p.year), Number(p.month), Number(p.day), Number(p.hour), Number(p.minute), Number(p.second)];
    };
    let candidate = wall;
    for (let i = 0; i < 4; i++) {
      const p = parts(candidate);
      candidate += wall - Date.UTC(p[0], p[1] - 1, p[2], p[3], p[4], p[5]);
    }
    // A DST gap is invalid; an ambiguous clock needs an explicit offset rather than a guess.
    const matches = [-7200000, -3600000, 0, 3600000, 7200000]
      .map((delta) => candidate + delta).filter((ms) => parts(ms).every((v, i) => v === wanted[i]));
    return matches.length === 1 ? new Date(matches[0]).toISOString() : null;
  } catch { return null; }
}

export function bookingDate(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? value : null;
}
