"use client";

import { useState } from "react";

type NotificationItem = {
  id: string;
  title: string;
  body?: string | null;
  type: string;
  status: string;
  action_url?: string | null;
  created_at: string;
  delivery_status?: string | null;
};

function deliveryLabel(status?: string | null) {
  if (!status) {
    return {
      label: "In-app only",
      className: "bg-white text-slate-500 ring-1 ring-cloud"
    };
  }

  if (["sent", "delivered", "captured"].includes(status)) {
    return {
      label: "Email sent",
      className:
        "bg-emerald-100 text-emerald-800"
    };
  }

  if (status === "sending") {
    return {
      label: "Sending email",
      className:
        "bg-sky-100 text-sky-800"
    };
  }

  if (["queued", "retrying"].includes(status)) {
    return {
      label:
        status === "retrying"
          ? "Retrying email"
          : "Email queued",
      className:
        "bg-amber-100 text-amber-800"
    };
  }

  if (["failed", "suppressed"].includes(status)) {
    return {
      label: "Delivery issue",
      className:
        "bg-coral/10 text-coral"
    };
  }

  return {
    label: "In-app available",
    className:
      "bg-white text-slate-500 ring-1 ring-cloud"
  };
}

function notificationTypeLabel(type: string) {
  return type
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

export function NotificationTimelineCard({
  initialItems
}: {
  initialItems: NotificationItem[];
}) {
  const [items, setItems] =
    useState(initialItems);

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

    await fetch(
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
    ).catch(() => undefined);
  }

  return (
    <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
        Notification timeline
      </p>

      <div className="mt-4 grid gap-3">
        {items.length ? (
          items.map((item) => {
            const delivery =
              deliveryLabel(
                item.delivery_status
              );

            return (
              <article
                key={item.id}
                className="rounded-2xl bg-mist p-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                        {notificationTypeLabel(
                          item.type
                        )}
                      </span>

                      <span
                        className={`rounded-full px-2.5 py-1 text-[11px] font-black ${delivery.className}`}
                      >
                        {delivery.label}
                      </span>

                      {item.status !== "read" ? (
                        <span className="rounded-full bg-ocean/10 px-2.5 py-1 text-[11px] font-black text-ocean">
                          Unread
                        </span>
                      ) : null}
                    </div>

                    <h3 className="mt-2 text-lg font-black text-ink">
                      {item.title}
                    </h3>

                    {item.body ? (
                      <p className="mt-1 text-sm font-bold leading-6 text-slate-600">
                        {item.body}
                      </p>
                    ) : null}

                    {["failed", "suppressed"].includes(
                      item.delivery_status || ""
                    ) ? (
                      <p className="mt-3 rounded-xl bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-600 ring-1 ring-cloud">
                        The alert is still available here,
                        but its email could not be delivered.
                      </p>
                    ) : null}
                  </div>

                  <div className="flex shrink-0 flex-wrap gap-2">
                    {item.action_url ? (
                      <a
                        href={item.action_url}
                        className="rounded-full bg-white px-3 py-2 text-xs font-black text-ink ring-1 ring-cloud"
                      >
                        Open
                      </a>
                    ) : null}

                    {item.status !== "read" ? (
                      <button
                        type="button"
                        onClick={() =>
                          void markRead(item.id)
                        }
                        className="rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-2 text-xs font-black text-white shadow-lg shadow-cyan-500/20"
                      >
                        Mark read
                      </button>
                    ) : null}
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            No notifications yet.
          </p>
        )}
      </div>
    </div>
  );
}
