"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

type Evaluation = {
  id: string;
  label: string;
  role: "account_holder" | "companion";
  travelerType: "adult" | "child" | "infant";
  passportIssuingCountry: string | null;
  persisted: boolean;
  requirements: Array<{ title: string; status: string; summary: string; authority: string | null; actionUrl: string | null }>;
};

export function TripTravelerRequirements({ tripId, evaluations }: { tripId: string; evaluations: Evaluation[] }) {
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>(
    Object.fromEntries(evaluations.filter((item) => item.role === "companion").map((item) => [item.id, item.passportIssuingCountry || ""]))
  );
  const [saving, setSaving] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function save(item: Evaluation) {
    if (!item.persisted) return;
    const value = values[item.id] || "";
    setSaving(item.id);
    setMessage("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/travelers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(value ? { action: "update", travelerId: item.id, passportIssuingCountry: value } : { action: "clear", travelerId: item.id })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        setError(result.error || "We could not save this traveler detail.");
        return;
      }
      setMessage(`${item.label} details saved.`);
      router.refresh();
    } finally {
      setSaving(null);
    }
  }

  async function prepareCompanionSlots() {
    setSyncing(true);
    setError("");
    try {
      const response = await fetchWithSupabaseAuth(`/api/trips/${tripId}/travelers`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "sync" })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok === false) {
        setError(result.error || "We could not prepare traveler details.");
        return;
      }
      router.refresh();
    } finally {
      setSyncing(false);
    }
  }

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {evaluations.map((item) => (
        <div key={item.id} className="rounded-2xl border border-[#e8dfd0] bg-white p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-sm font-black text-ink">{item.label}</p>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.12em] text-slate-500">{item.travelerType}</p>
            </div>
            <span className="text-xs font-black uppercase tracking-[0.12em] text-sun">
              {item.requirements.some((requirement) => requirement.status === "UNKNOWN") ? "Needs information" : "Review required"}
            </span>
          </div>
          {item.role === "companion" ? (
            item.persisted ? <div className="mt-3 grid gap-2">
              <label className="text-sm font-bold text-slate-700" htmlFor={`passport-${item.id}`}>Passport issuing country</label>
              <div className="flex gap-2">
                <input
                  id={`passport-${item.id}`}
                  value={values[item.id] || ""}
                  onChange={(event) => setValues((current) => ({ ...current, [item.id]: event.target.value }))}
                  placeholder="e.g. CA"
                  maxLength={60}
                  className="min-h-11 min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm font-bold text-ink"
                />
                <button type="button" disabled={saving === item.id} onClick={() => save(item)} className="min-h-11 rounded-xl bg-ocean px-3 py-2 text-sm font-black text-white disabled:opacity-60">
                  {saving === item.id ? "Saving" : "Save"}
                </button>
              </div>
              <p className="text-xs font-semibold leading-5 text-slate-500">This helps Roamly review this traveler independently. It does not prove visa approval or entry clearance.</p>
            </div> : <div className="mt-3 grid gap-2">
              <p className="text-sm font-semibold leading-6 text-slate-600">Add this traveler’s details to review requirements independently.</p>
              <button type="button" disabled={syncing} onClick={prepareCompanionSlots} className="min-h-11 w-fit rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white disabled:opacity-60">
                {syncing ? "Preparing" : "Add traveler details"}
              </button>
            </div>
          ) : (
            <div className="mt-3 grid gap-2">
              <p className="text-sm font-semibold leading-6 text-slate-600">Requirements use the passport country saved in your account traveler memory.</p>
              {!item.passportIssuingCountry ? <a className="inline-flex min-h-11 w-fit items-center rounded-xl bg-ocean px-4 py-2 text-sm font-black text-white" href={`/account?return=${encodeURIComponent(`/trip/${tripId}?focus=requirements#requirements`)}#traveler-memory`}>Add your passport country</a> : null}
            </div>
          )}
          {item.requirements.map((requirement) => (
            <div key={requirement.title} className="mt-3 border-t border-slate-100 pt-3">
              <p className="text-sm font-black text-ink">{requirement.title}</p>
              <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">{requirement.summary}</p>
              {requirement.actionUrl ? <a className="mt-2 inline-block text-sm font-black text-ocean underline" href={requirement.actionUrl} target="_blank" rel="noreferrer">Official source</a> : null}
            </div>
          ))}
        </div>
      ))}
      {message ? <p className="text-sm font-bold text-ocean md:col-span-2" role="status">{message}</p> : null}
      {error ? <p className="text-sm font-bold text-coral md:col-span-2" role="alert">{error}</p> : null}
    </div>
  );
}
