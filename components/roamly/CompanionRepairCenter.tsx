"use client";

import { useCallback, useEffect, useState } from "react";

type RepairRecord = {
  id: string;
  status?: string | null;
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

function statusClass(status?: string | null) {
  const value = (status || "").toLowerCase();

  if (
    ["applied", "completed", "approved"].includes(
      value
    )
  ) {
    return "bg-emerald-100 text-emerald-800";
  }

  if (value === "rejected") {
    return "bg-slate-100 text-slate-700";
  }

  if (
    ["failed", "partially_applied"].includes(
      value
    )
  ) {
    return "bg-coral/10 text-coral";
  }

  return "bg-amber-100 text-amber-800";
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
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            Trip repairs
          </p>

          <h2 className="mt-2 text-2xl font-black text-ink">
            Companion disruption center
          </h2>

          <p className="mt-2 max-w-3xl text-sm font-bold leading-6 text-slate-600">
            Review changes affecting your trip and approve only
            itinerary-safe repairs. Roamly will not purchase,
            cancel, refund, or pay for external services here.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadRepairs()}
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
        {repairs.map((repair) => {
          const details =
            repairDetails(repair);

          const canAct =
            actionable(repair.status);

          return (
            <article
              key={repair.id}
              className="rounded-2xl bg-mist p-4"
            >
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <span
                    className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${statusClass(
                      repair.status
                    )}`}
                  >
                    {statusLabel(
                      repair.status
                    )}
                  </span>

                  <h3 className="mt-3 text-lg font-black text-ink">
                    {details.title}
                  </h3>

                  <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                    {details.summary}
                  </p>
                </div>

                {repair.created_at ? (
                  <p className="shrink-0 text-xs font-bold text-slate-400">
                    {new Date(
                      repair.created_at
                    ).toLocaleString()}
                  </p>
                ) : null}
              </div>

              {details.affectedPlans.length ? (
                <div className="mt-4">
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                    Affected plans
                  </p>

                  <div className="mt-2 grid gap-2">
                    {details.affectedPlans.map(
                      (item) => (
                        <p
                          key={item}
                          className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-600"
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
                  <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">
                    Suggested repair
                  </p>

                  <div className="mt-2 grid gap-2">
                    {details.actions.map(
                      (item) => (
                        <p
                          key={item}
                          className="rounded-xl bg-white px-3 py-2 text-sm font-bold text-slate-600"
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
                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void runAction(
                        repair.id,
                        "approve"
                      )
                    }
                    className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 disabled:opacity-50"
                  >
                    {busy ===
                    `approve:${repair.id}`
                      ? "Applying…"
                      : "Approve repair"}
                  </button>

                  <button
                    type="button"
                    disabled={busy !== null}
                    onClick={() =>
                      void runAction(
                        repair.id,
                        "reject"
                      )
                    }
                    className="rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink ring-1 ring-cloud disabled:opacity-50"
                  >
                    {busy ===
                    `reject:${repair.id}`
                      ? "Keeping plan…"
                      : "Keep original plan"}
                  </button>
                </div>
              ) : null}
            </article>
          );
        })}

        {!repairs.length ? (
          <p className="rounded-2xl bg-mist px-4 py-4 text-sm font-black text-slate-500">
            No Companion repairs are waiting for you.
          </p>
        ) : null}
      </div>
    </section>
  );
}
