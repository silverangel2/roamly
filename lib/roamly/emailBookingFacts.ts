import { bookingTimestamp } from "@/lib/roamly/bookingDateTime";

const labels = "check[ -]?in|check[ -]?out|destination|origin|provider|hotel|property|accommodation|room|guest|confirmation(?: number| code)?|test total|total(?: price)?|amount paid|roamly test trip id";
/** Only labelled body evidence; subject and preview must not consume field values. */
export function labelledEmailValue(text: string, label: string) {
  const pattern = new RegExp(`(?:^|[\\n\\r]|\\s)${label}\\s*:\\s*(.*?)(?=\\r?\\n|\\s+(?:${labels})\\s*:|$)`, "i");
  return text.match(pattern)?.[1]?.trim().slice(0, 200) || "";
}

function labelledClock(text: string, label: string, sharedZone: string | null) {
  const raw = labelledEmailValue(text, label);
  if (!raw) return { value: null, unresolved: false };
  const match = raw.match(/^(\d{4}-\d{2}-\d{2}|[A-Za-z]+\s+\d{1,2},?\s+\d{4})(?:[T ]+(?:at\s+)?)?(\d{1,2}:\d{2}(?::\d{2})?)(?:\s*(AM|PM))?/i);
  if (!match) return { value: null, unresolved: true };
  const parsedDate = new Date(`${match[1]} UTC`);
  if (!/^\d{4}-/.test(match[1]) && !Number.isFinite(parsedDate.getTime())) return { value: null, unresolved: true };
  const date = /^\d{4}-/.test(match[1]) ? match[1] : parsedDate.toISOString().slice(0, 10);
  const clock = match[2].split(":").map(Number);
  if (match[3]) clock[0] = clock[0] % 12 + (/pm/i.test(match[3]) ? 12 : 0);
  const local = `${date}T${clock.map(v => String(v).padStart(2, "0")).join(":")}`;
  const offset = raw.match(/(?:UTC\s*)?([+-]\d{2}:?\d{2})\b/i)?.[1];
  const zone = raw.match(/\b([A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?)\b/)?.[1] || sharedZone;
  const value = bookingTimestamp(offset ? `${local}${offset}` : /\b(?:UTC|GMT)\b|Z$/i.test(raw) ? `${local}Z` : local, zone);
  return { value, unresolved: !value };
}

export function hotelEmailFacts(text: string) {
  const zones = [...new Set(text.match(/\b[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?\b/g) || [])];
  const zone = zones.length === 1 ? zones[0] : null;
  const start = labelledClock(text, "check[ -]?in", zone);
  const end = labelledClock(text, "check[ -]?out", zone);
  const money = labelledEmailValue(text, "(?:test total|total(?: price)?|amount paid)").match(/^(PHP|CAD|USD|EUR|GBP|AUD|JPY)\s+([\d,]+(?:\.\d{1,2})?)\b/i);
  return {
    name: labelledEmailValue(text, "(?:hotel|property|accommodation)"),
    provider: labelledEmailValue(text, "provider"),
    destination: labelledEmailValue(text, "destination"),
    start: start.value, end: end.value,
    timezone: zone,
    hasLabelledDates: !!labelledEmailValue(text, "check[ -]?in"),
    unresolved: start.unresolved || end.unresolved,
    totalPrice: money ? Number(money[2].replaceAll(",", "")) : null,
    currency: money ? money[1].toUpperCase() : null
  };
}
