"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Pencil } from "lucide-react";
import { BuiButton } from "@/components/boardui/Button";
import { useI18n } from "@/components/i18n/I18nProvider";

/*
 * TripRenameControl (consolidation 2026-11-06, audit D13): the
 * trip page's rename affordance. Quiet by default — a small
 * "Name this trip" / "Rename" text button under the title; the
 * editor opens inline, saves through POST /api/trips/[id]/rename,
 * and refreshes the server render so the new name shows
 * everywhere the trip is titled (this page + the dashboard,
 * which already prefers trip.title).
 */
export function TripRenameControl({
  tripId,
  currentTitle
}: {
  tripId: string;
  currentTitle: string | null;
}) {
  const router = useRouter();
  const { translateText } = useI18n();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(currentTitle || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/trips/${tripId}/rename`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: value })
      });
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean };
      if (!response.ok || !data.ok) {
        setError(translateText("That name could not be saved. Try again."));
        return;
      }
      setEditing(false);
      router.refresh();
    } catch {
      setError(translateText("That name could not be saved. Try again."));
    } finally {
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => {
          setValue(currentTitle || "");
          setEditing(true);
        }}
        className="bui-touch mt-1 inline-flex min-h-11 items-center gap-1.5 text-[13.5px] font-semibold text-cblue focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
      >
        <Pencil aria-hidden="true" size={14} strokeWidth={2.2} />
        {currentTitle ? translateText("Rename this trip") : translateText("Name this trip")}
      </button>
    );
  }

  return (
    <div className="mt-2 max-w-md">
      <label className="block text-sm font-black text-chead" htmlFor={`rename-${tripId}`}>
        {translateText("Trip name")}
      </label>
      <div className="mt-1 flex gap-2">
        <input
          id={`rename-${tripId}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          maxLength={80}
          autoFocus
          placeholder={translateText("e.g. Mom's 70th in Quebec City")}
          className="bui-input min-w-0 flex-1 rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none focus:border-cblue focus:ring-4 focus:ring-cblue/10"
        />
        <BuiButton busy={busy} onClick={() => void save()} className="shrink-0">
          {busy ? translateText("Saving…") : translateText("Save")}
        </BuiButton>
        <BuiButton variant="ghost" disabled={busy} onClick={() => setEditing(false)} className="shrink-0">
          {translateText("Cancel")}
        </BuiButton>
      </div>
      {error ? (
        <p role="alert" className="mt-1.5 text-[13px] font-medium text-coral">
          {error}
        </p>
      ) : null}
    </div>
  );
}
