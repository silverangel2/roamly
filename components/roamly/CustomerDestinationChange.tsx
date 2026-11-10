"use client";

import { useState } from "react";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
import { PackageChangeForm, PackageChangeRow } from "@/components/roamly/packageChangeChrome";
import { BuiButton } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";
import type { NormalizedPlace } from "@/lib/roamly/places";

type Props = { tripId: string; currentLabel: string; status: string };
type Proposal = { id: string; requested_destination_snapshot?: { city?: string; country?: string; value?: string }; result?: { note?: string; refreshes?: string[] } };

export default function CustomerDestinationChange({ tripId, currentLabel, status }: Props) {
  const [open, setOpen] = useState(false);
  const [destination, setDestination] = useState<NormalizedPlace | null>(null);
  const [destError, setDestError] = useState("");
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [applied, setApplied] = useState("");
  if (!["generated", "locked", "planned"].includes(status)) return null;

  async function preview() {
    // The preview button is never disabled (form rules: a submit is
    // never a silent refusal) — with no place picked yet it explains
    // itself under the selector instead of sending anything.
    if (!destination) {
      setDestError("Choose a destination first.");
      return;
    }
    setDestError("");
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
    setBusy(true); setMessage(""); setApplied("");
    let navigating = false;
    try {
      const response = await fetch(`/api/trips/${tripId}/destination-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Destination change could not be started.");
      // Success Rules pass (2026-11-03), census row 28: name the
      // applied change before the regeneration handoff.
      navigating = true;
      const snap = proposal.requested_destination_snapshot;
      const label = [snap?.city || snap?.value, snap?.country].filter(Boolean).join(", ");
      setApplied(label ? `Destination changed to ${label}. Creating your new itinerary…` : "Destination changed. Creating your new itinerary…");
      window.setTimeout(() => { window.location.href = `/trip/${body.successorTripId}?generating=1`; }, 1200);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destination change could not be started."); }
    finally { if (!navigating) setBusy(false); }
  }

  const requested = proposal?.requested_destination_snapshot;

  return (
    <div className="roamly-no-print">
      {!open ? (
        <PackageChangeRow label="Destination" value={currentLabel || "Not set"} actionLabel="Change destination" onOpen={() => setOpen(true)} />
      ) : (
        <PackageChangeForm onCancel={() => { setOpen(false); setProposal(null); setDestination(null); }}>
          <p className="text-[0.9375rem] font-semibold tracking-tight text-ink">Change your destination</p>
          <p className="mt-1 text-sm text-cgray">Current destination: {currentLabel || "Your trip destination"}</p>
          {!proposal ? (
            <>
              <div className="mt-4">
                <PlaceSelector label="New destination" value={destination} onChange={(place) => { setDestination(place); setDestError(""); }} helper="Choose a recognized city or place. Single-destination changes only." />
                {destError ? <p role="alert" className="mt-2 text-sm font-bold leading-5 text-cred">{destError}</p> : null}
              </div>
              <BuiButton onClick={preview} busy={busy} className="mt-4">{busy ? "Checking…" : "Preview change"}</BuiButton>
            </>
          ) : (
            <>
              <p className="mt-3 text-sm text-cgray">New destination: {[requested?.city || requested?.value, requested?.country].filter(Boolean).join(", ")}</p>
              <p className="mt-2 text-sm leading-6 text-cgray">Your existing bookings will not be changed. Flights, hotels, activities, events, prices, routing, requirements, and connectivity will be freshly evaluated for the new destination. Your original trip stays available until the new itinerary succeeds.</p>
              <div className="mt-4 flex flex-wrap items-center gap-1">
                <BuiButton onClick={apply} busy={busy}>{busy ? "Starting…" : "Create new itinerary"}</BuiButton>
                <BuiButton variant="ghost" onClick={() => setProposal(null)} disabled={busy}>Review again</BuiButton>
              </div>
            </>
          )}
          {message ? <BuiNotice tone="error" title={message} className="mt-3" /> : null}
          {applied ? <BuiNotice tone="success" title={applied} className="mt-3" /> : null}
        </PackageChangeForm>
      )}
    </div>
  );
}
