import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAppEvent } from "@/lib/roamly/events";

/**
 * Cron heartbeat (visibility round 2026-10-31, finding L11).
 * Store: the EXISTING roamly_app_events table via recordAppEvent — no new
 * table. One row per cron invocation: event_type "cron_heartbeat",
 * metadata { cron, intervalMinutes, ok }.
 * Staleness law: stale when age > 2x the schedule interval.
 */
export const CRON_HEARTBEAT_EVENT_TYPE = "cron_heartbeat";
export const CRON_HEARTBEATS = {
  "roamly-live-companion": { intervalMinutes: 5 },
  "roamly-notifications-queue": { intervalMinutes: 15 },
  // EGRESS DIET (2026-11-02): the work-gated lanes join the same
  // registry, so every invocation — gated or worked — leaves one
  // app-event row carrying metadata.gated. That is the per-lane
  // daily attribution source the owner surfaces read (group
  // cron_heartbeat events by metadata.cron per day); no new table,
  // no new subsystem.
  "roamly-itinerary-generation": { intervalMinutes: 5 },
  "roamly-booking-monitor": { intervalMinutes: 10 },
  "roamly-ops-worker": { intervalMinutes: 15 },
  "roamly-email-sync": { intervalMinutes: 30 },
  "roamly-pack-refresh": { intervalMinutes: 60 },
  "roamly-lifecycle": { intervalMinutes: 60 }
} as const;
export type CronHeartbeatName = keyof typeof CRON_HEARTBEATS;

export async function recordCronHeartbeat(
  supabase: SupabaseClient,
  cron: CronHeartbeatName,
  ok: boolean,
  extra?: { gated?: boolean }
): Promise<boolean> {
  try {
    const result = await recordAppEvent(supabase, {
      eventType: CRON_HEARTBEAT_EVENT_TYPE,
      path: `/api/cron/${cron === "roamly-notifications-queue" ? "roamly-notifications" : cron}`,
      metadata: {
        cron,
        intervalMinutes: CRON_HEARTBEATS[cron].intervalMinutes,
        ok,
        ...(extra?.gated ? { gated: true } : {})
      }
    });
    return !result.error;
  } catch {
    return false; // heartbeat must never break the cron it observes
  }
}

export type CronHeartbeatStatus = {
  cron: string;
  intervalMinutes: number;
  lastSeenAt: string | null;
  ageMinutes: number | null;
  stale: boolean;
};

/** Pure staleness check (tested directly): stale iff no heartbeat, or age > 2x interval. */
export function cronHeartbeatStatus(
  cron: CronHeartbeatName,
  lastSeenAt: string | null,
  now: Date = new Date()
): CronHeartbeatStatus {
  const intervalMinutes = CRON_HEARTBEATS[cron].intervalMinutes;
  if (!lastSeenAt) return { cron, intervalMinutes, lastSeenAt: null, ageMinutes: null, stale: true };
  const ageMinutes = (now.getTime() - new Date(lastSeenAt).getTime()) / 60_000;
  return { cron, intervalMinutes, lastSeenAt, ageMinutes, stale: !(ageMinutes >= 0) || ageMinutes > intervalMinutes * 2 };
}

/** Operator read: last-seen per registered cron + staleness flags. */
export async function getCronHeartbeatStatus(
  supabase: SupabaseClient,
  now: Date = new Date()
): Promise<CronHeartbeatStatus[]> {
  const out: CronHeartbeatStatus[] = [];
  for (const cron of Object.keys(CRON_HEARTBEATS) as CronHeartbeatName[]) {
    const { data } = await supabase
      .from("roamly_app_events")
      .select("created_at,metadata")
      .eq("event_type", CRON_HEARTBEAT_EVENT_TYPE)
      .filter("metadata->>cron", "eq", cron)
      .order("created_at", { ascending: false })
      .limit(1);
    const last = Array.isArray(data) && data.length ? (data[0] as { created_at?: string }).created_at || null : null;
    out.push(cronHeartbeatStatus(cron, last, now));
  }
  return out;
}
