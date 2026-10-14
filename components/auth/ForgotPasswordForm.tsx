"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

const SENT_MESSAGE = "If an account exists for that email, a reset link is on its way.";
const EMAIL_ERROR_MESSAGE = "Enter a valid email address.";
const NOT_CONFIGURED_MESSAGE = "Supabase is not configured yet.";

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const configured = hasSupabaseConfig();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!configured) {
      setError(NOT_CONFIGURED_MESSAGE);
      return;
    }

    const trimmedEmail = email.trim();

    if (!isValidEmail(trimmedEmail)) {
      setError(EMAIL_ERROR_MESSAGE);
      return;
    }

    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      await supabase.auth.resetPasswordForEmail(trimmedEmail, {
        redirectTo: `${window.location.origin}/reset-password`
      });
    } catch (err) {
      // Deliberately swallowed into the generic success copy below: a
      // stranger must not be able to probe which emails have Roamly accounts.
      console.warn("[Roamly auth] password-reset request warning", err);
    } finally {
      setBusy(false);
      setSent(true);
    }
  }

  if (sent) {
    return (
      <div className="space-y-4">
        <p className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {SENT_MESSAGE}
        </p>
        <p className="text-sm font-bold leading-6 text-slate-500">
          Check your inbox, spam, promotions, or updates. The link expires in 60 minutes.
        </p>
        <Link
          href="/login"
          className="flex w-full items-center justify-center rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink shadow-soft transition hover:border-ocean hover:text-ocean"
        >
          Back to login
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <label className="block">
        <span className="text-sm font-black text-ink">Email</span>
        <input
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          type="email"
          autoComplete="email"
          aria-label="Email address"
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
        />
      </label>

      {error ? (
        <p className="rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {error}
        </p>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Sending..." : "Send reset link"}
      </button>

      <p className="text-center text-sm font-bold text-slate-500">
        <Link
          href="/login"
          className="inline-flex min-h-11 items-center rounded-full px-2 text-ocean hover:text-ink focus:outline-none focus:ring-4 focus:ring-ocean/15"
        >
          Back to login
        </Link>
      </p>
    </form>
  );
}
