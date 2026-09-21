"use client";

import { useState } from "react";
import { PlaceSelector } from "@/components/roamly/PlaceSelector";
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
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destination preview unavailable."); } finally { setBusy(false); }
  }
  async function apply() {
    if (!proposal) return;
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/destination-change/${proposal.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Destination change could not be started.");
      window.location.href = `/trip/${body.successorTripId}?generating=1`;
    } catch (error) { setMessage(error instanceof Error ? error.message : "Destination change could not be started."); } finally { setBusy(false); }
  }
  const requested = proposal?.requested_destination_snapshot;
  return <div className="roamly-no-print mt-4">{!open ? <button type="button" onClick={() => setOpen(true)} className="min-h-10 rounded-full border border-ocean/30 px-4 py-2 text-xs font-black text-ocean hover:bg-ocean/5">Change destination</button> : <div className="max-w-xl rounded-xl border border-[#e8dfd0] bg-[#fffdf8] px-4 py-4"><p className="font-black text-ink">Change your destination</p><p className="mt-1 text-sm font-bold text-slate-600">Current destination: {currentLabel || "Your trip destination"}</p>{!proposal ? <><div className="mt-3"><PlaceSelector label="New destination" value={destination} onChange={setDestination} helper="Choose a recognized city or place. Single-destination changes only." /></div><button type="button" onClick={preview} disabled={busy || !destination} className="mt-3 min-h-10 rounded-full bg-ocean px-4 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? "Checking…" : "Preview change"}</button></> : <><p className="mt-2 text-sm font-bold text-slate-700">New destination: {[requested?.city || requested?.value, requested?.country].filter(Boolean).join(", ")}</p><p className="mt-2 text-sm font-semibold leading-6 text-slate-600">Your existing bookings will not be changed. Flights, hotels, activities, events, prices, routing, requirements, and connectivity will be freshly evaluated for the new destination. Your original trip stays available until the new itinerary succeeds.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={apply} disabled={busy} className="min-h-10 rounded-full bg-ocean px-4 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? "Starting…" : "Create new itinerary"}</button><button type="button" onClick={() => setProposal(null)} disabled={busy} className="min-h-10 rounded-full border border-slate-300 px-4 py-2 text-xs font-black text-slate-700">Review again</button></div></>}{message ? <p className="mt-2 text-xs font-bold text-amber-800" aria-live="polite">{message}</p> : null}<button type="button" onClick={() => { setOpen(false); setProposal(null); setDestination(null); }} className="mt-3 text-xs font-black text-slate-500 underline">Cancel</button></div>}</div>;
}
