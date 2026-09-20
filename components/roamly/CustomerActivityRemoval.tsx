"use client";

import { useState } from "react";

type Props = { tripId: string; dayId: string; itemId: string; title: string };

export default function CustomerActivityRemoval({ tripId, dayId, itemId, title }: Props) {
  const [open, setOpen] = useState(false);
  const [edit, setEdit] = useState<{ id: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function prepare() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/customer-itinerary-edits`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ operation: "REMOVE_OPTIONAL_ACTIVITY", dayId, targetItemId: itemId })
      });
      const body = await response.json();
      if (!response.ok || !body.edit) throw new Error(body.error || "This activity cannot be removed safely.");
      setEdit(body.edit);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "This activity cannot be removed safely.");
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    if (!edit) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/trips/${tripId}/customer-itinerary-edits/${edit.id}/apply`, { method: "POST" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "The activity could not be removed.");
      setMessage("Removed from your itinerary. Refreshing the current trip checks…");
      window.location.reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "The activity could not be removed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="roamly-no-print mt-3">
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="text-xs font-black text-slate-500 underline decoration-slate-300 underline-offset-4 hover:text-ocean">Remove from itinerary</button>
      ) : (
        <div className="max-w-xl rounded-xl border border-[#e8dfd0] bg-[#fffdf8] px-3 py-3 text-sm">
          <p className="font-black text-ink">Remove “{title}” from this day?</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-slate-600">It will leave that time free and update affected trip checks. It will not cancel an external booking, issue a refund, or move other activities.</p>
          {edit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" onClick={apply} disabled={busy} className="min-h-10 rounded-full bg-ocean px-4 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? "Removing…" : "Confirm removal"}</button>
              <button type="button" onClick={() => { setEdit(null); setOpen(false); }} disabled={busy} className="min-h-10 rounded-full border border-slate-300 px-4 py-2 text-xs font-black text-slate-700">Keep activity</button>
            </div>
          ) : (
            <button type="button" onClick={prepare} disabled={busy} className="mt-3 min-h-10 rounded-full bg-ocean px-4 py-2 text-xs font-black text-white disabled:opacity-60">{busy ? "Checking…" : "Review removal"}</button>
          )}
          {message ? <p className="mt-2 text-xs font-bold text-amber-800" aria-live="polite">{message}</p> : null}
        </div>
      )}
    </div>
  );
}
