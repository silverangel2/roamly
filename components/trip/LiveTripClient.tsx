"use client";

import { useMemo, useState } from "react";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";
import type { ActivityRecord, ChecklistRecord } from "@/lib/trips";

function statusLabel(status: string) {
  if (status === "completed") return "Done";
  if (status === "skipped") return "Skipped";
  if (status === "checked_in" || status === "active") return "Checked in";
  if (status === "nearby") return "Nearby";
  if (status === "missed") return "Missed";
  return "Planned";
}

export function LiveTripClient({
  tripId,
  activities,
  checklist
}: {
  tripId: string;
  activities: ActivityRecord[];
  checklist: ChecklistRecord[];
}) {
  const [items, setItems] = useState(activities);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const active = useMemo(
    () =>
      items.find((item) => item.status === "checked_in" || item.status === "active") ||
      items.find((item) => item.status === "nearby") ||
      items.find((item) => item.status === "planned") ||
      items[0],
    [items]
  );
  const next = useMemo(
    () =>
      items.find((item) => !["completed", "skipped", "missed"].includes(item.status) && item.id !== active?.id) ||
      null,
    [active?.id, items]
  );

  async function runAction(activityId: string, action: "check-in" | "skip" | "complete") {
    setBusy(activityId + action);
    setError("");

    const endpoint =
      action === "check-in"
        ? "/api/roamly/activities/check-in"
        : action === "skip"
          ? "/api/roamly/activities/skip"
          : "/api/roamly/activities/complete";
    const nextStatus = action === "check-in" ? "checked_in" : action === "skip" ? "skipped" : "completed";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tripId, activityId })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update activity.");
      setItems((current) => current.map((item) => (item.id === activityId ? { ...item, status: nextStatus } : item)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update activity.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5">
      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.75rem] bg-ink p-5 text-white shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/55">Now</p>
          <h2 className="mt-2 text-2xl font-black">{active?.title || "Start your day"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-white/75">{active?.description || "Open your itinerary and choose the first stop."}</p>
        </div>
        <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Next</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{next?.title || "Flexible time"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{next?.description || "Use this space for food, rest, or transit."}</p>
        </div>
      </section>

      <p className="rounded-2xl border border-cloud bg-white/85 px-4 py-3 text-sm font-bold leading-6 text-slate-600 shadow-soft">
        Live Trip Companion records progress for this locked itinerary. Major changes need a new itinerary.
      </p>

      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      <section className="space-y-3">
        {items.map((activity) => (
          <article key={activity.id} className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  {activity.time_label || "Anytime"} · {statusLabel(activity.status)}
                </p>
                <h3 className="mt-1 text-xl font-black text-ink">{activity.title}</h3>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{activity.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "check-in")}
                  disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean"
                >
                  Check in
                </button>
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "complete")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-ink px-3 py-2 text-xs font-black text-white"
                >
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "skip")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-cloud px-3 py-2 text-xs font-black text-slate-600"
                >
                  Skip
                </button>
              </div>
            </div>
            <NavigationButtons
              tripId={tripId}
              destinationLabel={activity.title}
              address={activity.map_query || activity.location_name}
              className="mt-3"
            />
          </article>
        ))}
      </section>

      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Checklist reminder</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {checklist.slice(0, 6).map((item) => (
            <p key={item.id} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
              {item.is_done ? "✓ " : ""}{item.item}
            </p>
          ))}
        </div>
      </section>
    </div>
  );
}
