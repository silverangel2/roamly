"use client";

import { useState } from "react";

type Props = { tripId: string; dayId: string; itemId: string; title: string };
type Candidate = { candidateId: string; title: string; description: string; date?: string; startTime?: string; endTime?: string; price: number | null; currency?: string | null; priceStatus: string; fitReason: string; source?: string; provider?: string };

export default function CustomerActivityReplacement({ tripId, dayId, itemId, title }: Props) {
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function discover() {
    setBusy(true); setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/customer-itinerary-edits?dayId=${encodeURIComponent(dayId)}&targetItemId=${encodeURIComponent(itemId)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Replacement options are unavailable.");
      setCandidates(Array.isArray(body.candidates) ? body.candidates : []);
      if (!body.candidates?.length) setMessage("No current grounded alternative fits this time and schedule.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Replacement options are unavailable."); }
    finally { setBusy(false); }
  }

  async function apply() {
    if (!selected) return;
    setBusy(true); setMessage("");
    try {
      const create = await fetch(`/api/trips/${tripId}/customer-itinerary-edits`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ operation: "REPLACE_OPTIONAL_ACTIVITY", dayId, targetItemId: itemId, candidateId: selected.candidateId }) });
      const created = await create.json();
      if (!create.ok || !created.edit) throw new Error(created.error || "This replacement is no longer current.");
      const applied = await fetch(`/api/trips/${tripId}/customer-itinerary-edits/${created.edit.id}/replace`, { method: "POST" });
      const result = await applied.json();
      if (!applied.ok) throw new Error(result.error || "The replacement could not be applied.");
      window.location.reload();
    } catch (error) { setMessage(error instanceof Error ? error.message : "The replacement could not be applied."); }
    finally { setBusy(false); }
  }

  return <div className="roamly-no-print mt-2">
    {!open ? <button type="button" onClick={() => { setOpen(true); void discover(); }} className="text-xs font-black text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-ocean">Find a replacement</button> :
      <div className="max-w-xl rounded-xl border border-[#e8dfd0] bg-[#fffdf8] px-3 py-3 text-sm">
        <p className="font-black text-ink">Replace “{title}”?</p>
        {!selected ? <div className="mt-2 grid gap-2">{candidates.map((candidate) => <button key={candidate.candidateId} type="button" onClick={() => setSelected(candidate)} className="rounded-lg border border-slate-200 px-3 py-2 text-left hover:border-ocean"><span className="font-black">{candidate.title}</span><span className="block text-xs font-semibold text-slate-600">{candidate.startTime && candidate.endTime ? `${candidate.startTime}–${candidate.endTime} · ` : ""}{candidate.priceStatus === "unknown" ? "Price unknown" : candidate.price != null ? `${candidate.price} ${candidate.currency || ""}` : "Price unknown"} · {candidate.fitReason}</span></button>)}</div> : <><p className="mt-1 text-xs font-semibold leading-5 text-slate-600">Replace “{title}” with “{selected.title}”? This leaves the existing time slot and does not cancel a booking or move other activities.</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={apply} disabled={busy} className="min-h-10 rounded-full bg-ocean px-4 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? "Replacing…" : "Replace activity"}</button><button type="button" onClick={() => setSelected(null)} disabled={busy} className="min-h-10 rounded-full border border-slate-300 px-4 py-2 text-xs font-black text-slate-700">Choose another</button></div></>}
        {busy && !selected ? <p className="mt-2 text-xs font-bold text-slate-500">Checking current grounded options…</p> : null}{message ? <p className="mt-2 text-xs font-bold text-amber-800" aria-live="polite">{message}</p> : null}<button type="button" onClick={() => { setOpen(false); setSelected(null); }} className="mt-2 text-xs font-black text-slate-500 underline">Cancel</button>
      </div>}
  </div>;
}
