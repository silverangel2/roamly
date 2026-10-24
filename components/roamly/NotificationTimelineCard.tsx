"use client";

import { useState } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";

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
  delivery_status?: string | null;
  delivery_channel?: string | null;
};

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

export function NotificationTimelineCard({
  initialItems
}: {
  initialItems: NotificationItem[];
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

  const actionLinkClass = "text-sm font-semibold text-cblue";

  function renderRow(item: NotificationItem) {
    const delivery = deliveryLabel(item.delivery_status, item.delivery_channel, t);
    const unread = item.status !== "read";
    return (
      <article key={item.id} className="py-3 pl-3 pr-4">
        <div className="flex items-start gap-2.5">
          <span
            aria-hidden
            className={`mt-[7px] h-[9px] w-[9px] shrink-0 rounded-full ${unread ? "bg-chead" : "bg-transparent"}`}
          />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-3">
              <h3
                className={`min-w-0 flex-1 text-[16.5px] leading-[1.3] ${
                  unread ? "font-semibold text-chead" : "font-normal text-cink"
                }`}
              >
                {item.title}
              </h3>
              <span className="shrink-0 text-[13.5px] font-normal text-cgray2">{rowTime(item.created_at)}</span>
            </div>

            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[12.5px] font-normal text-cgray">
              <span className="uppercase tracking-[0.04em]">{notificationTypeLabel(item.type)}</span>
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
              <p className="mt-2 rounded-xl bg-cred/10 px-3 py-2 text-xs font-normal leading-5 text-cink">
                {t("ui.status.alertEmailUnavailable")}
              </p>
            ) : null}
            {item.delivery_channel === "push" && ["failed", "suppressed"].includes(item.delivery_status || "") ? (
              <p className="mt-2 rounded-xl bg-cred/10 px-3 py-2 text-xs font-normal leading-5 text-cink">
                {t("ui.status.alertPushUnavailable", "This push notification could not be delivered. You can still read it here.")}
              </p>
            ) : null}

            <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1">
              {isInfoNotification(item) && item.trip_id && item.event_id ? (
                <a
                  href={`/trip/${item.trip_id}/event/${item.event_id}`}
                  onClick={() => {
                    if (item.status !== "read") void markRead(item.id);
                  }}
                  className={actionLinkClass}
                >
                  {t("ui.actions.open")}
                </a>
              ) : isInfoNotification(item) ? (
                <button type="button" onClick={() => toggleExpanded(item)} className={actionLinkClass}>
                  {expandedIds.has(item.id) ? t("ui.actions.close", "Close") : t("ui.actions.open")}
                </button>
              ) : item.action_url && item.action_state !== "history" && item.action_state !== "unavailable" ? (
                <a href={item.action_url} className={actionLinkClass}>
                  {t("ui.actions.open")}
                </a>
              ) : null}

              {!isInfoNotification(item) && item.action_state === "history" ? (
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
      </article>
    );
  }

  return (
    <div>
      <p className="mb-2 ml-4 text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">
        {t("ui.status.notificationTimeline")}
      </p>

      {items.length ? (
        groups.map((group) => (
          <div key={group.key} className="mb-5 last:mb-0">
            {group.label ? (
              <p className="mb-2 ml-4 text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">{group.label}</p>
            ) : null}
            <div className="divide-y divide-chair overflow-hidden rounded-[14px] bg-white shadow-calm">
              {group.rows.map(renderRow)}
            </div>
          </div>
        ))
      ) : (
        <div className="overflow-hidden rounded-[14px] bg-white shadow-calm">
          <p className="px-4 py-3 text-[15px] font-normal text-cgray">{t("ui.status.noNotifications")}</p>
        </div>
      )}
    </div>
  );
}
