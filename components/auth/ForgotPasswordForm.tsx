"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiFieldError, useBuiField } from "@/components/boardui/Field";

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

  /* Form Rules pass (2026-11-03), rules 2 + 3: the email problem is
     a FIELD problem — validated on blur, re-checked per keystroke
     once errored, shown in the field's reserved slot. It used to be
     a form-level string that appeared between the field and the
     submit button, pushing the button down. */
  const emailField = useBuiField((value) => (isValidEmail(value.trim()) ? "" : EMAIL_ERROR_MESSAGE));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    if (!configured) {
      setError(NOT_CONFIGURED_MESSAGE);
      return;
    }

    if (emailField.runValidation(email)) return;

    const trimmedEmail = email.trim();

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
      <div className="bui-enter space-y-4">
        <BuiNotice tone="success" title={SENT_MESSAGE} />
        <p className="text-sm font-bold leading-6 text-cgray">
          Check your inbox, spam, promotions, or updates. The link expires in 60 minutes.
        </p>
        <BuiButtonLink href="/login" variant="secondary" className="w-full">
          Back to login
        </BuiButtonLink>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="bui-enter space-y-4">
      {/* noValidate: the form's own blur-first field validation
          owns error timing (form rules 2 + 3); native bubbles
          would pre-empt it. */}
      {/* Rule 3: the one form-level state (not configured) surfaces at
          the top of the form, never between the field and the button. */}
      {error ? <BuiNotice tone="error" title={error} /> : null}

      <label key={`forgot-${emailField.shakeKey}`} className={emailField.shakeKey > 0 ? "bui-shake block" : "block"}>
        <span className="text-sm font-black text-chead">Email</span>
        <input
          id="forgot-email"
          value={email}
          onChange={(event) => {
            setEmail(event.target.value);
            emailField.onChange(event.target.value);
          }}
          onBlur={() => emailField.onBlur(email)}
          type="email"
          inputMode="email"
          autoComplete="email"
          aria-label="Email address"
          aria-invalid={emailField.error ? true : undefined}
          aria-describedby={emailField.error ? "forgot-email-error" : undefined}
          className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
            emailField.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
          }`}
        />
        <BuiFieldError id="forgot-email-error" message={emailField.error} />
      </label>

      <BuiButton type="submit" busy={busy} className="w-full">
        {busy ? "Sending..." : "Send reset link"}
      </BuiButton>

      <p className="text-center text-sm font-bold text-cgray">
        <Link
          href="/login"
          className="bui-touch inline-flex items-center rounded-full px-2 text-cblue hover:text-chead focus:outline-none focus:ring-4 focus:ring-cblue/15"
        >
          Back to login
        </Link>
      </p>
    </form>
  );
}
