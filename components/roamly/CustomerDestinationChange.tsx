"use client";

import { useState } from "react";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
import { PackageChangeForm, PackageChangeRow, packagePrimaryClass, packageQuietClass } from "@/components/roamly/packageChangeChrome";
import type { NormalizedPlace } from "@/lib/roamly/places";

type Props = { tripId: string; currentLabel: string; status: string };
type Proposal = { id: string; requested_destination_snapshot?: { city?: string; country?: string; value?: string }; result?: { note?: string; refreshes?: string[] } };

export default function CustomerDestinationChange({ tripId, currentLabel, status }: Props) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<NormalizedPlace | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  if (!["generated", "locked", "planned"].includes(status)) return null;

  async function preview() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/destination-change`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ destination }) });
      const body = await response.json();
      if (!response.ok || !body.proposal) throw new Error(body.message || body.error || "Destination preview unavailable.");
      setProposal(body.proposal);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destination preview unavailable."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!proposal) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/destination-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Destination change could not be started.");
      window.location.href = `/trip/${body.successorTripId}?generating=1`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destination change could not be started."); }
    finally { setBusy(false); }
  }

  const requested = proposal?.requested_destination_snapshot;

  return (
    <div className="roamly-no-print">
      {!open ? (
        <PackageChangeRow label="Destination" value={currentLabel || "Not set"} actionLabel="Change destination" onOpen={() => setOpen(true)} />
      ) : (
        <PackageChangeForm onCancel={() => { setOpen(false); setProposal(null); setDestination(null); }}>
          <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">Change your destination</p>
          <p className="mt-1 text-sm text-slate-500">Current destination: {currentLabel || "Your trip destination"}</p>
          {!proposal ? (
            <>
              <div className="mt-4">
                <PlaceSelector label="New destination" value={destination} onChange={setDestination} helper="Choose a recognized city or place. Single-destination changes only." />
              </div>
              <button type="button" onClick={preview} disabled={busy || !destination} className={`mt-4 ${packagePrimaryClass}`}>{busy ? "Checking…" : "Preview change"}</button>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-slate-600">New destination: {[requested?.city || requested?.value, requested?.country].filter(Boolean).join(", ")}</p>
              <p className="mt-2 text-sm leading-6 text-slate-600">Your existing bookings will not be changed. Flights, hotels, activities, events, prices, routing, requirements, and connectivity will be freshly evaluated for the new destination. Your original trip stays available until the new itinerary succeeds.</p>
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
