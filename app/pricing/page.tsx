import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const unlocks = [
  "Full day-by-day itinerary",
  "Live Trip Companion",
  "Budget breakdown",
  "Hotel area suggestions",
  "Transport guide",
  "Food and activity ideas",
  "Map search links",
  "Locked final itinerary",
  "Trip reminders and timeline",
  "Packing and emergency tips"
];

export default function PricingPage() {
  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="text-center">
        <Badge>Pricing</Badge>
        <h1 className="mx-auto mt-4 max-w-3xl text-4xl font-black tracking-tight text-ink sm:text-6xl">
          One free itinerary. Then unlock only the trip you need.
        </h1>
        <p className="mx-auto mt-3 max-w-2xl text-base font-semibold leading-7 text-slate-600">
          No subscriptions. Each account gets 1 free itinerary, then simple one-time purchases per trip.
        </p>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-4">
        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Free</p>
          <h2 className="mt-2 text-3xl font-black text-ink">$0 first itinerary</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Generate one full itinerary per account. Once generated, it is locked and cannot be edited.
          </p>
          <div className="mt-5">
            <Button href="/plan">Plan free</Button>
          </div>
        </Card>

        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Full Itinerary Unlock</p>
          <h2 className="mt-2 text-3xl font-black text-ink">$4.99 CAD</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Generate one locked day-by-day itinerary for one trip. Best when you only need the plan.
          </p>
          <div className="mt-5">
            <Button href="/plan" tone="secondary">Build first</Button>
          </div>
        </Card>

        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Live Trip Companion</p>
          <h2 className="mt-2 text-3xl font-black text-ink">$3.99 CAD</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Add reminders, document and packing checklists, booked item timeline, Day 1 activation, nearby activities, and up-next help to one locked itinerary.
          </p>
          <div className="mt-5">
            <Button href="/plan" tone="secondary">Unlock later</Button>
          </div>
        </Card>

        <Card className="border-ocean/30 bg-gradient-to-br from-white to-ocean/10">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Best value</p>
          <h2 className="mt-2 text-3xl font-black text-ink">$7.99 CAD</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
            Complete Trip Pack: full itinerary plus Live Trip Companion for one trip. Saves $0.99.
          </p>
          <div className="mt-5">
            <Button href="/plan">Create trip first</Button>
          </div>
        </Card>
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {unlocks.map((item) => (
          <div key={item} className="rounded-2xl border border-cloud bg-white/90 p-4 text-sm font-black text-ink shadow-soft">
            {item}
          </div>
        ))}
      </section>
    </main>
  );
}
