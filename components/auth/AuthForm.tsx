"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { syncSupabaseServerSession } from "@/lib/roamly/authenticatedFetch";
import { safeAuthNextPath } from "@/lib/navigation";
import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiNotice } from "@/components/boardui/Notice";
import { BuiErrorSummary, BuiFieldError, useBuiField } from "@/components/boardui/Field";

type AuthFormProps = {
  mode: "login" | "signup";
  nextPath?: string;
  initialError?: string;
};

const VERIFY_ACCOUNT_MESSAGE = "Account created. Please verify your email before logging in.";
const RESEND_SUCCESS_MESSAGE = "Verification email sent. Check your inbox, spam, promotions, or updates.";
const RESEND_ERROR_MESSAGE = "We could not resend the verification email. Try again or contact support.";
const TESTER_VERIFICATION_MESSAGE = "If you were invited to test Roamly, access will be available after you verify this email.";
const SUPPORT_MESSAGE = "Still no email? Contact support or ask an admin to confirm your account in Supabase.";
const SHARED_GOOGLE_MESSAGE = "You can continue with the same email or Google account.";
const EXISTING_ACCOUNT_MESSAGE = "This email may already have a Roamly account. Try logging in or continue with Google.";
const LOGIN_ERROR_MESSAGE = "We could not sign you in. Please try again.";
const LOGIN_UNVERIFIED_MESSAGE =
  "This email is not verified yet. Please verify your email before logging in. You can resend the verification email below.";
const AUTH_NEXT_COOKIE = "roamly_auth_next";
const AUTH_NEXT_STORAGE_KEY = "roamly.auth.next";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isEmailNotConfirmedError(error: unknown) {
  if (!isRecord(error)) return false;

  const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";

  return code === "email_not_confirmed" || message.includes("email not confirmed") || message.includes("email not verified");
}

function isUserAlreadyRegisteredError(error: unknown) {
  if (!isRecord(error)) return false;

  const code = typeof error.code === "string" ? error.code.toLowerCase() : "";
  const message = typeof error.message === "string" ? error.message.toLowerCase() : "";

  return (
    code === "user_already_exists" ||
    message.includes("user already registered") ||
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("email already")
  );
}

