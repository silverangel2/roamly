"use client";

import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { animateSpringValue, rubberBand, type BuiSpringHandle } from "@/components/boardui/spring";

type NotificationItem = {
  id: string;
  title: string;
  body?: string | null;
  type: string;
  status: string;
  trip_id?: string | null;
  event_id?: string | null;
  action_url?: string | null;
  action_state?: "available" | "history" | "unavailable";
  created_at: string;
  scheduled_for?: string | null;
  is_outdated?: boolean;
  delivery_status?: string | null;
  delivery_channel?: string | null;
};

export type NotificationSection =
  | "action-required"
  | "upcoming"
  | "travel-updates"
  | "activity-history";

/* Delivery state in the calm language: a small dot + word, never a
   colored pill. The dot carries the semantics (green sent, blue
   sending, amber waiting, red issue, gray in-app only). */
function deliveryLabel(status: string | null | undefined, channel: string | null | undefined, t: (key: string, fallback?: string) => string) {
  if (!status) {
    return { label: t("ui.status.inAppOnly"), dot: "bg-cgray2" };
  }

  if (["sent", "delivered", "captured"].includes(status)) {
    return {
      label: channel === "push" ? t("ui.status.pushSent", "Push delivered") : t("ui.status.emailSent"),
      dot: "bg-cgreen"
    };
  }

  if (status === "sending") {
    return {
      label: channel === "push" ? t("ui.status.sendingPush", "Sending push") : t("ui.status.sendingEmail"),
      dot: "bg-cblue"
    };
  }

  if (["queued", "retrying"].includes(status)) {
    return {
      label:
        status === "retrying"
          ? channel === "push" ? t("ui.status.retryingPush", "Retrying push") : t("ui.status.retryingEmail")
          : channel === "push" ? t("ui.status.pushQueued", "Push queued") : t("ui.status.emailQueued"),
      dot: "bg-[#FF9500]"
    };
  }

  if (["failed", "suppressed"].includes(status)) {
    return { label: t("ui.status.deliveryIssue"), dot: "bg-cred" };
  }

  return { label: t("ui.status.inAppAvailable"), dot: "bg-cgray2" };
}

function notificationTypeLabel(type: string) {
  return type
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

/* Row time in the mock's register: a clock time today, "Yesterday",
   then a short date. Presentation only — the row's data is unchanged. */
function rowTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(date);
  }
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (date.toDateString() === yesterday.toDateString()) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function isTodayItem(iso: string) {
  const date = new Date(iso);
  return !Number.isNaN(date.getTime()) && date.toDateString() === new Date().toDateString();
}

/* Scheduled intent, distinct from the mint time: the scheduler's
   scheduled_for is when the card was DUE ("Due Oct 23"), while the row
   time beside the title is when the row was actually minted. Showing
   both explains batch-minted cards (e.g. three cards stamped one minute)
   without relabelling the mint time. */
function dueLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return `Due ${new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date)}`;
}

/** Info reminders carry their whole message in the card's title + body — the
 *  note IS the destination, so these open in place instead of navigating to a
 *  generic page. Only action notifications (check-in, nearby, booking, …),
 *  whose action genuinely lives elsewhere, keep their deep link. */
const INFO_NOTIFICATION_TYPES = new Set([
  "country_info",
  "document_check",
  "one_week_before",
  "packing_check",
  "one_day_before",
  "countdown_24h",
  "travel_day_started",
  "trip_predeparture_7d",
  "trip_predeparture_1d",
  "travel_day",
  "daily_trip_briefing",
  "daily_briefing",
  "final_day_briefing"
]);

function isInfoNotification(item: NotificationItem) {
  return INFO_NOTIFICATION_TYPES.has(item.type);
}

/* Swipe-away (smooth details, 2026-11-04): an UNREAD row follows
 * the finger with a tilt up to ~12°, and a leftward flick (or a
 * drag past ~88px) flies it off on the foundation spring and files
 * it with the row's EXISTING mark-read action — the same outcome
 * as the row's own "Mark read" button, no new destructive power:
 * read rows don't swipe, and a short or slow drag springs back.
 * Rightward drags meet rubber-band resistance (they commit
 * nothing). The click a drag ends with is swallowed so a swipe
 * never also opens the row. Vertical scrolling is untouched
 * (touch-pan-y: the browser keeps the scroll, we keep the swipe). */
