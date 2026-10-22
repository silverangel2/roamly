"use client";

/*
 * Build 2 Live Companion — panel v2 client (DESIGN-PRODUCTION.md
 * Phase 7). A new VIEW over the existing live-companion state: the
 * server hands over the same day activities the live page already
 * loaded plus the trip's M2 ledger rows, and every interaction is
 * re-derived locally through lib/roamly/companionPanel.ts — the
 * notification is a view of ledger state, never the state itself.
 *
 * Mobile-only (owner law, 2026-10-21 18:54 ADT: "Live companion is
 * never for desktop. Only for mobile."): this component renders
 * nothing at desktop widths.
 *
 * Actions:
 *  - Check in / Skip go through the EXISTING activity routes (which
 *    now also append the ledger row server-side, in
 *    performActivityAction). Directions-viewed and Undo go through
 *    the panel action route. Every action is applied optimistically
 *    as a local ledger entry minted by the same builder the server
 *    uses, so local and server rows carry identical content IDs.
 *  - Offline-first: with no connection (or a failed send) the action
 *    is queued with its TRUE occurred time and flushed in order on
 *    reconnect; the ledger records the true time, never the flush
 *    time (companionOffline.ts).
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildCompanionPanel,
  buildCompactCompanionSurfaces,
  undoTargetForEntries,
  type CompanionPanelInput,
  type PanelAction,
  type WalletPassView
} from "@/lib/roamly/companionPanel";
import {
  buildLedgerEntryDTO,
  panelActionProvenance
} from "@/lib/roamly/companionLedger";
import {
  flushPanelActionQueue,
  queuePanelAction,
  readPanelActionQueue,
  saveCompanionDayCache,
  type QueuedPanelAction
} from "@/lib/roamly/companionOffline";
import type { CompanionLedgerEntryDTO } from "@/lib/roamly/engine/types";
import { instantStringToLocal } from "@/lib/roamly/engine/time";
import {
  ActivityDetailView,
  CompanionRowView,
  CompanionStripView,
  DirectionsChooserView
} from "./companionPanelViews";

interface CompanionPanelProps {
  tripId: string;
  initialInput: CompanionPanelInput;
  /** The day pass view (built server-side with the hotel/flight
   *  essentials) — cached on device with the panel input so the day
   *  works offline. */
  passView: WalletPassView | null;
  /** Travel minutes per activity id, when a live route has priced
   *  them (companionShiftTiming inputs) — leave-by's fuel. */
  travelMinutes?: Record<string, number>;
}

function storageOrNull(): Storage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

async function postJson(url: string, body: Record<string, unknown>): Promise<boolean> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body)
    });
    if (!response.ok) return false;
    const data = (await response.json().catch(() => null)) as { ok?: boolean } | null;
    return data?.ok !== false;
  } catch {
    return false;
  }
}

