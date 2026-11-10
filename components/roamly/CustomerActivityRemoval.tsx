"use client";

import { useState } from "react";
import { BuiCard } from "@/components/boardui/Card";
import { BuiButton } from "@/components/boardui/Button";

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
        <button type="button" onClick={() => setOpen(true)} className="bui-press text-xs font-black text-cgray underline decoration-chair underline-offset-4 hover:text-cblue">Remove from itinerary</button>
      ) : (
        <BuiCard className="max-w-xl px-3 py-3 text-sm">
          <p className="font-black text-ink">Remove “{title}” from this day?</p>
          <p className="mt-1 text-xs font-semibold leading-5 text-cgray">It will leave that time free and update affected trip checks. It will not cancel an external booking, issue a refund, or move other activities.</p>
          {edit ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <BuiButton onClick={apply} busy={busy}>{busy ? "Removing…" : "Confirm removal"}</BuiButton>
              <BuiButton variant="secondary" onClick={() => { setEdit(null); setOpen(false); }} disabled={busy}>Keep activity</BuiButton>
            </div>
          ) : (
            <BuiButton onClick={prepare} busy={busy} className="mt-3">{busy ? "Checking…" : "Review removal"}</BuiButton>
          )}
          {message ? <p className="mt-2 text-xs font-bold text-amber-800" aria-live="polite">{message}</p> : null}
        </BuiCard>
      )}
    </div>
  );
}
