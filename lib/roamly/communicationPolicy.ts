import { createHash } from "node:crypto";

export const COMMUNICATION_PURPOSES = [
  "purchase_confirmation",
  "pretrip_7d",
  "pretrip_1d",
  "travel_day",
  "daily_trip_briefing",
  "booking_material_change",
  "gmail_reconnect",
  "billing_entitlement",
  "activity_starting_soon",
  "activity_now"
] as const;

export const COMMUNICATION_CHANNELS = ["email", "push", "in_app"] as const;
export type CommunicationPurpose = (typeof COMMUNICATION_PURPOSES)[number];
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];
export type CommunicationStatus = "pending" | "claimed" | "sent" | "failed" | "suppressed";

const PURPOSE_CHANNELS: Record<CommunicationPurpose, CommunicationChannel> = {
  purchase_confirmation: "email",
  pretrip_7d: "email",
  pretrip_1d: "email",
  travel_day: "email",
  daily_trip_briefing: "email",
  booking_material_change: "in_app",
  gmail_reconnect: "email",
  billing_entitlement: "email",
  activity_starting_soon: "push",
  activity_now: "push"
};

const SECRET_KEY = /(password|authorization|cookie|token|secret|api[_-]?key|webhook|card|body|payload|oauth|refresh|access)/i;
const SAFE_METADATA_KEYS = new Set([
  "purpose", "source", "template", "stage", "failure_class", "attempt",
  "urgency", "late_send", "timezone", "provider", "relevance", "reason"
]);
const MAX_METADATA_KEYS = 20;
const MAX_METADATA_KEY_LENGTH = 48;
const MAX_METADATA_VALUE_LENGTH = 240;
const MAX_METADATA_BYTES = 4096;

function boundedText(value: unknown, max: number) {
  return typeof value === "string" ? value.trim().slice(0, max) : null;
}

export function communicationChannelForPurpose(purpose: CommunicationPurpose): CommunicationChannel {
  return PURPOSE_CHANNELS[purpose];
}

export function communicationLogicalKey(params: {
  userId: string;
  tripId?: string | null;
  purpose: CommunicationPurpose;
  occurrenceKey: string;
}) {
  const userId = boundedText(params.userId, 120) || "unknown-user";
  const tripId = boundedText(params.tripId, 120) || "account";
  const occurrence = boundedText(params.occurrenceKey, 180) || "default";
  return `${userId}:${tripId}:${params.purpose}:${occurrence}`.slice(0, 512);
}

export function communicationFingerprint(logicalKey: string) {
  return createHash("sha256").update(logicalKey).digest("hex");
}

export function sanitizeCommunicationMetadata(input: Record<string, unknown> | null | undefined) {
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(input || {}).slice(0, MAX_METADATA_KEYS)) {
    if (!SAFE_METADATA_KEYS.has(key) || SECRET_KEY.test(key) || key.length === 0 || key.length > MAX_METADATA_KEY_LENGTH) continue;
    if (typeof value === "boolean" || value === null) result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value)) result[key] = value;
    else if (typeof value === "string" && !SECRET_KEY.test(value)) result[key] = value.trim().slice(0, MAX_METADATA_VALUE_LENGTH);
  }
  if (JSON.stringify(result).length <= MAX_METADATA_BYTES) return result;
  const bounded: typeof result = {};
  for (const [key, value] of Object.entries(result)) {
    bounded[key] = value;
    if (JSON.stringify(bounded).length > MAX_METADATA_BYTES) delete bounded[key];
  }
  return bounded;
}

export function isCommunicationStale(params: { now: Date; usefulUntil?: string | null }) {
  if (!params.usefulUntil) return false;
  const usefulUntil = Date.parse(params.usefulUntil);
  return Number.isFinite(usefulUntil) && params.now.getTime() >= usefulUntil;
}

export function boundedRetryDelaySeconds(attempt: number) {
  return Math.min(3600, 60 * 2 ** Math.max(0, attempt - 1));
}
