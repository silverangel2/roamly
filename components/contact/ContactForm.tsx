"use client";

import { useState, type FormEvent } from "react";

const categories = [
  ["support", "Support"],
  ["billing", "Billing"],
  ["itinerary", "Itinerary"],
  ["partner", "Partner"],
  ["bug", "Bug"],
  ["other", "Other"]
] as const;

type ContactFormProps = {
  supportEmail: string;
};

export function ContactForm({ supportEmail }: ContactFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [category, setCategory] = useState("support");
  const [tripId, setTripId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, category, trip_id: tripId, subject, message })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Message could not be sent.");
      }

      setNotice(data?.message || "Thanks - your message was received.");
      setName("");
      setEmail("");
      setCategory("support");
      setTripId("");
      setSubject("");
      setMessage("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Message could not be sent.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-[1.5rem] border border-cloud bg-white/92 p-5 shadow-soft">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-black text-ink">Name</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
          />
        </label>
        <label className="block">
          <span className="text-sm font-black text-ink">Email</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            required
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
        <label className="block">
          <span className="text-sm font-black text-ink">Category</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
          >
            {categories.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-black text-ink">Trip ID</span>
          <input
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            placeholder="Optional"
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-black text-ink">Subject</span>
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={180}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold outline-none focus:border-ocean"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-ink">Message</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          rows={8}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold leading-6 outline-none focus:border-ocean"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold leading-5 text-slate-500">
          Need help by email? Contact {supportEmail}.
        </p>
        <button
          type="submit"
          disabled={busy}
          className="inline-flex min-h-12 items-center justify-center rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 disabled:pointer-events-none disabled:opacity-60"
        >
          {busy ? "Sending..." : "Send message"}
        </button>
      </div>

      {notice ? <p className="rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{notice}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </form>
  );
}
