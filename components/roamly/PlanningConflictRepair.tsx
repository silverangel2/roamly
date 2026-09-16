"use client";

import { useState } from "react";

type Props = {
  tripId: string;
  conflictId: string;
  dayId: string;
  targetItemId: string;
  targetTitle: string;
  protectedTitles: string[];
};

type Proposal = {
  id: string;
  preview_json?: { change?: string; protected?: string[]; result?: string };
};

export default function PlanningConflictRepair(props: Props) {
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function review() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/trips/${props.tripId}/planning-repairs`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conflictId: props.conflictId, targetItemId: props.targetItemId })
      });
      const body = await response.json();
      if (!response.ok || !body.proposal) throw new Error("This conflict could not be prepared for review.");
      setProposal(body.proposal);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This conflict could not be prepared for review.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/trips/${props.tripId}/planning-repairs/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The approved change could not be applied.");
      setMessage(body.result === "APPLIED_RESOLVED" ? "Schedule conflict resolved." : body.result === "APPLIED_STILL_INFEASIBLE" ? "The activity was removed, but this part of the schedule still needs attention." : body.result === "APPLIED_UNCERTAIN" ? "The change was applied, but Roamly cannot yet verify this transition." : "The change was applied. Reload the trip to check the latest schedule.");
      setProposal(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The approved change could not be applied.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="mt-5 border-l-2 border-amber-500 bg-amber-50/70 px-4 py-4" aria-live="polite">
      <p className="text-xs font-black uppercase tracking-[0.14em] text-amber-800">Schedule conflict</p>
      <p className="mt-2 text-sm font-semibold leading-6 text-slate-700">
        {props.targetTitle} is the flexible item Roamly can review without changing the protected parts of this day.
      </p>
      {proposal ? (
        <div className="mt-3 grid gap-2 text-sm text-slate-700">
          <p className="font-black">Review change: remove {props.targetTitle}</p>
          {props.protectedTitles.length ? <p>Protected: {props.protectedTitles.join(" · ")}</p> : null}
          <p className="text-xs font-semibold text-slate-500">The result will be checked after the update; no route or booking evidence is being invented.</p>
          <div className="mt-2 flex flex-wrap gap-3">
            <button type="button" onClick={apply} disabled={busy} className="min-h-11 rounded-full bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-60">{busy ? "Applying…" : "Apply change"}</button>
            <button type="button" onClick={() => setProposal(null)} disabled={busy} className="min-h-11 rounded-full border border-slate-300 px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60">Keep as-is</button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={review} disabled={busy} className="mt-3 min-h-11 rounded-full border border-amber-700 px-4 py-2 text-sm font-black text-amber-900 disabled:opacity-60">{busy ? "Preparing review…" : "Review safe change"}</button>
      )}
      {message ? <p className="mt-3 text-sm font-bold text-slate-700">{message}</p> : null}
    </aside>
  );
}
