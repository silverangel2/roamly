"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { safeAuthNextPath } from "@/lib/navigation";

type AuthFormProps = {
  mode: "login" | "signup";
  nextPath?: string;
  initialError?: string;
};

const VERIFY_ACCOUNT_MESSAGE = "Account created. Please verify your email before logging in.";
const RESEND_SUCCESS_MESSAGE = "Verification email sent. Check your inbox, spam, promotions, or updates.";
const RESEND_ERROR_MESSAGE = "We could not resend the verification email. Try again or contact support.";
const TESTER_UNVERIFIED_MESSAGE = "Tester access starts after this email is verified.";
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

function persistAuthNext(path: string) {
  const safePath = safeAuthNextPath(path);
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

async function getTesterEmailStatus(email: string) {
  try {
    const response = await fetch("/api/auth/tester-email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email })
    });

    if (!response.ok) return false;

    const payload: unknown = await response.json();
    return isRecord(payload) && payload.isTesterEmail === true;
  } catch {
    return false;
  }
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
  const [testerVerificationNotice, setTesterVerificationNotice] = useState(false);
  const isSignup = mode === "signup";
  const configured = hasSupabaseConfig();
  const redirectPath = safeAuthNextPath(nextPath);
  const loginHref = `/login?next=${encodeURIComponent(redirectPath)}`;
  const alternateHref = `${isSignup ? "/login" : "/signup"}?next=${encodeURIComponent(redirectPath)}`;

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
        .then(({ data }) => {
          if (!alive || !data.session?.user) return;
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
    setTesterVerificationNotice(false);

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

  async function showVerificationState(address: string) {
    setVerificationEmail(address);
    setTesterVerificationNotice(await getTesterEmailStatus(address));
    setPassword("");
    setResendNotice("");
    setResendError("");
  }

  function changeEmail() {
    setVerificationEmail("");
    setTesterVerificationNotice(false);
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
    setTesterVerificationNotice(false);

    if (!isSignup) {
      setVerificationEmail("");
    }

    if (!configured) {
      setError("Supabase is not configured yet.");
      return;
    }

    if (!email.trim() || !password) {
      setError("Email and password are required.");
      return;
    }

    if (isSignup && password.length < 8) {
      setError("Use at least 8 characters for the password.");
      return;
    }

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
      <div className="rounded-app border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-soft">
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
      <div className="space-y-4">
        <div className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-4 text-ocean">
          <p className="text-sm font-black">{VERIFY_ACCOUNT_MESSAGE}</p>
          <p className="mt-2 break-words text-sm font-bold leading-6">We sent the verification link to {verificationEmail}.</p>
        </div>

        {testerVerificationNotice ? (
          <p className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-black text-amber-900">
            {TESTER_UNVERIFIED_MESSAGE}
          </p>
        ) : null}

        {resendNotice ? (
          <p className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
            {resendNotice}
          </p>
        ) : null}

        {resendError ? (
          <p className="rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
            {resendError}
          </p>
        ) : null}

        <div className="grid gap-3">
          <button
            type="button"
            disabled={resendBusy}
            onClick={resendVerificationEmail}
            className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
          >
            {resendBusy ? "Sending..." : "Resend verification email"}
          </button>
          <button
            type="button"
            onClick={changeEmail}
            className="w-full rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink transition hover:border-ocean hover:text-ocean"
          >
            Change email
          </button>
          <Link
            href={loginHref}
            className="w-full rounded-2xl border border-cloud bg-white px-5 py-3 text-center text-sm font-black text-ink transition hover:border-ocean hover:text-ocean"
          >
            Back to login
          </Link>
        </div>

        <p className="text-center text-xs font-bold leading-5 text-slate-500">{SUPPORT_MESSAGE}</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="space-y-3">
        <button
          type="button"
          disabled={busy || googleBusy}
          onClick={continueWithGoogle}
          className="flex w-full items-center justify-center gap-3 rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink shadow-soft transition hover:border-ocean hover:text-ocean disabled:opacity-60"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-cloud bg-white text-sm font-black text-slate-700">
            G
          </span>
          {googleBusy ? "Continuing..." : "Continue with Google"}
        </button>
        <p className="text-center text-xs font-bold leading-5 text-slate-500">{SHARED_GOOGLE_MESSAGE}</p>
      </div>

      <div className="flex items-center gap-3 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
        <span className="h-px flex-1 bg-cloud" />
        <span>Email</span>
        <span className="h-px flex-1 bg-cloud" />
      </div>

      {isSignup ? (
        <label className="block">
          <span className="text-sm font-black text-ink">Full name</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            aria-label="Full name"
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          />
        </label>
      ) : null}

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

      <label className="block">
        <span className="text-sm font-black text-ink">Password</span>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          aria-label={isSignup ? "New password" : "Password"}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
        />
      </label>

      {error ? (
        <p className="rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
          {notice}
        </p>
      ) : null}

      {!isSignup && verificationEmail ? (
        <div className="space-y-3 rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-4">
          {testerVerificationNotice ? (
            <p className="text-sm font-black text-amber-900">{TESTER_UNVERIFIED_MESSAGE}</p>
          ) : null}

          {resendNotice ? <p className="text-sm font-black text-ocean">{resendNotice}</p> : null}
          {resendError ? <p className="text-sm font-black text-coral">{resendError}</p> : null}

          <button
            type="button"
            disabled={resendBusy}
            onClick={resendVerificationEmail}
            className="w-full rounded-2xl bg-white px-5 py-3 text-sm font-black text-ocean shadow-soft transition hover:text-ink disabled:opacity-60"
          >
            {resendBusy ? "Sending..." : "Resend verification email"}
          </button>

          <p className="text-xs font-bold leading-5 text-slate-600">{SUPPORT_MESSAGE}</p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400 disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Working..." : isSignup ? "Create free account" : "Log in"}
      </button>

      <p className="text-center text-sm font-bold text-slate-500">
        {isSignup ? "Already have an account?" : "New to Roamly?"}{" "}
        <Link href={alternateHref} className="text-ocean hover:text-ink">
          {isSignup ? "Log in" : "Create account"}
        </Link>
      </p>
    </form>
  );
}
