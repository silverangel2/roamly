/*
 * Build 2 Live Companion — offline-first day (BUILD2-SPEC addition
 * F; DESIGN-PRODUCTION.md Phase 7: "offline day cache contract —
 * pass + plan cached on device; offline actions keep true times and
 * sync on return").
 *
 * The day's pass + panel input are cached on the device for the day.
 * With no signal the panel renders from the cache and every action
 * (check-in, skip, directions-viewed, undo) is queued WITH ITS TRUE
 * OCCURRED TIME — the flush replays the queue in order against the
 * real endpoints, and the ledger records the true time, never the
 * flush time. A failed flush keeps the queue intact; a successful
 * one removes exactly what was sent. Queue ids are deterministic
 * per action, so re-queueing the same tap never duplicates it.
 *
 * Storage is injected (localStorage in the app, an in-memory map in
 * tests) — this module touches no globals.
 */

import type { CompanionPanelInput, WalletPassView } from "./companionPanel";

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface CompanionDaySnapshot {
  tripId: string;
  date: string;
  timezone: string;
  cachedAt: string;
  panelInput: CompanionPanelInput;
  pass: WalletPassView;
}

export type QueuedPanelActionKind = "check-in" | "skip" | "directions-viewed" | "undo";

export interface QueuedPanelAction {
  queueId: string;
  kind: QueuedPanelActionKind;
  activityRef: string;
  /** The true instant the traveler acted (kept through the flush). */
  occurredAt: string;
  occurredMinuteOfTrip: number;
}

const dayKey = (tripId: string, date: string) => `roamly:companion-day:${tripId}:${date}`;
const queueKey = (tripId: string) => `roamly:companion-queue:${tripId}`;

export function saveCompanionDayCache(storage: KeyValueStorage, snapshot: CompanionDaySnapshot): void {
  try {
    storage.setItem(dayKey(snapshot.tripId, snapshot.date), JSON.stringify(snapshot));
  } catch {
    // Storage can be unavailable (private mode, quota) — the day
    // still works online; offline caching is best-effort by design.
  }
}

export function loadCompanionDayCache(
  storage: KeyValueStorage,
  tripId: string,
  date: string
): CompanionDaySnapshot | null {
  try {
    const raw = storage.getItem(dayKey(tripId, date));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CompanionDaySnapshot;
    if (parsed.tripId !== tripId || parsed.date !== date || !parsed.panelInput || !parsed.pass) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearCompanionDayCache(storage: KeyValueStorage, tripId: string, date: string): void {
  try {
    storage.removeItem(dayKey(tripId, date));
  } catch {
    // See saveCompanionDayCache.
  }
}

export function readPanelActionQueue(storage: KeyValueStorage, tripId: string): QueuedPanelAction[] {
  try {
    const raw = storage.getItem(queueKey(tripId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as QueuedPanelAction[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writePanelActionQueue(
  storage: KeyValueStorage,
  tripId: string,
  queue: QueuedPanelAction[]
): void {
  try {
    if (queue.length === 0) storage.removeItem(queueKey(tripId));
    else storage.setItem(queueKey(tripId), JSON.stringify(queue));
  } catch {
    // Best-effort, as above.
  }
}

export function queuePanelAction(
  storage: KeyValueStorage,
  tripId: string,
  action: Omit<QueuedPanelAction, "queueId">
): QueuedPanelAction[] {
  const queueId = `${action.activityRef}:${action.kind}:${action.occurredAt}`;
  const queue = readPanelActionQueue(storage, tripId);
  if (!queue.some((queued) => queued.queueId === queueId)) {
    queue.push({ ...action, queueId });
    queue.sort((a, b) => (a.occurredAt < b.occurredAt ? -1 : a.occurredAt > b.occurredAt ? 1 : 0));
    writePanelActionQueue(storage, tripId, queue);
  }
  return readPanelActionQueue(storage, tripId);
}

/**
 * Replay the queue in order. `send` performs the real endpoint call
 * for one action (with its true occurredAt) and resolves true only
 * when the server accepted it. Sent actions are removed; the first
 * failure stops the flush and keeps the rest queued.
 */
export async function flushPanelActionQueue(
  storage: KeyValueStorage,
  tripId: string,
  send: (action: QueuedPanelAction) => Promise<boolean>
): Promise<{ sent: number; remaining: number }> {
  const queue = readPanelActionQueue(storage, tripId);
  let sent = 0;
  for (const action of queue) {
    let ok = false;
    try {
      ok = await send(action);
    } catch {
      ok = false;
    }
    if (!ok) break;
    sent += 1;
  }
  const remaining = queue.slice(sent);
  writePanelActionQueue(storage, tripId, remaining);
  return { sent, remaining: remaining.length };
}
