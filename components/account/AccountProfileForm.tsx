"use client";

import { useState } from "react";
import { BuiToast, useBuiToast } from "@/components/boardui/Toast";
import { clearPlannerDraftOnLogout } from "@/lib/roamly/planDraftStorage";

type AccountProfileFormProps = {
  initialName: string;
  email: string;
};

export function AccountProfileForm({ initialName, email }: AccountProfileFormProps) {
  const [fullName, setFullName] = useState(initialName);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const { toast, showToast, clearToast } = useBuiToast();

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);

    try {
      const response = await fetch("/api/account/profile", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Profile update failed.");
      }

      // Success Rules pass (2026-11-03), rule 3: a saved profile is
      // the lowest-stakes success there is — a toast that leaves in
      // ~4s, not a banner that sits above the buttons forever. The
      // error below keeps its reserved slot: errors stay until fixed.
      showToast("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form
        id="account-logout-form"
        action="/auth/logout"
        method="post"
        onSubmit={() => clearPlannerDraftOnLogout(window.localStorage, window.sessionStorage)}
      />
      <form onSubmit={saveProfile} className="space-y-4">
        <label className="block">
          <span className="text-sm font-black text-ink">Full name</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            aria-label="Full name"
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          />
        </label>

        <div className="rounded-2xl bg-mist p-4">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Account email</p>
          <p className="mt-1 break-words text-sm font-black text-ink">{email}</p>
        </div>

        {/* Form Rules pass (2026-11-03), rule 3: the error slot is
            always rendered at a reserved height, so an error
            appearing can no longer push the Save / Log out row down.
            It carries errors only now — the success toast (below)
            needs no reserved space because it overlays, not inserts. */}
        <div aria-live="polite" className="min-h-[3.25rem]">
          {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
        </div>

        <div className="grid gap-3 sm:flex">
          <button
            type="submit"
            disabled={busy}
            className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
          >
            {busy ? "Saving..." : "Save profile"}
          </button>
          <button
            type="submit"
            form="account-logout-form"
            className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud transition hover:-translate-y-0.5 hover:ring-ocean/30"
          >
            Log out
          </button>
        </div>
      </form>
      {toast ? (
        <BuiToast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={clearToast} />
      ) : null}
    </>
  );
}
