import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function NotFound() {
  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">404</p>
        <h1 className="mt-3 text-3xl font-black text-ink">We couldn’t find that page.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          The link may be out of date, or the page may have moved. Start fresh or return to your trip.
        </p>
        <div className="mt-5 flex flex-col justify-center gap-3 sm:flex-row">
          <Button href="/">Back home</Button>
          <Button href="/plan" tone="secondary">Plan a trip</Button>
        </div>
      </Card>
    </div>
  );
}
