"use client";

import { useCallback, useEffect, useState } from "react";

type Delivery = {
  id: string;
  user_id: string;
  trip_id: string | null;
  booking_id: string | null;
  companion_event_id: string | null;
  repair_proposal_id: string | null;
  notification_type: string;
  priority: string;
  title: string;
  body: string;
  action_url: string | null;
  status: string;
  attempt_count: number;
  max_attempts: number;
  provider_name: string | null;
  provider_message_id: string | null;
  last_error: string | null;
  suppression_reason: string | null;
  is_test: boolean;
  metadata_json: Record<string, unknown> | null;
  scheduled_for: string;
  next_attempt_at: string;
  sent_at: string | null;
  failed_at: string | null;
  created_at: string;
};

const STATUSES = [
  "",
  "queued",
  "retrying",
  "sent",
  "captured",
  "failed",
  "suppressed"
];

const TYPES = [
  "",
  "booking_confirmed",
  "flight_delay",
  "flight_cancelled",
  "booking_changed",
  "repair_proposed",
  "repair_applied",
  "approval_required",
  "daily_briefing",
  "final_day_briefing"
];

function formatDate(value: string | null) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString();
}

function statusClass(status: string) {
  if (["sent", "delivered", "captured"].includes(status)) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (["failed", "suppressed"].includes(status)) {
    return "bg-coral/10 text-coral";
  }

  if (["queued", "retrying", "sending"].includes(status)) {
    return "bg-amber-100 text-amber-800";
  }

  return "bg-mist text-slate-600";
}