function SwipeToReadRow({
  enabled,
  onCommit,
  children
}: {
  enabled: boolean;
  onCommit: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const springRef = useRef<BuiSpringHandle | null>(null);
  const gestureRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    engaged: boolean;
    visualDx: number;
    samples: Array<{ t: number; x: number }>;
  } | null>(null);
  const suppressClickUntilRef = useRef(0);

  const writeTransform = (dx: number) => {
    const el = ref.current;
    if (!el) return;
    const tilt = Math.max(-12, Math.min(12, (dx / 140) * 12));
    el.style.transform = `translateX(${dx}px) rotate(${tilt}deg)`;
  };

  const springTo = (target: number, velocityPxPerSec: number, fromDx: number, onDone?: () => void) => {
    const el = ref.current;
    if (!el) return;
    springRef.current?.cancel();
    springRef.current = animateSpringValue({
      from: fromDx,
      to: target,
      velocity: velocityPxPerSec,
      stiffness: 340,
      dampingRatio: 0.85,
      restDelta: 0.4,
      restVelocity: 10,
      onFrame: (value) => {
        if (gestureRef.current) gestureRef.current.visualDx = value;
        writeTransform(value);
      },
      onRest: () => onDone?.()
    });
  };

  return (
    <div
      ref={ref}
      className="touch-pan-y will-change-transform"
      onClickCapture={(event) => {
        if (Date.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
        }
      }}
      onPointerDown={(event) => {
        if (!enabled || event.button !== 0) return;
        springRef.current?.cancel();
        gestureRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          engaged: false,
          visualDx: 0,
          samples: [{ t: performance.now(), x: event.clientX }]
        };
      }}
      onPointerMove={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        const dx = event.clientX - gesture.startX;
        const dy = event.clientY - gesture.startY;
        if (!gesture.engaged) {
          if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.2) {
            gesture.engaged = true;
            ref.current?.setPointerCapture(event.pointerId);
          } else {
            return;
          }
        }
        const now = performance.now();
        gesture.samples.push({ t: now, x: event.clientX });
        while (gesture.samples.length > 2 && now - gesture.samples[0].t > 120) gesture.samples.shift();
        gesture.visualDx = dx < 0 ? dx : rubberBand(dx, 151);
        writeTransform(gesture.visualDx);
      }}
      onPointerUp={(event) => {
        const gesture = gestureRef.current;
        if (!gesture || gesture.pointerId !== event.pointerId) return;
        gestureRef.current = null;
        if (!gesture.engaged) return;
        suppressClickUntilRef.current = Date.now() + 300;
        const dx = event.clientX - gesture.startX;
        const first = gesture.samples[0];
        const last = gesture.samples[gesture.samples.length - 1];
        const vx = first && last && last.t > first.t ? (last.x - first.x) / (last.t - first.t) : 0;
        const width = ref.current?.offsetWidth ?? 320;
        if (dx < -88 || vx < -0.45) {
          springTo(-(width + 48), vx * 1000, gesture.visualDx, () => {
            window.setTimeout(() => {
              onCommit();
              springRef.current?.cancel();
              writeTransform(0);
            }, 60);
          });
        } else {
          springTo(0, vx * 1000, gesture.visualDx);
        }
      }}
      onPointerCancel={() => {
        const gesture = gestureRef.current;
        if (gesture?.engaged) springTo(0, 0, gesture.visualDx);
        gestureRef.current = null;
      }}
    >
      {children}
    </div>
  );
}

