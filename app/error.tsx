"use client";

import { BuiButton, BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { useI18n } from "@/components/i18n/I18nProvider";
import { localizeCustomerError } from "@/lib/i18n";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const { locale } = useI18n();
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <BuiCard className="w-full max-w-lg p-5">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cred">Let’s try that again</p>
        <h1 className="mt-3 text-3xl font-black text-chead">This page didn’t load as expected.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-cink">
          Try loading it again, or head back home and continue planning your trip.
        </p>
        {process.env.NODE_ENV === "development" ? (
        <p className="mt-3 rounded-2xl bg-cbg p-3 text-xs font-bold text-cgray">{localizeCustomerError(locale, error)}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <BuiButton onClick={reset}>
            Try again
          </BuiButton>
          <BuiButtonLink href="/" variant="secondary">Back home</BuiButtonLink>
        </div>
      </BuiCard>
    </div>
  );
}