export default function CompanionNotificationConsole() {
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [status, setStatus] = useState("");
  const [type, setType] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const loadDeliveries = useCallback(async () => {
    setError("");

    const query = new URLSearchParams();

    if (status) query.set("status", status);
    if (type) query.set("type", type);

    const response = await fetch(
      `/api/admin/roamly/companion-notifications?${query.toString()}`,
      {
        cache: "no-store"
      }
    );

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      setError(
        payload.error ||
          "Companion notification history could not be loaded."
      );
      return;
    }

    setDeliveries(payload.deliveries || []);
  }, [status, type]);

  useEffect(() => {
    void loadDeliveries();
  }, [loadDeliveries]);

  async function retryDelivery(deliveryId: string) {
    setBusy(deliveryId);
    setError("");
    setNotice("");

    try {
      const response = await fetch(
        "/api/admin/roamly/companion-notifications",
        {
          method: "POST",
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            action: "retry",
            deliveryId
          })
        }
      );

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(
          payload.error ||
            payload.result?.error ||
            "Companion delivery retry failed."
        );
        return;
      }

      setNotice("Companion notification delivery retried.");
      await loadDeliveries();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[2rem] border border-cloud bg-white/90 p-6 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
          Companion notifications
        </p>

        <h1 className="mt-2 text-3xl font-black text-ink">
          Delivery history and diagnostics
        </h1>

        <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
          Review transactional travel alerts, provider delivery status,
          retry attempts, failures, and related Companion records.
        </p>

        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-[220px_260px_auto]">
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
          >
            {STATUSES.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "All statuses"}
              </option>
            ))}
          </select>

          <select
            value={type}
            onChange={(event) => setType(event.target.value)}
            className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
          >
            {TYPES.map((value) => (
              <option key={value || "all"} value={value}>
                {value || "All notification types"}
              </option>
            ))}
          </select>

          <button
            type="button"
            onClick={() => void loadDeliveries()}
            className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white"
          >
            Refresh history
          </button>
        </div>

        {notice ? (
          <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
            {notice}
          </p>
        ) : null}

        {error ? (
          <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
            {error}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4">
        {deliveries.map((delivery) => (
          <article
            key={delivery.id}
            className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft"
          >
            <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap gap-2">
                  <span
                    className={`rounded-full px-3 py-1 text-xs font-black ${statusClass(
                      delivery.status
                    )}`}
                  >
                    {delivery.status}
                  </span>

                  <span className="rounded-full bg-mist px-3 py-1 text-xs font-black text-slate-600">
                    {delivery.notification_type}
                  </span>

                  <span className="rounded-full bg-mist px-3 py-1 text-xs font-black text-slate-600">
                    {delivery.priority}
                  </span>

                  {delivery.is_test ? (
                    <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-black text-violet-800">
                      TEST
                    </span>
                  ) : null}
                </div>

                <h2 className="mt-3 break-words text-lg font-black text-ink">
                  {delivery.title}
                </h2>

                <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                  {delivery.body}
                </p>
              </div>

              {["failed", "retrying", "queued"].includes(
                delivery.status
              ) ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => retryDelivery(delivery.id)}
                  className="rounded-2xl bg-ink px-4 py-3 text-xs font-black text-white disabled:opacity-50"
                >
                  {busy === delivery.id
                    ? "Retrying…"
                    : "Retry delivery"}
                </button>
              ) : null}
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl bg-mist p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Attempts
                </p>
                <p className="mt-1 text-sm font-black text-ink">
                  {delivery.attempt_count} / {delivery.max_attempts}
                </p>
              </div>

              <div className="rounded-2xl bg-mist p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Provider
                </p>
                <p className="mt-1 break-words text-sm font-black text-ink">
                  {delivery.provider_name || "Not assigned"}
                </p>
              </div>

              <div className="rounded-2xl bg-mist p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Created
                </p>
                <p className="mt-1 text-sm font-black text-ink">
                  {formatDate(delivery.created_at)}
                </p>
              </div>

              <div className="rounded-2xl bg-mist p-3">
                <p className="text-[11px] font-black uppercase tracking-[0.14em] text-slate-400">
                  Sent
                </p>
                <p className="mt-1 text-sm font-black text-ink">
                  {formatDate(delivery.sent_at)}
                </p>
              </div>
            </div>

            {delivery.trip_id ? (
              <a
                href={`/trip/${delivery.trip_id}/live`}
                className="mt-4 inline-flex rounded-xl bg-white px-4 py-2 text-xs font-black text-ink shadow-soft ring-1 ring-cloud"
              >
                Open related trip
              </a>
            ) : null}

            {delivery.provider_message_id ? (
              <p className="mt-4 break-all text-xs font-bold text-slate-500">
                Provider message ID: {delivery.provider_message_id}
              </p>
            ) : null}

            {delivery.last_error || delivery.suppression_reason ? (
              <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-xs font-black text-coral">
                {delivery.last_error || delivery.suppression_reason}
              </p>
            ) : null}

            <details className="mt-4 rounded-2xl bg-mist p-4">
              <summary className="cursor-pointer text-xs font-black uppercase tracking-[0.12em] text-slate-500">
                Technical details
              </summary>

              <pre className="mt-3 max-h-80 overflow-auto whitespace-pre-wrap text-xs leading-5 text-slate-600">
                {JSON.stringify(
                  {
                    deliveryId: delivery.id,
                    userId: delivery.user_id,
                    bookingId: delivery.booking_id,
                    companionEventId:
                      delivery.companion_event_id,
                    repairProposalId:
                      delivery.repair_proposal_id,
                    actionUrl: delivery.action_url,
                    scheduledFor: delivery.scheduled_for,
                    nextAttemptAt:
                      delivery.next_attempt_at,
                    failedAt: delivery.failed_at,
                    metadata: delivery.metadata_json
                  },
                  null,
                  2
                )}
              </pre>
            </details>
          </article>
        ))}

        {!deliveries.length ? (
          <p className="rounded-[1.75rem] border border-cloud bg-white/90 px-5 py-8 text-center text-sm font-black text-slate-500 shadow-soft">
            No Companion notification deliveries match these filters.
          </p>
        ) : null}
      </section>
    </div>
  );
}
