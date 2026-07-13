"use client";

import { useState } from "react";
import { fetchWithSupabaseAuth } from "@/lib/roamly/authenticatedFetch";

export function SeoGenerationPanel({ contentTypes }: { contentTypes: string[] }) {
  const [contentType, setContentType] = useState(contentTypes[0] || "Destination guides");
  const [topic, setTopic] = useState("");
  const [queueSocialPost, setQueueSocialPost] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function generate() {
    setBusy(true);
    setNotice("");
    setError("");
    try {
      const response = await fetchWithSupabaseAuth("/api/admin/roamly/seo/generate", {
        method: "POST",
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType, topic, queueSocialPost })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "SEO page generation failed.");
      setNotice(`Published /guides/${data.draft.slug}${data.social?.ok ? " and queued a Facebook post." : "."}`);
      window.setTimeout(() => window.location.reload(), 900);
    } catch (err) {
      setError(err instanceof Error ? err.message : "SEO page generation failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-2xl border border-cloud bg-white/92 p-4 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">One-click SEO generation</p>
      <div className="mt-4 grid gap-4 md:grid-cols-[0.7fr_1fr]">
        <label className="block">
          <span className="text-sm font-black text-ink">Page type</span>
          <select
            value={contentType}
            onChange={(event) => setContentType(event.target.value)}
            className="mt-2 w-full rounded-xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
          >
            {contentTypes.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-black text-ink">Topic</span>
          <input
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="Optional, for example: Lisbon weekend guide"
            className="mt-2 w-full rounded-xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none focus:border-ocean"
          />
        </label>
      </div>
      <label className="mt-4 flex items-center gap-3 rounded-xl bg-mist px-4 py-3 text-sm font-bold text-slate-700">
        <input type="checkbox" checked={queueSocialPost} onChange={(event) => setQueueSocialPost(event.target.checked)} />
        Add a Facebook post for this page to the autopost queue
      </label>
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="mt-4 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft disabled:bg-slate-300"
      >
        {busy ? "Generating..." : "Generate SEO page"}
      </button>
      {notice ? <p className="mt-4 rounded-xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="mt-4 rounded-xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </section>
  );
}
