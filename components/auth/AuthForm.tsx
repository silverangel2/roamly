"use client";

import { useState } from "react";
import Link from "next/link";
import { hasSupabaseConfig } from "@/lib/supabase/config";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type AuthFormProps = {
  mode: "login" | "signup";
  nextPath?: string;
};

export function AuthForm({ mode, nextPath = "/dashboard" }: AuthFormProps) {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const isSignup = mode === "signup";
  const configured = hasSupabaseConfig();

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setNotice("");

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

      if (isSignup) {
        const redirectTo = `${window.location.origin}/auth/callback?next=${encodeURIComponent(nextPath)}`;
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectTo,
            data: {
              full_name: fullName.trim()
            }
          }
        });

        if (signUpError) throw signUpError;

        if (data.session) {
          await fetch("/api/account/profile", {
            method: "PATCH",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ fullName: fullName.trim() })
          });
          window.location.href = nextPath;
          return;
        }

        setNotice("Check your email to verify your Roamly account, then log in.");
        return;
      }

      const { error: loginError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password
      });

      if (loginError) throw loginError;

      await fetch("/api/account/profile", { method: "GET" });
      window.location.href = nextPath;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Authentication failed.");
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
          Add NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY to enable signup and login.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      {isSignup ? (
        <label className="block">
          <span className="text-sm font-black text-ink">Full name</span>
          <input
            value={fullName}
            onChange={(event) => setFullName(event.target.value)}
            autoComplete="name"
            className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
            placeholder="Traveler name"
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
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          placeholder="you@example.com"
        />
      </label>

      <label className="block">
        <span className="text-sm font-black text-ink">Password</span>
        <input
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          type="password"
          autoComplete={isSignup ? "new-password" : "current-password"}
          className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-bold text-ink outline-none transition focus:border-ocean focus:ring-4 focus:ring-ocean/10"
          placeholder={isSignup ? "At least 8 characters" : "Your password"}
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

      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:-translate-y-0.5 hover:bg-ocean disabled:translate-y-0 disabled:opacity-60"
      >
        {busy ? "Working..." : isSignup ? "Create free account" : "Log in"}
      </button>

      <p className="text-center text-sm font-bold text-slate-500">
        {isSignup ? "Already have an account?" : "New to Roamly?"}{" "}
        <Link href={isSignup ? "/login" : "/signup"} className="text-ocean hover:text-ink">
          {isSignup ? "Log in" : "Create account"}
        </Link>
      </p>
    </form>
  );
}
