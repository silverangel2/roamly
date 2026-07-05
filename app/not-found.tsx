import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-5xl items-center justify-center px-4 py-10">
      <Card className="w-full max-w-lg text-center">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">404</p>
        <h1 className="mt-3 text-3xl font-black text-ink">This trip path is not packed yet.</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
          The route does not exist, or it belongs to a later Roamly phase.
        </p>
        <div className="mt-5">
          <Button href="/">Back home</Button>
        </div>
      </Card>
    </main>
  );
}
