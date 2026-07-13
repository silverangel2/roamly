"use client";

import { useState } from "react";

type GeneratedPost = {
  title: string;
  facebookCaption: string;
  instagramCaption: string;
  tiktokScript: string;
  linkedinPost: string;
  hashtags: string[];
  cta: string;
  affiliateDisclosure: string;
  source: "openai" | "fallback";
};

type SocialDraftComposerProps = {
  contentTypes: readonly string[];
  affiliatePartners: readonly string[];
};

export function SocialDraftComposer({ contentTypes, affiliatePartners }: SocialDraftComposerProps) {
  const [contentType, setContentType] = useState(contentTypes[0] || "Destination inspiration posts");
  const [destination, setDestination] = useState("");
  const [topic, setTopic] = useState("");
  const [mediaUrl, setMediaUrl] = useState("");
  const [scheduledFor, setScheduledFor] = useState("");
  const [selectedPartners, setSelectedPartners] = useState<string[]>([]);
  const [generated, setGenerated] = useState<GeneratedPost | null>(null);
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function togglePartner(partner: string) {
    setSelectedPartners((current) =>
      current.includes(partner) ? current.filter((item) => item !== partner) : [...current, partner]
    );
  }

  async function generate() {
    setBusy("generate");
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/admin/roamly/social/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ contentType, destination, topic, mediaUrl, affiliatePartners: selectedPartners })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Social generation failed.");
      setGenerated(data.generated);
      setNotice(data.generated?.source === "fallback" ? "Draft generated with fallback copy." : "Draft generated.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Social generation failed.");
    } finally {
      setBusy("");
    }
  }

  async function save(status: "draft" | "scheduled") {
    if (!generated) {
      setError("Generate a social post before saving.");
      return;
    }

    setBusy(status);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/admin/roamly/social/drafts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contentType,
          destination,
          topic,
          mediaUrl,
          scheduledFor: status === "scheduled" ? scheduledFor : null,
          affiliatePartners: selectedPartners,
          generated,
          status
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Draft could not be saved.");
      setNotice(status === "scheduled" ? "Post scheduled." : "Draft saved.");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Draft could not be saved.");
    } finally {
      setBusy("");
    }
  }

  async function copyCaption(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice("Caption copied.");
    } catch {
      setError("Copy failed.");
    }
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <section className="rounded-[1.5rem] border border-cloud bg-white/92 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Composer</p>
        <div className="mt-4 grid gap-4">
          <label className="block">
            <span className="text-sm font-black text-ink">Content type</span>
            <select
              value={contentType}
              onChange={(event) => setContentType(event.target.value)}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            >
              {contentTypes.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-black text-ink">Destination</span>
            <input
              value={destination}
              onChange={(event) => setDestination(event.target.value)}
              placeholder="Optional"
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            />
          </label>

          <label className="block">
            <span className="text-sm font-black text-ink">Topic</span>
            <textarea
              value={topic}
              onChange={(event) => setTopic(event.target.value)}
              rows={4}
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold leading-6 outline-none focus:border-ocean"
            />
          </label>

          <label className="block">
            <span className="text-sm font-black text-ink">Media URL</span>
            <input
              value={mediaUrl}
              onChange={(event) => setMediaUrl(event.target.value)}
              placeholder="Optional"
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            />
          </label>

          <fieldset className="rounded-2xl border border-cloud bg-mist p-4">
            <legend className="px-1 text-sm font-black text-ink">Affiliate partners</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {affiliatePartners.map((partner) => (
                <label key={partner} className="flex items-center gap-2 text-sm font-bold text-slate-700">
                  <input
                    type="checkbox"
                    checked={selectedPartners.includes(partner)}
                    onChange={() => togglePartner(partner)}
                    className="h-4 w-4 rounded border-cloud text-ocean"
                  />
                  {partner}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="block">
            <span className="text-sm font-black text-ink">Schedule post</span>
            <input
              value={scheduledFor}
              onChange={(event) => setScheduledFor(event.target.value)}
              type="datetime-local"
              className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
            />
          </label>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-3">
          <button
            type="button"
            onClick={generate}
            disabled={Boolean(busy)}
            className="rounded-2xl bg-ink px-4 py-3 text-sm font-black text-white shadow-soft disabled:opacity-60"
          >
            {busy === "generate" ? "Generating..." : "Generate social post"}
          </button>
          <button
            type="button"
            onClick={() => save("draft")}
            disabled={Boolean(busy)}
            className="rounded-2xl bg-white px-4 py-3 text-sm font-black text-ink shadow-soft ring-1 ring-cloud disabled:opacity-60"
          >
            {busy === "draft" ? "Saving..." : "Save draft"}
          </button>
          <button
            type="button"
            onClick={() => save("scheduled")}
            disabled={Boolean(busy) || !scheduledFor}
            className="rounded-2xl bg-ocean px-4 py-3 text-sm font-black text-white shadow-soft disabled:opacity-60"
          >
            {busy === "scheduled" ? "Scheduling..." : "Schedule post"}
          </button>
        </div>

        {notice ? <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
        {error ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
      </section>

      <section className="rounded-[1.5rem] border border-cloud bg-white/92 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">Draft preview</p>
        {generated ? (
          <div className="mt-4 grid gap-4">
            <div>
              <h2 className="text-2xl font-black text-ink">{generated.title}</h2>
              <p className="mt-1 text-xs font-black uppercase tracking-[0.14em] text-slate-400">{generated.source}</p>
            </div>
            {[
              ["Facebook caption", generated.facebookCaption],
              ["Instagram caption", generated.instagramCaption],
              ["TikTok/Reels script", generated.tiktokScript],
              ["LinkedIn post", generated.linkedinPost]
            ].map(([label, value]) => (
              <article key={label} className="rounded-2xl bg-mist p-4">
                <div className="flex items-start justify-between gap-3">
                  <h3 className="text-sm font-black text-ink">{label}</h3>
                  <button
                    type="button"
                    onClick={() => copyCaption(value)}
                    className="shrink-0 rounded-full bg-white px-3 py-1 text-xs font-black text-ink shadow-sm ring-1 ring-cloud"
                  >
                    Copy caption
                  </button>
                </div>
                <p className="mt-3 whitespace-pre-wrap text-sm font-bold leading-6 text-slate-600">{value}</p>
              </article>
            ))}
            <div className="rounded-2xl bg-mist p-4">
              <p className="text-sm font-black text-ink">Hashtags</p>
              <p className="mt-2 text-sm font-bold text-slate-600">{generated.hashtags.map((tag) => `#${tag.replace(/^#/, "")}`).join(" ")}</p>
            </div>
            {generated.affiliateDisclosure ? (
              <p className="rounded-2xl bg-sun/15 px-4 py-3 text-sm font-black leading-6 text-amber-800">
                {generated.affiliateDisclosure}
              </p>
            ) : null}
          </div>
        ) : (
          <p className="mt-4 rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-500">No draft generated yet.</p>
        )}
      </section>
    </div>
  );
}
