"use client";

import { useState } from "react";
import { PackageChangeForm, PackageChangeRow, packageFieldClass, packageLabelClass, packagePrimaryClass, packageQuietClass } from "@/components/roamly/packageChangeChrome";

type Props = { tripId: string; currentAmount: number | null; currency: string };
type Proposal = { id: string; requested_budget_amount: number; requested_budget_currency: string; preview_snapshot: { totalEstimateAmount: number | null; committedAmount: number | null; committedStatus: string; remainingBudgetAmount: number | null; budgetStatus: string; uncertainty: string[]; flexibleItems: Array<{ dayId: string; itemId: string; title: string; estimatedCost: number | null }> } };

function budgetValue(amount: number | null, currency: string) {
  if (amount == null || !Number.isFinite(Number(amount))) return "Not set";
  return `${currency} ${Number(amount).toLocaleString("en-CA")}`;
}

export default function CustomerBudgetChange({ tripId, currentAmount, currency }: Props) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(currentAmount == null ? "" : String(currentAmount));
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function preview() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/budget-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ amount: value, currency }) });
      const body = await response.json();
      if (!response.ok || !body.proposal) throw new Error(body.error || "Budget preview unavailable.");
      setProposal(body.proposal);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Budget preview unavailable."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/budget-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Budget update could not be applied.");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Budget update could not be applied."); }
    finally { setBusy(false); }
  }

  return (
    <div className="roamly-no-print">
      {!open ? (
        <PackageChangeRow label="Budget" value={budgetValue(currentAmount, currency)} actionLabel="Change budget" onOpen={() => setOpen(true)} />
      ) : (
        <PackageChangeForm onCancel={() => { setOpen(false); setProposal(null); }}>
          <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">Change your trip budget</p>
          {!proposal ? (
            <>
              <label className={`mt-4 block ${packageLabelClass}`}>
                New budget ({currency})
                <input value={value} onChange={(event) => setValue(event.target.value)} inputMode="decimal" className={packageFieldClass} />
              </label>
              <button type="button" onClick={preview} disabled={busy} className={`mt-4 ${packagePrimaryClass}`}>{busy ? "Checking…" : "Preview change"}</button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-slate-600">New budget: {currency} {proposal.requested_budget_amount.toLocaleString("en-CA")}</p>
              <p className="mt-1 text-sm text-slate-600">Known or estimated trip cost: {proposal.preview_snapshot.totalEstimateAmount == null ? "Unknown" : `${currency} ${proposal.preview_snapshot.totalEstimateAmount.toLocaleString("en-CA")}`}</p>
              <p className="mt-2 text-sm font-medium text-ink">{proposal.preview_snapshot.budgetStatus === "over_budget" ? "Over budget" : proposal.preview_snapshot.budgetStatus === "unknown" ? "Budget still uncertain" : "Within the new budget"}</p>
              {proposal.preview_snapshot.committedAmount != null ? <p className="mt-1 text-sm text-slate-600">Confirmed commitments remain protected: {currency} {proposal.preview_snapshot.committedAmount.toLocaleString("en-CA")}.</p> : null}
              {proposal.preview_snapshot.uncertainty.map((item) => <p key={item} className="mt-1 text-sm text-amber-800">{item}</p>)}
              {proposal.preview_snapshot.flexibleItems.length ? <p className="mt-2 text-sm text-slate-600">Flexible unbooked items that may be reconsidered later: {proposal.preview_snapshot.flexibleItems.map((item) => item.title).join(", ")}.</p> : null}
              <div className="mt-4 flex flex-wrap items-center gap-1">
                <button type="button" onClick={apply} disabled={busy} className={packagePrimaryClass}>{busy ? "Saving…" : "Approve budget change"}</button>
                <button type="button" onClick={() => setProposal(null)} disabled={busy} className={packageQuietClass}>Review again</button>
              </div>
            </>
          )}
          {message ? <p className="mt-3 text-sm text-amber-800" aria-live="polite">{message}</p> : null}
        </PackageChangeForm>
      )}
    </div>
  );
}
