"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";
import { BuiMorphButton, type BuiMorphPhase } from "@/components/boardui/MorphButton";

const categories = [
  ["support", "support"], ["billing", "billing"], ["itinerary", "itinerary"], ["partner", "partner"], ["bug", "bug"], ["other", "other"]
] as const;

type ContactFormProps = {
  supportEmail: string;
  initialName?: string;
  initialEmail?: string;
};

export function ContactForm({ supportEmail, initialName = "", initialEmail = "" }: ContactFormProps) {
  const { locale, t } = useI18n();
  const [name, setName] = useState(initialName);
  const [email, setEmail] = useState(initialEmail);
  const [category, setCategory] = useState("support");
  const [tripId, setTripId] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [companyWebsite, setCompanyWebsite] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  /* Submit morph (smooth details, 2026-11-04): the send button is
   * ONE shape through pill → spinner → tick (BuiMorphButton). The
   * tick holds ~1.4s after a successful send, then the pill comes
   * back; the success notice below the button is untouched — the
   * morph accompanies the message, never replaces it. */
  const [sentPulse, setSentPulse] = useState(false);
  const sentTimer = useRef<number | null>(null);
  useEffect(() => () => {
    if (sentTimer.current) window.clearTimeout(sentTimer.current);
  }, []);
  const morphPhase: BuiMorphPhase = busy ? "busy" : sentPulse ? "done" : "idle";

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setNotice("");
    setError("");

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, email, category, trip_id: tripId, subject, message, companyWebsite })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || t("ui.email.contact.contactSendFailed"));
      }

      setNotice(data?.message || t("ui.email.contact.contactReceived"));
      setSentPulse(true);
      if (sentTimer.current) window.clearTimeout(sentTimer.current);
      sentTimer.current = window.setTimeout(() => setSentPulse(false), 1400);
      setName("");
      setEmail("");
      setCategory("support");
      setTripId("");
      setSubject("");
      setMessage("");
      setCompanyWebsite("");
    } catch (err) {
      setError(localizeCustomerError(locale, err, "ui.email.contact.contactSendFailed"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4 rounded-[1.5rem] border border-cloud bg-white/92 p-5 shadow-soft">
      <div aria-hidden="true" className="absolute -left-[10000px] h-px w-px overflow-hidden">
        <label htmlFor="contact-company-website">Leave this field empty</label>
        <input id="contact-company-website" name="companyWebsite" value={companyWebsite} onChange={(event) => setCompanyWebsite(event.target.value)} autoComplete="off" tabIndex={-1} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-black text-ink">{t("ui.email.contact.contactName")}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            autoComplete="name"
            required
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold outline-none focus:border-cblue"
          />
        </label>
        <label className="block">
          <span className="text-sm font-black text-ink">{t("ui.email.contact.contactEmail")}</span>
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            type="email"
            autoComplete="email"
            required
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold outline-none focus:border-cblue"
          />
        </label>
      </div>

      <div className="grid gap-4 sm:grid-cols-[0.8fr_1.2fr]">
        <label className="block">
          <span className="text-sm font-black text-ink">{t("ui.email.contact.contactCategory")}</span>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold outline-none focus:border-cblue"
          >
            {categories.map(([value]) => (
              <option key={value} value={value}>
                {t(`ui.email.contact.contactCategory_${value}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-black text-ink">{t("ui.email.contact.contactTripId")}</span>
          <input
            value={tripId}
            onChange={(event) => setTripId(event.target.value)}
            placeholder={t("ui.booking.optional")}
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold outline-none focus:border-cblue"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-black text-ink">{t("ui.email.contact.contactSubject")}</span>
        <input
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
          required
          maxLength={180}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold outline-none focus:border-cblue"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-ink">{t("ui.email.contact.contactMessage")}</span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          required
          rows={8}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-base font-bold leading-6 outline-none focus:border-cblue"
        />
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs font-bold leading-5 text-slate-500">
          {t("ui.email.contact.contactSupport", "Need help by email? Contact {email}.").replace("{email}", supportEmail)}
        </p>
        <BuiMorphButton
          phase={morphPhase}
          className="min-h-12 bg-ink px-5 text-sm font-black text-white shadow-soft"
        >
          {t("ui.email.contact.contactSend")}
        </BuiMorphButton>
      </div>

      {notice ? <p className="rounded-2xl bg-cblue/10 px-4 py-3 text-sm font-black text-cblue">{notice}</p> : null}
      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}
    </form>
  );
}
