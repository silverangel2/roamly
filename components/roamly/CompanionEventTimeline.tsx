"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BuiChip } from "@/components/boardui/Badge";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard, BuiSkeleton } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import type { BuiTone } from "@/components/boardui/tokens";
import { useI18n } from "@/components/i18n/I18nProvider";
import { formatRoamlyDate } from "@/lib/i18n";

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
  repairVerificationStatus: string | null;
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
  if (event.repairVerificationStatus === "resolved") return "Verified resolved";
  if (event.repairVerificationStatus === "still_affected") return "Still affected";
  if (event.repairVerificationStatus === "uncertain") return "Verification incomplete";
  if (event.repairVerificationStatus === "pending" && event.repairStatus === "applied") return "Applied — verifying current itinerary";
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

function statusTone(
  event: CompanionEventItem
): BuiTone {
  const label = statusLabel(event);

  if (
    [
      "Repair applied",
      "Verified resolved",
      "Resolved"
    ].includes(label)
  ) {
    return "success";
  }

  if (
    [
      "Approval required",
      "Repair proposed",
      "Analyzing impact",
      "Partially applied",
      "Applied — verifying current itinerary",
      "Still affected",
      "Verification incomplete"
    ].includes(label)
  ) {
    return "warm";
  }

  if (
    label === "Original plan kept" ||
    label === "No action needed"
  ) {
    return "neutral";
  }

  return "danger";
}

function severityTone(
  severity: string
): BuiTone {
  if (severity === "critical") {
    return "danger";
  }

  if (severity === "important") {
    return "warm";
  }

  if (severity === "routine") {
    return "primary";
  }

  return "neutral";
}

function formatDate(value: string | null, locale: Parameters<typeof formatRoamlyDate>[1]) {
  if (!value) return "—";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return formatRoamlyDate(date, locale, { dateStyle: "medium", timeStyle: "short" });
}

export default function CompanionEventTimeline({
  tripId
}: {
  tripId: string;
}) {
  const { locale } = useI18n();
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
    <section className="bui-enter rounded-bui-panel border border-chair bg-white p-5 shadow-bui-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">
            Companion history
          </p>

          <h2 className="mt-2 text-2xl font-black text-chead">
            Trip changes and outcomes
          </h2>

          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-cink">
            Follow detected disruptions, impact analysis,
            repair proposals, approvals, and resolved changes.
          </p>
        </div>

        <BuiButton type="button" variant="secondary" size="small" onClick={() => void loadEvents()}>
          Refresh
        </BuiButton>
      </div>

      {error ? <BuiNotice tone="error" title={error} className="mt-4" /> : null}

      <div className="relative mt-5 grid gap-4">
        <span aria-hidden="true" className="absolute bottom-2 left-[5px] top-2 w-px bg-chair" />
        {loading ? (
          <div className="grid gap-3" aria-label="Loading Companion history…">
            <BuiSkeleton className="h-24 w-full" />
            <BuiSkeleton className="h-24 w-full" />
          </div>
        ) : null}

        {!loading &&
          events.map((event, eventIndex) => (
            <article
              key={event.id}
              className="bui-enter relative rounded-bui-card border border-chair bg-cbg p-4 pl-6"
              style={{ "--bui-delay": `${Math.min(eventIndex * 60, 240)}ms` } as CSSProperties}
            >
              <span aria-hidden="true" className="absolute left-0 top-5 h-[11px] w-[11px] rounded-full border-2 border-white bg-cblue shadow-bui-card" />
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap gap-2">
                    <BuiChip tone={statusTone(event)}>
                      {statusLabel(event)}
                    </BuiChip>

                    <BuiChip tone={severityTone(event.severity)}>
                      {words(event.severity)}
                    </BuiChip>

                    <BuiChip tone="neutral" className="bg-white">
                      {words(event.eventType)}
                    </BuiChip>
                  </div>

                  <h3 className="mt-3 text-lg font-black text-chead">
                    {event.title}
                  </h3>

                  <p className="mt-2 text-sm font-bold leading-6 text-cink">
                    {event.summary}
                  </p>
                </div>

                <p className="shrink-0 text-xs font-bold text-cgray2">
                      {formatDate(event.detectedAt, locale)}
                </p>
              </div>

              {event.affectedLayers.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {event.affectedLayers.map(
                    (layer) => (
                      <BuiChip key={layer} tone="neutral" className="bg-white">
                        {words(layer)}
                      </BuiChip>
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
                <BuiButtonLink href="#companion-repairs" size="small" className="mt-4">
                  Review repair
                </BuiButtonLink>
              ) : null}

              {event.resolvedAt ? (
                <p className="mt-4 text-xs font-bold text-cgray2">
                  Resolved {formatDate(event.resolvedAt, locale)}
                </p>
              ) : null}
            </article>
          ))}

        {!loading && !events.length ? (
          <BuiCard className="p-4">
            <p className="text-sm font-black text-cgray">
              No Companion disruptions or repairs have been recorded for this trip.
            </p>
          </BuiCard>
        ) : null}
      </div>
    </section>
  );
}
