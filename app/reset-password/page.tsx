"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiErrorSummary, BuiFieldError, useBuiField } from "@/components/boardui/Field";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type RecoveryStatus = "checking" | "ready" | "invalid";

const PASSWORD_MIN_LENGTH = 8;
const PASSWORD_LENGTH_MESSAGE = "Use at least 8 characters for the password.";
const MISMATCH_MESSAGE = "The passwords do not match. Please try again.";
const UPDATE_ERROR_MESSAGE = "We could not update your password. Please request a new link and try again.";
const SUCCESS_MESSAGE = "Your password has been updated. Taking you to the login page...";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [status, setStatus] = useState<RecoveryStatus>("checking");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [updated, setUpdated] = useState(false);

  /* Form Rules pass (2026-11-03), rules 2 + 3: both password
     problems are FIELD problems — validated on blur, re-checked per
     keystroke once errored, shown in reserved slots under their own
     fields, and summarised at the top of the form on submit. They
     used to be one form-level string rendered directly above the
     submit button, pushing it down. The confirm field compares
     against a ref mirror of the new password, so editing the new
     password can re-check a confirm field that has already
     errored, mid-keystroke, against the freshest value. */
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const newPasswordRef = useRef("");
  const newPasswordField = useBuiField((value) => (value.length < PASSWORD_MIN_LENGTH ? PASSWORD_LENGTH_MESSAGE : ""));
  const confirmPasswordField = useBuiField((value) => (value !== newPasswordRef.current ? MISMATCH_MESSAGE : ""));
  const fieldSummary = [
    ...(newPasswordField.error ? [{ fieldId: "reset-new-password", label: "New password", message: newPasswordField.error }] : []),
    ...(confirmPasswordField.error
      ? [{ fieldId: "reset-confirm-password", label: "Confirm new password", message: confirmPasswordField.error }]
      : [])
  ];

  // Validate the recovery link on mount and establish the recovery session.
  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setStatus("invalid");
      return;
    }

    let alive = true;

    const markInvalid = () => {
      if (!alive) return;
      setStatus("invalid");
    };
    const finishReady = () => {
      if (!alive) return;
      try {
        // Strip the recovery token from the URL once the session is established.
        window.history.replaceState(null, "", window.location.pathname);
      } catch {
        // Best-effort cleanup only.
      }
      setStatus("ready");
    };

    try {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const hashIndicatesRecovery =
        params.get("type") === "recovery" || (window.location.hash || "").includes("type=recovery");

      if (!tokenHash && !hashIndicatesRecovery) {
        markInvalid();
        return () => {
          alive = false;
        };
      }

      const supabase = createSupabaseBrowserClient();

      if (tokenHash) {
        // PKCE-style recovery link: exchange the token for a recovery session.
        void supabase.auth
          .verifyOtp({ token_hash: tokenHash, type: "recovery" })
          .then(({ data, error }) => {
            if (!alive) return;
            if (error || !data.session) {
              markInvalid();
              return;
            }
            finishReady();
          })
          .catch(() => markInvalid());

        return () => {
          alive = false;
        };
      }

      // Implicit-style recovery link: createBrowserClient detects the session
      // in the URL automatically; also listen for the PASSWORD_RECOVERY event.
      void supabase.auth
        .getSession()
        .then(({ data }) => {
          if (!alive) return;
          if (data.session?.user) finishReady();
        })
        .catch(() => undefined);

      const { data: listener } = supabase.auth.onAuthStateChange((event, session) => {
        if (!alive) return;
        if ((event === "PASSWORD_RECOVERY" || event === "SIGNED_IN") && session?.user) {
          finishReady();
        }
      });

      const timer = window.setTimeout(() => {
        if (!alive) return;
        setStatus((current) => (current === "checking" ? "invalid" : current));
      }, 8000);

      return () => {
        alive = false;
        window.clearTimeout(timer);
        try {
          listener.subscription.unsubscribe();
        } catch {
          // Best-effort cleanup only.
        }
      };
    } catch {
      markInvalid();
      return () => {
        alive = false;
      };
    }
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");

    /* Rules 2 + 3: submit validates each field into its own slot
       and the top summary; a broken field stops the submit here. */
    setSubmitAttempted(true);
    const lengthProblem = newPasswordField.runValidation(newPassword);
    const matchProblem = confirmPasswordField.runValidation(confirmPassword);
    if (lengthProblem || matchProblem) return;

    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setNewPassword("");
      setConfirmPassword("");
      newPasswordRef.current = "";
      setUpdated(true);
      window.setTimeout(() => {
        router.push("/login");
      }, 2500);
    } catch (err) {
      console.warn("[Roamly auth] password update warning", err);
      setError(UPDATE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="bg-cbg">
      <div className="bui-safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] min-w-0 w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
        {/* Apply-All Sweep (2026-11-03): same auth treatment as
            login — token ground + the Round 1 pricing hero panel.
            Copy and all recovery behaviour unchanged. */}
        <section className="bui-enter min-w-0 overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-6 shadow-bui-hero sm:p-10">
          <BuiBadge tone="primary">Account help</BuiBadge>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-tight text-chead sm:text-6xl">
            Choose a new password.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-cink">
            Your reset link brought you here. Pick a new password to get back into your Roamly account.
          </p>
        </section>

        <BuiCard className="bui-enter mx-auto min-w-0 w-full max-w-md rounded-bui-panel p-6">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Roamly account</p>
        <h2 className="mt-2 text-2xl font-black text-chead">Set new password</h2>
        <div className="mt-5">
          {status === "checking" ? (
            <BuiNotice tone="info" title="Checking your reset link..." />
          ) : null}

          {status === "invalid" ? (
            <div className="bui-enter space-y-4">
              <BuiNotice tone="error" title="This reset link is invalid or has expired. Request a new one to continue." />
              <BuiButtonLink href="/forgot-password" className="w-full">
                Request a new reset link
              </BuiButtonLink>
            </div>
          ) : null}

          {status === "ready" && !updated ? (
            <form onSubmit={submit} noValidate className="bui-enter space-y-4">
              {/* noValidate + Rule 3: the form's own blur-first field
                  validation owns error timing, and form-level problems
                  surface at the TOP of the form — the submit summary
                  links to each broken field, and the update failure
                  lands in the same slot. Nothing error-shaped renders
                  between the last field and the submit button anymore. */}
              {submitAttempted ? <BuiErrorSummary errors={fieldSummary} /> : null}

              {error ? <BuiNotice tone="error" title={error} /> : null}

              <label key={`new-${newPasswordField.shakeKey}`} className={newPasswordField.shakeKey > 0 ? "bui-shake block" : "block"}>
                <span className="text-sm font-black text-chead">New password</span>
                <input
                  id="reset-new-password"
                  value={newPassword}
                  onChange={(event) => {
                    const next = event.target.value;
                    newPasswordRef.current = next;
                    setNewPassword(next);
                    newPasswordField.onChange(next);
                    if (confirmPasswordField.watching) confirmPasswordField.runValidation(confirmPassword);
                  }}
                  onBlur={() => newPasswordField.onBlur(newPassword)}
                  type="password"
                  autoComplete="new-password"
                  aria-label="New password"
                  aria-invalid={newPasswordField.error ? true : undefined}
                  aria-describedby={newPasswordField.error ? "reset-new-password-error" : undefined}
                  className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
                    newPasswordField.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
                  }`}
                />
                <BuiFieldError id="reset-new-password-error" message={newPasswordField.error} />
              </label>

              <label key={`confirm-${confirmPasswordField.shakeKey}`} className={confirmPasswordField.shakeKey > 0 ? "bui-shake block" : "block"}>
                <span className="text-sm font-black text-chead">Confirm new password</span>
                <input
                  id="reset-confirm-password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    confirmPasswordField.onChange(event.target.value);
                  }}
                  onBlur={() => confirmPasswordField.onBlur(confirmPassword)}
                  type="password"
                  autoComplete="new-password"
                  aria-label="Confirm new password"
                  aria-invalid={confirmPasswordField.error ? true : undefined}
                  aria-describedby={confirmPasswordField.error ? "reset-confirm-password-error" : undefined}
                  className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
                    confirmPasswordField.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
                  }`}
                />
                <BuiFieldError id="reset-confirm-password-error" message={confirmPasswordField.error} />
              </label>

              <BuiButton type="submit" busy={busy} className="w-full">
                {busy ? "Updating..." : "Update password"}
              </BuiButton>
            </form>
          ) : null}

          {status === "ready" && updated ? (
            <div className="bui-enter space-y-4">
              <BuiNotice tone="success" title={SUCCESS_MESSAGE} />
              <BuiButtonLink href="/login" variant="secondary" className="w-full">
                Go to login now
              </BuiButtonLink>
            </div>
          ) : null}
        </div>
        </BuiCard>
      </div>
    </div>
  );
}
