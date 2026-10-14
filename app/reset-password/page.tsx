"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
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

    if (newPassword.length < PASSWORD_MIN_LENGTH) {
      setError(PASSWORD_LENGTH_MESSAGE);
      return;
    }

    if (newPassword !== confirmPassword) {
      setError(MISMATCH_MESSAGE);
      return;
    }

    setBusy(true);

    try {
      const supabase = createSupabaseBrowserClient();
      const { error: updateError } = await supabase.auth.updateUser({ password: newPassword });
      if (updateError) throw updateError;

      setNewPassword("");
      setConfirmPassword("");
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
    <div className="safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] min-w-0 w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
      <section className="min-w-0 space-y-5">
        <Badge>Account help</Badge>
        <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight text-ink sm:text-6xl">
          Choose a new password.
        </h1>
        <p className="max-w-xl text-base font-semibold leading-7 text-slate-600">
          Your reset link brought you here. Pick a new password to get back into your Roamly account.
        </p>
      </section>

      <Card className="mx-auto min-w-0 w-full max-w-md">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Roamly account</p>
        <h2 className="mt-2 text-2xl font-black text-ink">Set new password</h2>
        <div className="mt-5">
          {status === "checking" ? (
            <p className="rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-slate-500">
              Checking your reset link...
            </p>
          ) : null}

          {status === "invalid" ? (
            <div className="space-y-4">
              <p className="rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
                This reset link is invalid or has expired. Request a new one to continue.
              </p>
              <Link
                href="/forgot-password"
                className="flex w-full items-center justify-center rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:-translate-y-0.5 hover:from-cyan-400 hover:to-sky-400"
              >
                Request a new reset link
              </Link>
            </div>
          ) : null}

          {status === "ready" && !updated ? (
            <form onSubmit={submit} className="space-y-4">
              <label className="block">
                <span className="text-sm font-black text-ink">New password</span>
                <input
                  value={newPassword}
                  onChange={(event) => setNewPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  aria-label="New password"
                  className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
                />
              </label>

              <label className="block">
                <span className="text-sm font-black text-ink">Confirm new password</span>
                <input
                  value={confirmPassword}
                  onChange={(event) => setConfirmPassword(event.target.value)}
                  type="password"
                  autoComplete="new-password"
                  aria-label="Confirm new password"
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
                {busy ? "Updating..." : "Update password"}
              </button>
            </form>
          ) : null}

          {status === "ready" && updated ? (
            <div className="space-y-4">
              <p className="rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
                {SUCCESS_MESSAGE}
              </p>
              <Link
                href="/login"
                className="flex w-full items-center justify-center rounded-2xl border border-cloud bg-white px-5 py-3 text-sm font-black text-ink shadow-soft transition hover:border-ocean hover:text-ocean"
              >
                Go to login now
              </Link>
            </div>
          ) : null}
        </div>
      </Card>
    </div>
  );
}
