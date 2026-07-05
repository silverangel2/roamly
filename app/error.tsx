"use client";

import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Something paused</p>
        <h1 className="mt-3 text-3xl font-black text-ink">Roamly hit a route error.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          Try again. If it repeats, this screen is ready to catch the failure without breaking the whole app.
        </p>
        {process.env.NODE_ENV === "development" ? (
          <p className="mt-3 rounded-2xl bg-mist p-3 text-xs font-bold text-slate-500">{error.message}</p>
        ) : null}
        <div className="mt-5 flex flex-col gap-3 sm:flex-row">
          <button onClick={reset} className="rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white shadow-soft transition hover:bg-ocean">
            Try again
          </button>
          <Button href="/" tone="secondary">Back home</Button>
        </div>
      </Card>
    </main>
  );
}