export function NotificationTimelineCard({
  initialItems,
  heading,
  section
}: {
  initialItems: NotificationItem[];
  heading?: string | null;
  section?: NotificationSection;
}) {
  const { t } = useI18n();
  const [items, setItems] =
    useState(initialItems);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  function toggleExpanded(item: NotificationItem) {
    const opening = !expandedIds.has(item.id);
    setExpandedIds((current) => {
      const next = new Set(current);
      if (opening) next.add(item.id);
      else next.delete(item.id);
      return next;
    });
    if (opening && item.status !== "read") void markRead(item.id);
  }

  async function markRead(id: string) {
    setItems((current) =>
      current.map((item) =>
        item.id === id
          ? {
              ...item,
              status: "read"
            }
          : item
      )
    );

    const response = await fetch(
      "/api/roamly/notifications/read",
      {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify({
          notificationId: id
        })
      }
    ).catch(() => null);

    if (response?.ok) {
      window.dispatchEvent(new Event("roamly:shell-state-refresh"));
    }
  }

  const todayRows = items.filter((item) => isTodayItem(item.created_at));
  const earlierRows = items.filter((item) => !isTodayItem(item.created_at));
  const groups: Array<{ key: string; label: string | null; rows: NotificationItem[] }> = [];
  if (todayRows.length) {
    groups.push({ key: "today", label: earlierRows.length ? t("ui.notifications.today", "Today") : null, rows: todayRows });
  }
  if (earlierRows.length) {
    groups.push({ key: "earlier", label: todayRows.length ? t("ui.notifications.earlier", "Earlier") : null, rows: earlierRows });
  }

  const actionLinkClass = "bui-press bui-touch inline-flex items-center px-1 text-sm font-semibold text-cblue";

  function renderRow(item: NotificationItem, rowIndex = 0) {
    const delivery = deliveryLabel(item.delivery_status, item.delivery_channel, t);
    const unread = item.status !== "read";
    // Outdated pre-trip cards no longer demand attention: no unread dot,
    // even though the row itself is still unread until the user marks it.
    const showUnreadDot = unread && !item.is_outdated;
    const due = dueLabel(item.scheduled_for);
    return (
      <article key={item.id} className="bui-enter py-3 pl-3 pr-4" style={{ "--bui-delay": `${Math.min(rowIndex * 70, 350)}ms` } as CSSProperties}>
        <SwipeToReadRow enabled={unread} onCommit={() => void markRead(item.id)}>
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={`mt-[7px] h-[9px] w-[9px] shrink-0 rounded-full ${showUnreadDot ? "bg-cblue" : "bg-transparent"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h3
                className={`min-w-0 flex-1 text-[16.5px] leading-[1.3] ${
                  showUnreadDot ? "font-semibold text-chead" : "font-normal text-cink"
                }`}
              >
                {item.title}
              </h3>
              <span className="shrink-0 text-[13.5px] font-normal text-cgray2">{rowTime(item.created_at)}</span>
            </div>

            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-normal text-cgray">
              <span className="uppercase tracking-[0.04em]">{notificationTypeLabel(item.type)}</span>
              {section === "activity-history" ? <span>History</span> : null}
              {item.is_outdated ? <span className="font-semibold">Outdated</span> : null}
              {due ? <span>{due}</span> : null}
              <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${delivery.dot}`} />
              <span>{delivery.label}</span>
            </p>

            {item.body ? (
              <p
                className={`mt-1 text-[14.5px] font-normal leading-[1.35] text-cgray ${
                  isInfoNotification(item) && !expandedIds.has(item.id) ? "line-clamp-3" : ""
                }`}
              >
                {item.body}
              </p>
            ) : null}

            {item.delivery_channel === "email" && ["failed", "suppressed"].includes(item.delivery_status || "") ? (
              <p className="mt-2 rounded-bui-card border border-cred/40 bg-cred/10 px-3 py-2 text-xs font-normal leading-5 text-cink">
                {t("ui.status.alertEmailUnavailable")}
              </p>
            ) : null}
            {item.delivery_channel === "push" && ["failed", "suppressed"].includes(item.delivery_status || "") ? (
              <p className="mt-2 rounded-bui-card border border-cred/40 bg-cred/10 px-3 py-2 text-xs font-normal leading-5 text-cink">
                {t("ui.status.alertPushUnavailable", "This push notification could not be delivered. You can still read it here.")}
              </p>
            ) : null}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {isInfoNotification(item) && item.trip_id && item.event_id && item.action_state !== "history" ? (
                <a
                  href={`/trip/${item.trip_id}/event/${item.event_id}`}
                  onClick={() => {
                    if (item.status !== "read") void markRead(item.id);
                  }}
                  className={actionLinkClass}
                >
                  {t("ui.actions.open")}
                </a>
              ) : isInfoNotification(item) && item.action_state !== "history" ? (
                <button type="button" onClick={() => toggleExpanded(item)} className={actionLinkClass}>
                  {expandedIds.has(item.id) ? t("ui.actions.close", "Close") : t("ui.actions.open")}
                </button>
              ) : item.action_url && item.action_state !== "history" && item.action_state !== "unavailable" ? (
                <a href={item.action_url} className={actionLinkClass}>
                  {t("ui.actions.open")}
                </a>
              ) : null}

              {item.action_state === "history" ? (
                <span className="text-sm font-normal text-cgray2">History only</span>
              ) : null}

              {unread ? (
                <button type="button" onClick={() => void markRead(item.id)} className={actionLinkClass}>
                  {t("ui.actions.markRead")}
                </button>
              ) : null}
            </div>
          </div>
        </div>
        </SwipeToReadRow>
      </article>
    );
  }

  return (
    <div>
      {heading ? (
        <p className="mb-2 ml-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">{heading}</p>
      ) : null}
      {items.length ? (
        groups.map((group) => (
          <div key={group.key} className="bui-enter mb-5 last:mb-0">
            {group.label ? (
              <p className="mb-2 ml-4 text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{group.label}</p>
            ) : null}
            <div className="divide-y divide-chair overflow-hidden rounded-bui-card border border-chair bg-white shadow-bui-card">
              {group.rows.map((item, rowIndex) => renderRow(item, rowIndex))}
            </div>
          </div>
        ))
      ) : (
        <div className="overflow-hidden rounded-bui-card border border-chair bg-white shadow-bui-card">
          <p className="px-4 py-3 text-[15px] font-normal text-cgray">{t("ui.status.noNotifications")}</p>
        </div>
      )}
    </div>
  );
}
