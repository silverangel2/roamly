"use client";

import { useState } from "react";

type AccountProfileFormProps = {
  initialName: string;
  email: string;
};

export function AccountProfileForm({ initialName, email }: AccountProfileFormProps) {
  const [fullName, setFullName] = useState(initialName);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function saveProfile(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
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

      setNotice("Profile saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Profile update failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={saveProfile} className="space-y-4">
      <label className="block">
        <span className="text-sm font-black text-ink">Full name</span>
        <input
          value={fullName}
          onChange={(event) => setFullName(event.target.value)}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          placeholder="Traveler name"
        />
      </label>

      <div className="rounded-2xl bg-mist p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Account email</p>
        <p className="mt-1 break-words text-sm font-black text-ink">{email}</p>
      </div>

      {notice ? <p className="rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      <div className="grid gap-3 sm:flex">
        <button
          type="submit"
          disabled={busy}
          className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
        >
          {busy ? "Saving..." : "Save profile"}
        </button>
        <a
          href="/auth/logout"
          className="inline-flex items-center justify-center rounded-2xl bg-white px-5 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud transition hover:-translate-y-0.5 hover:ring-ocean/30"
        >
          Log out
        </a>
      </div>
    </form>
  );
}