function isValidEmailAddress(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function persistAuthNext(path: string) {  const safePath = safeAuthNextPath(path);
  try {
    window.sessionStorage.setItem(AUTH_NEXT_STORAGE_KEY, safePath);
  } catch {
    // Best-effort only; the cookie is the server-side callback fallback.
  }
  document.cookie = `${AUTH_NEXT_COOKIE}=${encodeURIComponent(safePath)}; path=/; max-age=900; samesite=lax`;
  return safePath;
}

function readStoredAuthNext() {
  try {
    return window.sessionStorage.getItem(AUTH_NEXT_STORAGE_KEY) || "";
  } catch {
    return "";
  }
}

function clearStoredAuthNext() {
  try {
    window.sessionStorage.removeItem(AUTH_NEXT_STORAGE_KEY);
  } catch {
    // Best-effort cleanup.
  }
  document.cookie = `${AUTH_NEXT_COOKIE}=; path=/; max-age=0; samesite=lax`;
}

export function AuthForm({ mode, nextPath = "/plan", initialError = "" }: AuthFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [googleBusy, setGoogleBusy] = useState(false);
  const [verificationEmail, setVerificationEmail] = useState("");
  const [resendNotice, setResendNotice] = useState("");
  const [resendError, setResendError] = useState("");
  const [resendBusy, setResendBusy] = useState(false);
  const isSignup = mode === "signup";
  const configured = hasSupabaseConfig();
  const redirectPath = safeAuthNextPath(nextPath);
  const loginHref = `/login?next=${encodeURIComponent(redirectPath)}`;
  const alternateHref = `${isSignup ? "/login" : "/signup"}?next=${encodeURIComponent(redirectPath)}`;

  /* Form Rules pass (2026-11-03), rules 2 + 3: field problems are
     validated on blur (never on the first keystroke), re-checked per
     keystroke once a field has errored, land in a reserved slot
     under their own field, and are summarised at the top of the
     form on submit. The old single form-level string ("Email and
     password are required.") named no field and appeared directly
     above the submit button, pushing it down. */
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const emailField = useBuiField((value) => {
    const trimmed = value.trim();
    if (!trimmed) return "Email is required.";
    if (!isValidEmailAddress(trimmed)) return "Enter a valid email address.";
    return "";
  });
  const passwordField = useBuiField((value) => {
    if (!value) return "Password is required.";
    if (isSignup && value.length < 8) return "Use at least 8 characters for the password.";
    return "";
  });
  const fieldSummary = [
    ...(emailField.error ? [{ fieldId: "auth-email", label: "Email", message: emailField.error }] : []),
    ...(passwordField.error ? [{ fieldId: "auth-password", label: "Password", message: passwordField.error }] : [])
  ];

  function emailRedirectTo() {
    return `${window.location.origin}/auth/callback?next=${encodeURIComponent(redirectPath)}`;
  }

  function syncProfileBestEffort(method: "GET" | "PATCH", body?: Record<string, unknown>) {
    void fetch("/api/account/profile", {
      method,
      headers: body ? { "content-type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    }).catch((profileError) => {
      console.warn("[Roamly auth] profile sync warning", profileError);
    });
  }

  useEffect(() => {
    if (!configured) return;

    let alive = true;

    try {
      const supabase = createSupabaseBrowserClient();
      void supabase.auth
        .getSession()
        .then(async ({ data }) => {
          if (!alive || !data.session?.user) return;

          await syncSupabaseServerSession();
          if (!alive) return;

          syncProfileBestEffort("GET");
          const target = safeAuthNextPath(readStoredAuthNext() || redirectPath);
          clearStoredAuthNext();
          window.location.replace(target);
        })
        .catch(() => undefined);
    } catch {
      // The visible form will handle missing auth configuration and sign-in errors.
    }

    return () => {
      alive = false;
    };
  }, [configured, redirectPath]);

  async function continueWithGoogle() {
    setError("");
    setNotice("");
    setResendNotice("");
    setResendError("");

    if (!configured) {
      setError("Supabase is not configured yet.");
      return;
    }

    setGoogleBusy(true);

    try {
      persistAuthNext(redirectPath);
      const supabase = createSupabaseBrowserClient();
      const { error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: {
          redirectTo: emailRedirectTo()
        }
      });

      if (oauthError) throw oauthError;
    } catch (err) {
      setGoogleBusy(false);
      console.warn("[Roamly auth] Google sign-in warning", err);
      setError(LOGIN_ERROR_MESSAGE);
    }
  }

  function showVerificationState(address: string) {
    setVerificationEmail(address);
    setPassword("");
    setResendNotice("");
    setResendError("");
  }

  function changeEmail() {
    setVerificationEmail("");
    setNotice("");
    setError("");
    setResendNotice("");
    setResendError("");
    setPassword("");
  }

  async function resendVerificationEmail() {
    setResendNotice("");
    setResendError("");

    if (!configured || !verificationEmail) {
      setResendError(RESEND_ERROR_MESSAGE);
      return;
    }

    setResendBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: resendAuthError } = await supabase.auth.resend({
        type: "signup",
        email: verificationEmail,
        options: {
          emailRedirectTo: emailRedirectTo()
        }
      });

      if (resendAuthError) throw resendAuthError;

      setResendNotice(RESEND_SUCCESS_MESSAGE);
    } catch {
      setResendError(RESEND_ERROR_MESSAGE);
    } finally {
      setResendBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");
    setResendNotice("");
    setResendError("");

    if (!isSignup) {
      setVerificationEmail("");
    }

    if (!configured) {
      setError("Supabase is not configured yet.");
      return;
    }

    /* Rules 2 + 3: submit validates every field into its own slot
       and the top summary; a broken field stops the submit here. */
    setSubmitAttempted(true);
    const emailProblem = emailField.runValidation(email);
    const passwordProblem = passwordField.runValidation(password);
    if (emailProblem || passwordProblem) return;

    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const trimmedEmail = email.trim();

      if (isSignup) {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: trimmedEmail,
          password,
          options: {
            emailRedirectTo: emailRedirectTo(),
            data: {
              full_name: fullName.trim()
            }
          }
        });

        if (signUpError) throw signUpError;

        if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
          setError(EXISTING_ACCOUNT_MESSAGE);
          return;
        }

        if (data.session) {
          syncProfileBestEffort("PATCH", { fullName: fullName.trim() });
          window.location.replace(redirectPath);
          return;
        }

        await showVerificationState(trimmedEmail);
        return;
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: trimmedEmail,
        password
      });

      if (loginError) throw loginError;

      syncProfileBestEffort("GET");
      window.location.replace(redirectPath);
    } catch (err) {
      if (!isSignup && isEmailNotConfirmedError(err)) {
        const trimmedEmail = email.trim();
        setError(LOGIN_UNVERIFIED_MESSAGE);
        await showVerificationState(trimmedEmail);
      } else if (isSignup && isUserAlreadyRegisteredError(err)) {
        setError(EXISTING_ACCOUNT_MESSAGE);
      } else {
        if (!isSignup) {
          console.warn("[Roamly auth] email sign-in warning", err);
        }
        setError(isSignup ? (err instanceof Error ? err.message : "Authentication failed.") : LOGIN_ERROR_MESSAGE);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!configured) {
    return (
      <div className="bui-enter rounded-bui-card border border-corange/40 bg-corange/10 p-5 text-chead shadow-bui-card">
        <p className="text-xs font-black uppercase tracking-[0.18em]">Setup needed</p>
        <h2 className="mt-2 text-2xl font-black">Connect Roamly Supabase first.</h2>
        <p className="mt-2 text-sm font-bold leading-6">
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to enable signup and login.
        </p>
      </div>
    );
  }

  if (isSignup && verificationEmail) {
    return (
      <div className="bui-enter space-y-4">
        <BuiNotice tone="success" title={VERIFY_ACCOUNT_MESSAGE}>
          <p className="break-words">We sent the verification link to {verificationEmail}.</p>
        </BuiNotice>

        <BuiNotice tone="info" title={TESTER_VERIFICATION_MESSAGE} />

        {resendNotice ? <BuiNotice tone="success" title={resendNotice} /> : null}

        {resendError ? <BuiNotice tone="error" title={resendError} /> : null}

        <div className="grid gap-3">
          <BuiButton type="button" busy={resendBusy} onClick={resendVerificationEmail} className="w-full">
            {resendBusy ? "Sending..." : "Resend verification email"}
          </BuiButton>
          <BuiButton type="button" variant="secondary" onClick={changeEmail} className="w-full">
            Change email
          </BuiButton>
          <BuiButtonLink href={loginHref} variant="secondary" className="w-full">
            Back to login
          </BuiButtonLink>
        </div>

        <p className="text-center text-xs font-bold leading-5 text-cgray">{SUPPORT_MESSAGE}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} noValidate className="bui-enter space-y-4">
      {/* noValidate: this form's own blur-first validation (rules
          2 + 3) owns error timing — the browser's native bubbles
          would pre-empt the submit and strand the error summary. */}
      {/* Rule 3: form-level problems surface at the TOP of the form —
          the submit summary links to each broken field, and server
          errors land in the same slot. Nothing error-shaped renders
          between the last field and the submit button anymore, so
          appearing text can never push the button down. */}
      {submitAttempted ? <BuiErrorSummary errors={fieldSummary} /> : null}

      {error ? <BuiNotice tone="error" title={error} /> : null}

      {notice ? <BuiNotice tone="info" title={notice} /> : null}

      <div className="space-y-3">
        <BuiButton
          type="button"
          variant="secondary"
          busy={googleBusy}
          disabled={busy}
          onClick={continueWithGoogle}
          className="w-full"
        >
          <svg viewBox="0 0 48 48" className="h-5 w-5 shrink-0" aria-hidden="true" focusable="false">
            <path fill="#FFC107" d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z" />
            <path fill="#FF3D00" d="m6.306 14.691 6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z" />
            <path fill="#4CAF50" d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0 1 24 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z" />
            <path fill="#1976D2" d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 0 1-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z" />
          </svg>
          {googleBusy ? "Continuing..." : "Continue with Google"}
        </BuiButton>
        <p className="text-center text-xs font-bold leading-5 text-cgray">{SHARED_GOOGLE_MESSAGE}</p>
      </div>

      <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-cgray2">
        <span className="h-px flex-1 bg-chair" />
        <span>Email</span>
        <span className="h-px flex-1 bg-chair" />
      </div>

      {isSignup ? (
        <label className="block">
          <span className="text-sm font-black text-chead">Full name</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            aria-label="Full name"
            className="bui-input mt-2 w-full rounded-2xl border border-chair bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:border-cblue focus:ring-4 focus:ring-cblue/10"
          />
        </label>
      ) : null}

      <label key={`email-${emailField.shakeKey}`} className={emailField.shakeKey > 0 ? "bui-shake block" : "block"}>
        <span className="text-sm font-black text-chead">Email</span>
        <input
          id="auth-email"
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
          aria-describedby={emailField.error ? "auth-email-error" : undefined}
          className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
            emailField.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
          }`}
        />
        <BuiFieldError id="auth-email-error" message={emailField.error} />
      </label>

      <label key={`password-${passwordField.shakeKey}`} className={passwordField.shakeKey > 0 ? "bui-shake block" : "block"}>
        <span className="flex items-center justify-between gap-2">
          <span className="text-sm font-black text-chead">Password</span>
          {!isSignup ? (
            <Link
              href="/forgot-password"
              className="bui-touch inline-flex items-center rounded-full px-1 text-xs font-black text-cblue hover:text-chead focus:outline-none focus:ring-4 focus:ring-cblue/15"
            >
              Forgot password?
            </Link>
          ) : null}
        </span>
        <input
          id="auth-password"
          value={password}
          onChange={(event) => {
            setPassword(event.target.value);
            passwordField.onChange(event.target.value);
          }}
          onBlur={() => passwordField.onBlur(password)}
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          aria-label={isSignup ? "New password" : "Password"}
          aria-invalid={passwordField.error ? true : undefined}
          aria-describedby={passwordField.error ? "auth-password-error" : undefined}
          className={`bui-input mt-2 w-full rounded-2xl border bg-white px-4 py-3 text-base font-bold text-chead outline-none transition focus:ring-4 focus:ring-cblue/10 ${
            passwordField.error ? "border-cred focus:border-cred" : "border-chair focus:border-cblue"
          }`}
        />
        <BuiFieldError id="auth-password-error" message={passwordField.error} />
      </label>

      {!isSignup && verificationEmail ? (
        <div className="bui-enter space-y-3 rounded-bui-card border border-chair bg-csoft px-4 py-4">
          <p className="text-sm font-black text-chead">{TESTER_VERIFICATION_MESSAGE}</p>

          {resendNotice ? <p className="text-sm font-black text-cblue">{resendNotice}</p> : null}
          {resendError ? <p className="text-sm font-black text-cred">{resendError}</p> : null}

          <BuiButton type="button" variant="secondary" busy={resendBusy} onClick={resendVerificationEmail} className="w-full">
            {resendBusy ? "Sending..." : "Resend verification email"}
          </BuiButton>

          <p className="text-xs font-bold leading-5 text-cink">{SUPPORT_MESSAGE}</p>
        </div>
      ) : null}

      <BuiButton type="submit" busy={busy} className="w-full">
        {busy ? "Working..." : isSignup ? "Create free account" : "Log in"}
      </BuiButton>

      <p className="flex flex-wrap items-center justify-center gap-x-2 text-center text-sm font-bold text-cgray">
        <span>{isSignup ? "Already have an account?" : "New to Roamly?"}</span>
        <Link href={alternateHref} className="bui-touch inline-flex items-center rounded-full px-2 text-cblue hover:text-chead focus:outline-none focus:ring-4 focus:ring-cblue/15">
          {isSignup ? "Log in" : "Create account"}
        </Link>
      </p>
    </form>
  );
}
