"use client";

import { useCallback, useEffect, useState } from "react";

type CompanionEventItem = {
  id: string;
  eventType: string;
  severity: string;
  status: string;
  title: string;
  summary: string;
  affectedLayers: string[];
  requiresApproval: boolean;
  detectedAt: string;
  resolvedAt: string | null;
  updatedAt: string | null;
  repairId: string | null;
  repairStatus: string | null;
};

function words(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (letter) =>
      letter.toUpperCase()
    );
}

function statusLabel(
  event: CompanionEventItem
) {
  if (
    event.repairStatus === "rejected" ||
    event.status === "dismissed"
  ) {
    return "Original plan kept";
  }

  if (
    ["applied", "completed"].includes(
      event.repairStatus || ""
    ) ||
    event.status === "applied"
  ) {
    return "Repair applied";
  }

  if (
    event.repairStatus ===
      "partially_applied"
  ) {
    return "Partially applied";
  }

  if (
    event.requiresApproval &&
    ["new", "processing", "proposed"].includes(
      event.status
    )
  ) {
    return "Approval required";
  }

  if (event.status === "proposed") {
    return "Repair proposed";
  }

  if (event.status === "processing") {
    return "Analyzing impact";
  }

  if (event.status === "resolved") {
    return "Resolved";
  }

  if (event.status === "suppressed") {
    return "No action needed";
  }

  return words(event.status);
}

function statusClass(
  event: CompanionEventItem
) {
  const label = statusLabel(event);

  if (
    [
      "Repair applied",
      "Resolved"
    ].includes(label)
  ) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (
    [
      "Approval required",
      "Repair proposed",
      "Analyzing impact",
      "Partially applied"
    ].includes(label)
  ) {
    return "bg-amber-100 text-amber-800";
  }

  if (
    label === "Original plan kept" ||
    label === "No action needed"
  ) {
    return "bg-slate-100 text-slate-700";
  }

  return "bg-coral/10 text-coral";
}

function severityClass(
  severity: string
) {
  if (severity === "critical") {
    return "bg-coral/10 text-coral";
  }

  if (severity === "important") {
    return "bg-amber-100 text-amber-800";
  }

  if (severity === "routine") {
    return "bg-sky-100 text-sky-800";
  }

  return "bg-slate-100 text-slate-600";
}

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

export default function CompanionEventTimeline({
  tripId
}: {
  tripId: string;
}) {
  const [events, setEvents] = useState<
    CompanionEventItem[]
  >([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const loadEvents = useCallback(async () => {
    setError("");

    try {
      const response = await fetch(
        `/api/trips/${tripId}/companion/events`,
        {
          cache: "no-store"
        }
      );

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(
          payload.error ||
            "Companion history could not be loaded."
        );
        return;
      }

      setEvents(payload.events || []);
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Companion history could not be loaded."
      );
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    void loadEvents();
  }, [loadEvents]);

  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            Companion history
          </p>

          <h2 className="mt-2 text-2xl font-black text-ink">
            Trip changes and outcomes
          </h2>

          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-600">
            Follow detected disruptions, impact analysis,
            repair proposals, approvals, and resolved changes.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadEvents()}
          className="rounded-full bg-white px-4 py-2 text-xs font-black text-ink ring-1 ring-cloud"
        >
          Refresh
        </button>
      </div>

      {error ? (
        <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {error}
        </p>
      ) : null}

      <div className="mt-5 grid gap-4">
        {loading ? (
          <p className="rounded-2xl bg-mist px-4 py-4 text-sm font-black text-slate-500">
            Loading Companion history…
          </p>
        ) : null}

        {!loading &&
          events.map((event) => (
            <article
              key={event.id}
              className="relative rounded-2xl bg-mist p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(
                        event
                      )}`}
                    >
                      {statusLabel(event)}
                    </span>

                    <span
                      className={`rounded-full px-3 py-1 text-xs font-black ${severityClass(
                        event.severity
                      )}`}
                    >
                      {words(event.severity)}
                    </span>

                    <span className="rounded-full bg-white px-3 py-1 text-xs font-black text-slate-600 ring-1 ring-cloud">
                      {words(event.eventType)}
                    </span>
                  </div>

                  <h3 className="mt-3 text-lg font-black text-ink">
                    {event.title}
                  </h3>

                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    {event.summary}
                  </p>
                </div>

                <p className="shrink-0 text-xs font-bold text-slate-400">
                  {formatDate(event.detectedAt)}
                </p>
              </div>

              {event.affectedLayers.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {event.affectedLayers.map(
                    (layer) => (
                      <span
                        key={layer}
                        className="rounded-full bg-white px-3 py-1 text-xs font-bold text-slate-600 ring-1 ring-cloud"
                      >
                        {words(layer)}
                      </span>
                    )
                  )}
                </div>
              ) : null}

              {event.repairId &&
              [
                "proposed",
                "processing",
                "new"
              ].includes(event.status) ? (
                <a
                  href="#companion-repairs"
                  className="mt-4 inline-flex rounded-xl bg-ink px-4 py-2 text-xs font-black text-white"
                >
                  Review repair
                </a>
              ) : null}

              {event.resolvedAt ? (
                <p className="mt-4 text-xs font-bold text-slate-400">
                  Resolved {formatDate(event.resolvedAt)}
                </p>
              ) : null}
            </article>
          ))}

        {!loading && !events.length ? (
          <p className="rounded-2xl bg-mist px-4 py-4 text-sm font-black text-slate-500">
            No Companion disruptions or repairs have been recorded for this trip.
          </p>
        ) : null}
      </div>
    </section>
  );
}
