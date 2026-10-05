"use client";

import { useState } from "react";
import { PackageChangeForm, PackageChangeRow, packageFieldClass, packageLabelClass, packagePrimaryClass, packageQuietClass } from "@/components/roamly/packageChangeChrome";

type Props = { tripId: string; startDate: string | null; endDate: string | null; status: string };
type Proposal = { id: string; requested_start_date: string; requested_end_date: string; result: { note?: string; refreshes?: string[] } };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function shortTripDate(value: string | null) {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value || "");
  if (!match) return "";
  const month = MONTHS[Number(match[2]) - 1];
  if (!month) return "";
  return `${month} ${Number(match[3])}`;
}

function dateRangeLabel(start: string | null, end: string | null) {
  const startLabel = shortTripDate(start);
  const endLabel = shortTripDate(end);
  if (startLabel && endLabel) return `${startLabel} – ${endLabel}`;
  return startLabel || endLabel || "Not set";
}

export default function CustomerDateChange({ tripId, startDate, endDate, status }: Props) {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState(startDate || "");
  const [end, setEnd] = useState(endDate || "");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!["generated", "locked", "planned"].includes(status)) return null;

  async function preview() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/date-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ startDate: start, endDate: end }) });
      const body = await response.json();
      if (!response.ok || !body.proposal) throw new Error(body.message || body.error || "Date preview unavailable.");
      setProposal(body.proposal);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Date preview unavailable."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/date-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Date change could not be started.");
      window.location.href = `/trip/${body.successorTripId}?generating=1`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Date change could not be started."); }
    finally { setBusy(false); }
  }

  return (
    <div className="roamly-no-print">
      {!open ? (
        <PackageChangeRow label="Dates" value={dateRangeLabel(startDate, endDate)} actionLabel="Change dates" onOpen={() => setOpen(true)} />
      ) : (
        <PackageChangeForm onCancel={() => { setOpen(false); setProposal(null); }}>
          <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">Change your trip dates</p>
          {!proposal ? (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className={packageLabelClass}>
                  Start
                  <input type="date" value={start} onChange={(event) => setStart(event.target.value)} className={packageFieldClass} />
                </label>
                <label className={packageLabelClass}>
                  End
                  <input type="date" value={end} onChange={(event) => setEnd(event.target.value)} className={packageFieldClass} />
                </label>
              </div>
              <button type="button" onClick={preview} disabled={busy} className={`mt-4 ${packagePrimaryClass}`}>{busy ? "Checking…" : "Preview change"}</button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-slate-600">New dates: {proposal.requested_start_date} to {proposal.requested_end_date}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Your existing bookings will not be changed. Flights, hotels, activities, events, prices, and routing will be refreshed for the new dates.</p>
              <div className="mt-4 flex flex-wrap items-center gap-1">
                <button type="button" onClick={apply} disabled={busy} className={packagePrimaryClass}>{busy ? "Starting…" : "Create new itinerary"}</button>
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
