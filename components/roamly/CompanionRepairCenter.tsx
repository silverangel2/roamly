"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import { BuiChip } from "@/components/boardui/Badge";
import { BuiButton } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import type { BuiTone } from "@/components/boardui/tokens";

type RepairRecord = {
  id: string;
  status?: string | null;
  operation?: string | null;
  verification_status?: "pending" | "resolved" | "still_affected" | "uncertain" | null;
  title?: string | null;
  summary?: string | null;
  repair_summary?: string | null;
  proposal_json?: Record<string, unknown> | null;
  impact_json?: Record<string, unknown> | null;
  requires_user_approval?: boolean | null;
  created_at?: string | null;
};

function objectValue(
  value: unknown
): Record<string, unknown> {
  return value &&
    typeof value === "object" &&
    !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function textValue(...values: unknown[]) {
  for (const value of values) {
    if (
      typeof value === "string" &&
      value.trim()
    ) {
      return value.trim();
    }
  }

  return null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  return value
    .map((item) => {
      if (typeof item === "string") {
        return item.trim();
      }

      const record = objectValue(item);

      return textValue(
        record.title,
        record.label,
        record.summary,
        record.description,
        record.action
      );
    })
    .filter(
      (item): item is string =>
        Boolean(item)
    );
}

function repairDetails(repair: RepairRecord) {
  const proposal = objectValue(
    repair.proposal_json
  );

  const impact = objectValue(
    repair.impact_json
  );

  const title =
    textValue(
      repair.title,
      proposal.title,
      proposal.repairTitle
    ) || "Suggested trip repair";

  const summary =
    textValue(
      repair.repair_summary,
      repair.summary,
      proposal.summary,
      proposal.repairSummary
    ) ||
    "Roamly prepared an itinerary adjustment based on a recent travel change.";

  const affectedPlans = [
    ...stringList(
      impact.affectedItems
    ),
    ...stringList(
      impact.affected_items
    ),
    ...stringList(
      proposal.affectedItems
    ),
    ...stringList(
      proposal.affected_items
    )
  ].slice(0, 6);

  const actions = [
    ...stringList(
      proposal.actions
    ),
    ...stringList(
      proposal.changes
    ),
    ...stringList(
      proposal.proposedActions
    ),
    ...stringList(
      proposal.proposed_actions
    )
  ].slice(0, 6);

  return {
    title,
    summary,
    affectedPlans,
    actions
  };
}

function statusLabel(status?: string | null) {
  switch ((status || "").toLowerCase()) {
    case "applied":
    case "completed":
      return "Repair applied";
    case "approved":
      return "Approved";
    case "rejected":
      return "Original plan kept";
    case "failed":
      return "Repair failed";
    case "partially_applied":
      return "Partially applied";
    default:
      return "Approval required";
  }
}

function verificationLabel(repair: RepairRecord) {
  if (repair.verification_status === "resolved") return "Verified resolved";
  if (repair.verification_status === "still_affected") return "Still affected";
  if (repair.verification_status === "uncertain") return "Verification incomplete";
  if (repair.status === "applied") return "Applied — verifying current itinerary";
  return statusLabel(repair.status);
}

function statusTone(status?: string | null, verificationStatus?: RepairRecord["verification_status"]): BuiTone {
  if (verificationStatus === "uncertain" || verificationStatus === "still_affected" || (status === "applied" && verificationStatus === "pending")) {
    return "warm";
  }
  if (verificationStatus === "resolved") return "success";
  const value = (status || "").toLowerCase();

  if (
    ["applied", "completed", "approved"].includes(
      value
    )
  ) {
    return "success";
  }

  if (value === "rejected") {
    return "neutral";
  }

  if (
    ["failed", "partially_applied"].includes(
      value
    )
  ) {
    return "danger";
  }

  return "warm";
}

function actionable(status?: string | null) {
  return ![
    "applied",
    "completed",
    "approved",
    "rejected",
    "failed"
  ].includes((status || "").toLowerCase());
}

export default function CompanionRepairCenter({
  tripId
}: {
  tripId: string;
}) {
  const [repairs, setRepairs] = useState<
    RepairRecord[]
  >([]);

  const [busy, setBusy] = useState<
    string | null
  >(null);

  const [error, setError] = useState("");

  const loadRepairs = useCallback(async () => {
    setError("");

    const response = await fetch(
      `/api/trips/${tripId}/companion/repairs`,
      {
        cache: "no-store"
      }
    );

    const payload = await response.json();

    if (!response.ok || !payload.ok) {
      setError(
        payload.error ||
          "Companion repairs could not be loaded."
      );
      return;
    }

    setRepairs(payload.repairs || []);
  }, [tripId]);

  useEffect(() => {
    void loadRepairs();
  }, [loadRepairs]);

  async function runAction(
    repairId: string,
    action: "approve" | "reject"
  ) {
    setBusy(`${action}:${repairId}`);
    setError("");

    try {
      const response = await fetch(
        `/api/trips/${tripId}/companion/repairs/${repairId}/${action}`,
        {
          method: "POST"
        }
      );

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(
          payload.error ||
            `The repair could not be ${action === "approve" ? "approved" : "rejected"}.`
        );
        return;
      }

      await loadRepairs();
      // Re-fetch the server-rendered Live Companion bundle from canonical truth.
      window.location.reload();
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="bui-enter rounded-bui-panel border border-chair bg-white p-5 shadow-bui-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">
            Trip repairs
          </p>

          <h2 className="mt-2 text-2xl font-black text-chead">
            Companion disruption center
          </h2>

          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-cink">
            Review changes affecting your trip and approve only
            itinerary-safe repairs. Roamly will not purchase,
            cancel, refund, or pay for external services here.
          </p>
        </div>

        <BuiButton type="button" variant="secondary" size="small" onClick={() => void loadRepairs()}>
          Refresh
        </BuiButton>
      </div>

      {error ? <BuiNotice tone="error" title={error} className="mt-4" /> : null}

      <div className="mt-5 grid gap-4">
        {repairs.map((repair, repairIndex) => {
          const details =
            repairDetails(repair);

          const canAct =
            actionable(repair.status);

          return (
            <article
              key={repair.id}
              className="bui-enter rounded-bui-card border border-chair bg-cbg p-4"
              style={{ "--bui-delay": `${Math.min(repairIndex * 60, 240)}ms` } as CSSProperties}
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <BuiChip tone={statusTone(repair.status, repair.verification_status)}>
                    {verificationLabel(repair)}
                  </BuiChip>

                  <h3 className="mt-3 text-lg font-black text-chead">
                    {details.title}
                  </h3>

                  <p className="mt-2 text-sm font-bold leading-6 text-cink">
                    {details.summary}
                  </p>
                  {repair.operation === "REMOVE_OPTIONAL_ACTIVITY" ? (
                    <p className="mt-2 text-sm font-black text-chead">
                      Approval removes this one conflicting optional activity from the itinerary. It does not rebook, cancel, refund, or purchase anything.
                    </p>
                  ) : null}
                </div>

                {repair.created_at ? (
                  <p className="shrink-0 text-xs font-bold text-cgray2">
                    {new Date(
                      repair.created_at
                    ).toLocaleString()}
                  </p>
                ) : null}
              </div>

              {details.affectedPlans.length ? (
                <div className="mt-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-cgray2">
                    Affected plans
                  </p>

                  <div className="mt-2 grid gap-2">
                    {details.affectedPlans.map(
                      (item) => (
                        <p
                          key={item}
                          className="rounded-xl border border-chair bg-white px-3 py-2 text-sm font-bold text-cink"
                        >
                          {item}
                        </p>
                      )
                    )}
                  </div>
                </div>
              ) : null}

              {details.actions.length ? (
                <div className="mt-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-cgray2">
                    Suggested repair
                  </p>

                  <div className="mt-2 grid gap-2">
                    {details.actions.map(
                      (item) => (
                        <p
                          key={item}
                          className="rounded-xl border border-chair bg-white px-3 py-2 text-sm font-bold text-cink"
                        >
                          {item}
                        </p>
                      )
                    )}
                  </div>
                </div>
              ) : null}

              {canAct ? (
                <div className="mt-5 flex flex-wrap gap-3">
                  <BuiButton
                    type="button"
                    disabled={busy !== null}
                    busy={busy === `approve:${repair.id}`}
                    onClick={() =>
                      void runAction(
                        repair.id,
                        "approve"
                      )
                    }
                  >
                    {busy ===
                    `approve:${repair.id}`
                      ? "Applying…"
                      : "Approve repair"}
                  </BuiButton>

                  <BuiButton
                    type="button"
                    variant="secondary"
                    disabled={busy !== null}
                    busy={busy === `reject:${repair.id}`}
                    onClick={() =>
                      void runAction(
                        repair.id,
                        "reject"
                      )
                    }
                  >
                    {busy ===
                    `reject:${repair.id}`
                      ? "Keeping plan…"
                      : "Keep original plan"}
                  </BuiButton>
                </div>
              ) : null}
            </article>
          );
        })}

        {!repairs.length ? (
          <BuiCard className="p-4">
            <p className="text-sm font-black text-cgray">
              No Companion repairs are waiting for you.
            </p>
          </BuiCard>
        ) : null}
      </div>
    </section>
  );
}
