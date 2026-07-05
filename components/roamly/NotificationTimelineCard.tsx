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
};

export function NotificationTimelineCard({ initialItems }: { initialItems: NotificationItem[] }) {
  const [items, setItems] = useState(initialItems);

  async function markRead(id: string) {
    setItems((current) => current.map((item) => (item.id === id ? { ...item, status: "read" } : item)));
    await fetch("/api/roamly/notifications/read", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ notificationId: id })
    }).catch(() => undefined);
  }

  return (
    <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Notification timeline</p>
      <div className="mt-4 grid gap-3">
        {items.length ? (
          items.map((item) => (
            <article key={item.id} className="rounded-2xl bg-mist p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                    {item.type} · {item.status}
                  </p>
                  <h3 className="mt-1 text-lg font-black text-ink">{item.title}</h3>
                  {item.body ? <p className="mt-1 text-sm font-bold leading-6 text-slate-600">{item.body}</p> : null}
                </div>
                <div className="flex gap-2">
                  {item.action_url ? (
                    <a href={item.action_url} className="rounded-full bg-white px-3 py-2 text-xs font-black text-ink ring-1 ring-cloud">
                      Open
                    </a>
                  ) : null}
                  {item.status !== "read" ? (
                    <button
                      type="button"
                      onClick={() => void markRead(item.id)}
                      className="rounded-full bg-ink px-3 py-2 text-xs font-black text-white"
                    >
                      Mark read
                    </button>
                  ) : null}
                </div>
              </div>
            </article>
          ))
        ) : (
          <p className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">
            No notifications yet.
          </p>
        )}
      </div>
    </div>
  );
}