export function CompanionPanel({
  tripId,
  initialInput,
  passView,
  travelMinutes
}: CompanionPanelProps) {
  const [isMobile, setIsMobile] = useState(false);
  const [entries, setEntries] = useState<CompanionLedgerEntryDTO[]>(initialInput.ledgerEntries);
  const [nowMin, setNowMin] = useState(initialInput.nowMin);
  const [online, setOnline] = useState(true);
  const [chooserItemId, setChooserItemId] = useState<string | null>(null);
  const [detailItemId, setDetailItemId] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /* Mobile-only self-limit (owner law) + online tracking + clock. */
  useEffect(() => {
    const media = window.matchMedia("(max-width: 767px)");
    const apply = () => setIsMobile(media.matches);
    apply();
    media.addEventListener("change", apply);
    const applyOnline = () => setOnline(navigator.onLine);
    applyOnline();
    window.addEventListener("online", applyOnline);
    window.addEventListener("offline", applyOnline);
    const tick = () => {
      const parts = instantStringToLocal(new Date().toISOString(), initialInput.timezone);
      if (parts.date === initialInput.date) setNowMin(parts.minutes);
    };
    tick();
    const timer = window.setInterval(tick, 30_000);
    return () => {
      media.removeEventListener("change", apply);
      window.removeEventListener("online", applyOnline);
      window.removeEventListener("offline", applyOnline);
      window.clearInterval(timer);
    };
  }, [initialInput.date, initialInput.timezone]);

  const activities = useMemo(
    () =>
      initialInput.activities.map((activity) => {
        const travelMin = travelMinutes?.[activity.id];
        return travelMin != null && activity.travelMin === null
          ? { ...activity, travelMin }
          : activity;
      }),
    [initialInput.activities, travelMinutes]
  );

  const input: CompanionPanelInput = useMemo(
    () => ({ ...initialInput, activities, ledgerEntries: entries, nowMin }),
    [initialInput, activities, entries, nowMin]
  );

  const panel = useMemo(() => buildCompanionPanel(input), [input]);
  const surfaces = useMemo(() => buildCompactCompanionSurfaces(panel, input), [panel, input]);

  const sendQueuedAction = useCallback(
    async (action: QueuedPanelAction): Promise<boolean> => {
      if (action.kind === "check-in" || action.kind === "skip") {
        return postJson(`/api/roamly/activities/${action.kind === "check-in" ? "check-in" : "skip"}`, {
          tripId,
          activityId: action.activityRef,
          occurredAt: action.occurredAt
        });
      }
      return postJson("/api/roamly/companion-panel/action", {
        tripId,
        activityId: action.activityRef,
        kind: action.kind,
        occurredAt: action.occurredAt
      });
    },
    [tripId]
  );

  const flushQueue = useCallback(async () => {
    const storage = storageOrNull();
    if (!storage) return;
    const result = await flushPanelActionQueue(storage, tripId, sendQueuedAction);
    setPendingCount(result.remaining);
  }, [tripId, sendQueuedAction]);

  /* Cache the day on device + flush anything queued from earlier. */
  useEffect(() => {
    const storage = storageOrNull();
    if (!storage) return;
    if (passView) {
      // The day cache contract (addition F) is pass + plan together;
      // the live page always hands over a pass view when the
      // companion lane is on.
      saveCompanionDayCache(storage, {
        tripId,
        date: initialInput.date,
        timezone: initialInput.timezone,
        cachedAt: new Date().toISOString(),
        panelInput: initialInput,
        pass: passView
      });
    }
    setPendingCount(readPanelActionQueue(storage, tripId).length);
    if (navigator.onLine) void flushQueue();
  }, [flushQueue, initialInput, passView, tripId]);

  useEffect(() => {
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    return () => window.removeEventListener("online", onOnline);
  }, [flushQueue]);

  const appendLocal = useCallback(
    (entry: CompanionLedgerEntryDTO) => {
      setEntries((previous) =>
        previous.some((existing) => existing.entryId === entry.entryId)
          ? previous
          : [...previous, entry]
      );
    },
    []
  );

  const performAction = useCallback(
    async (action: PanelAction, itemId: string | null) => {
      if (!itemId) return;
      if (action === "details") {
        setDetailItemId(itemId);
        return;
      }
      if (action === "directions") {
        const occurredAt = new Date().toISOString();
        appendLocal(
          buildLedgerEntryDTO({
            tripId,
            activityRef: itemId,
            classification: "DIRECTIONS_VIEWED",
            at: occurredAt,
            timezone: initialInput.timezone,
            provenance: panelActionProvenance(occurredAt)
          })
        );
        setChooserItemId(itemId);
        const sent = navigator.onLine
          ? await postJson("/api/roamly/companion-panel/action", {
              tripId,
              activityId: itemId,
              kind: "directions-viewed",
              occurredAt
            })
          : false;
        if (!sent) {
          const storage = storageOrNull();
          if (storage) {
            const parts = instantStringToLocal(occurredAt, initialInput.timezone);
            const queue = queuePanelAction(storage, tripId, {
              kind: "directions-viewed",
              activityRef: itemId,
              occurredAt,
              occurredMinuteOfTrip: parts.minutes
            });
            setPendingCount(queue.length);
          }
        }
        return;
      }
      if (action === "check-in" || action === "skip") {
        const occurredAt = new Date().toISOString();
        appendLocal(
          buildLedgerEntryDTO({
            tripId,
            activityRef: itemId,
            classification: action === "check-in" ? "CHECKED_IN" : "SKIPPED",
            at: occurredAt,
            timezone: initialInput.timezone,
            provenance: panelActionProvenance(occurredAt)
          })
        );
        const sent = navigator.onLine
          ? await postJson(`/api/roamly/activities/${action === "check-in" ? "check-in" : "skip"}`, {
              tripId,
              activityId: itemId,
              occurredAt
            })
          : false;
        if (!sent) {
          const storage = storageOrNull();
          if (storage) {
            const parts = instantStringToLocal(occurredAt, initialInput.timezone);
            const queue = queuePanelAction(storage, tripId, {
              kind: action,
              activityRef: itemId,
              occurredAt,
              occurredMinuteOfTrip: parts.minutes
            });
            setPendingCount(queue.length);
          }
        }
        return;
      }
      if (action === "undo") {
        const target = undoTargetForEntries(entriesRef.current, itemId);
        if (!target) return;
        const occurredAt = new Date().toISOString();
        appendLocal(
          buildLedgerEntryDTO({
            tripId,
            activityRef: itemId,
            classification: target.classification,
            at: occurredAt,
            timezone: initialInput.timezone,
            provenance: panelActionProvenance(occurredAt),
            undoOfEntryId: target.entryId
          })
        );
        const sent = navigator.onLine
          ? await postJson("/api/roamly/companion-panel/action", {
              tripId,
              activityId: itemId,
              kind: "undo",
              occurredAt
            })
          : false;
        if (!sent) {
          const storage = storageOrNull();
          if (storage) {
            const parts = instantStringToLocal(occurredAt, initialInput.timezone);
            const queue = queuePanelAction(storage, tripId, {
              kind: "undo",
              activityRef: itemId,
              occurredAt,
              occurredMinuteOfTrip: parts.minutes
            });
            setPendingCount(queue.length);
          }
        }
      }
    },
    [appendLocal, initialInput.timezone, tripId]
  );

  if (!isMobile) return null;

  const chooserNotification = chooserItemId
    ? surfaces.rows.find((row) => row.itemId === chooserItemId) || null
    : null;
  const detailNotification = detailItemId
    ? panel.active.find((notification) => notification.itemId === detailItemId) || null
    : null;

  return (
    <section aria-label="Live companion" className="relative mx-auto w-[358px] max-w-full">
      {!online || pendingCount > 0 ? (
        <p className="mb-2 rounded-xl bg-[#fff7e8] px-3 py-2 text-[11.5px] font-semibold leading-[1.35] text-[#8a5a00]">
          {!online
            ? "You're offline — your day still works. Anything you tap is saved with its real time and syncs when you're back."
            : `${pendingCount} action${pendingCount === 1 ? "" : "s"} waiting to sync — saved with ${pendingCount === 1 ? "its" : "their"} real time${pendingCount === 1 ? "" : "s"}.`}
        </p>
      ) : null}
      {surfaces.strip ? <CompanionStripView strip={surfaces.strip} onAction={performAction} /> : null}
      <div className="mt-3 flex items-baseline justify-between px-[2px]">
        <span className="text-[13px] font-extrabold text-ink">Your day</span>
        <span className="text-[11px] font-medium text-[#5d726c]">
          {initialInput.destination} · {panel.dateLabel}
        </span>
      </div>
      <div className="mt-2 grid gap-2">
        {surfaces.rows.map((row) => (
          <CompanionRowView key={row.id} row={row} onAction={performAction} />
        ))}
      </div>
      {detailNotification?.detail ? (
        <div className="mt-3">
          <ActivityDetailView
            detail={detailNotification.detail}
            onAction={performAction}
            onDirections={(id) => void performAction("directions", id)}
          />
        </div>
      ) : null}
      <p className="mt-3 px-[2px] text-[11px] leading-[1.35] text-[#5d726c]">
        Finished stops go stale, then leave this panel. Nothing is ever deleted from your trip
        record.
      </p>
      {passView ? (
        <a
          href={`/trip/${tripId}/pass`}
          className="mt-2 block px-[2px] text-[12px] font-bold text-ocean"
        >
          Open your day pass ›
        </a>
      ) : null}
      {chooserItemId && chooserNotification?.directions ? (
        <DirectionsChooserView
          control={chooserNotification.directions}
          placeName={chooserNotification.name}
          onClose={() => setChooserItemId(null)}
        />
      ) : null}
    </section>
  );
}
