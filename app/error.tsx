"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useI18n();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Let’s try that again</p>
        <h1 className="mt-3 text-3xl font-black text-ink">This page didn’t load as expected.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          Try loading it again, or head back home and continue planning your trip.
        </p>
        {process.env.NODE_ENV === "development" ? (
        <p className="mt-3 rounded-2xl bg-mist p-3 text-xs font-bold text-slate-500">{localizeCustomerError(locale, error)}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button onClick={reset} className="rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-5 py-3 text-sm font-black text-white shadow-lg shadow-cyan-500/20 transition hover:from-cyan-400 hover:to-sky-400">
            Try again
          </button>
          <Button href="/" tone="secondary">Back home</Button>
        </div>
      </Card>
    </div>
  );
}
