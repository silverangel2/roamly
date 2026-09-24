"use client";

import { useState } from "react";

type Promo = { id: string; enabled: boolean; type: "tracked_link"; eyebrow: string; headline: string; description: string; href: string; placement: "feature" | "secondary"; startsAt?: string; endsAt?: string };

export function FindsPromoControls({ initialPromo, configured }: { initialPromo: Promo; configured: boolean }) {
  const [promo, setPromo] = useState(initialPromo);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const update = (key: keyof Promo, value: string | boolean) => setPromo((current) => ({ ...current, [key]: value }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch("/api/admin/roamly/finds-promo", { method: "POST", credentials: "include", headers: { "content-type": "application/json" }, body: JSON.stringify(promo) });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error || "Promo could not be saved.");
      setPromo(body.promo || promo); setMessage("Finds promo saved.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Promo could not be saved."); }
    finally { setBusy(false); }
  }

  const dateValue = (value?: string) => value ? value.slice(0, 16) : "";
  const dateUpdate = (key: "startsAt" | "endsAt", value: string) => update(key, value ? new Date(value).toISOString() : "");

  return <form onSubmit={save} className="grid gap-5 rounded-2xl border border-cloud bg-white/92 p-5 shadow-soft">
    <div><p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Current Finds promo</p><p className="mt-2 text-sm font-bold leading-6 text-slate-600">Change or pause the single promotional slot without editing the magazine component.</p><p className="mt-2 text-xs font-bold text-slate-400">{configured ? "Loaded from admin settings." : "Using the built-in fallback until you save an admin-managed version."}</p></div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="flex items-center gap-3 sm:col-span-2"><input type="checkbox" checked={promo.enabled} onChange={(event) => update("enabled", event.target.checked)} /><span className="text-sm font-black text-ink">Show this promo</span></label>
      <label><span className="text-sm font-black text-ink">Eyebrow</span><input value={promo.eyebrow} onChange={(event) => update("eyebrow", event.target.value)} maxLength={80} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
      <label><span className="text-sm font-black text-ink">Placement</span><select value={promo.placement} onChange={(event) => update("placement", event.target.value)} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm"><option value="feature">Feature</option><option value="secondary">Secondary</option></select></label>
      <label className="sm:col-span-2"><span className="text-sm font-black text-ink">Headline</span><input value={promo.headline} onChange={(event) => update("headline", event.target.value)} maxLength={160} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
      <label className="sm:col-span-2"><span className="text-sm font-black text-ink">Description</span><textarea value={promo.description} onChange={(event) => update("description", event.target.value)} maxLength={500} rows={3} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
      <label className="sm:col-span-2"><span className="text-sm font-black text-ink">Tracked destination URL</span><input type="url" value={promo.href} onChange={(event) => update("href", event.target.value)} maxLength={2000} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
      <label><span className="text-sm font-black text-ink">Starts at (optional)</span><input type="datetime-local" value={dateValue(promo.startsAt)} onChange={(event) => dateUpdate("startsAt", event.target.value)} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
      <label><span className="text-sm font-black text-ink">Ends at (optional)</span><input type="datetime-local" value={dateValue(promo.endsAt)} onChange={(event) => dateUpdate("endsAt", event.target.value)} className="mt-2 w-full rounded-xl border border-cloud px-3 py-3 text-sm" /></label>
    </div>
    <button type="submit" disabled={busy} className="min-h-12 rounded-full bg-ocean px-6 text-sm font-black text-white disabled:bg-slate-300">{busy ? "Saving…" : "Save Finds promo"}</button>
    {message ? <p className="rounded-xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{message}</p> : null}{error ? <p className="rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
  </form>;
}
