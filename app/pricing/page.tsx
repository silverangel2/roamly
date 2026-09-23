import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const plans = [
  {
    title: "Free itinerary",
    price: "$0",
    unit: "one per account",
    body: "Build one complete custom trip itinerary at no cost."
  },
  {
    title: "Full Itinerary",
    price: "$4.99 CAD",
    unit: "per trip · one-time",
    body: "Unlock one custom, day-by-day itinerary with budget, hotel-area, transport, food, and activity guidance."
  },
  {
    title: "Live Trip Companion",
    price: "$3.99 CAD",
    unit: "per trip · one-time",
    body: "Add pre-trip reminders, a booking timeline, nearby activity ideas, and up-next help to an unlocked itinerary."
  },
  {
    title: "Complete Trip Pack",
    price: "$7.99 CAD",
    unit: "per trip · one-time",
    body: "Get the full itinerary and Live Trip Companion together for one trip."
  }
];

const included = [
  "Full day-by-day itinerary",
  "Budget breakdown",
  "Hotel area suggestions",
  "Transport guide",
  "Food and activity ideas",
  "Map search links",
  "Locked final itinerary",
  "Trip reminders and timeline",
  "Packing and emergency tips",
  "Booking-aware planning"
];

export default function PricingPage() {
  return (
    <div className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#effaff_52%,#fff0dc)] p-6 text-ink shadow-soft sm:p-10">
        <Badge tone="sun">Simple trip pricing</Badge>
        <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
          A better trip plan, with clear one-time prices.
        </h1>
        <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-700">
          Plan your first trip free. Add a full itinerary or live support when you need it. No subscriptions.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button href="/plan">Start planning</Button>
          <Button href="/signup?next=/plan" tone="secondary" className="border border-ocean/20 bg-white/84 text-ink hover:border-ocean/40 hover:bg-white">
            Create your free account
          </Button>
        </div>
      </section>

      <section className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {plans.map((plan) => (
          <Card key={plan.title} className={`p-5 ${plan.title === "Complete Trip Pack" ? "border-ocean/40 bg-[#effaff] shadow-glow" : ""}`}>
            <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">{plan.title}</p>
            <p className="mt-5 text-3xl font-black tracking-tight text-ink">{plan.price}</p>
            <p className="mt-1 text-xs font-bold text-slate-500">{plan.unit}</p>
            <p className="mt-4 text-sm font-semibold leading-6 text-slate-600">{plan.body}</p>
          </Card>
        ))}
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge>Included with a full itinerary</Badge>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-5xl">
              The details that make a trip easier to follow.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            You’ll see the selected trip and one-time total again before paying.
          </p>
        </div>
        <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {included.map((item) => (
            <div key={item} className="rounded-2xl border border-cloud bg-white/90 p-4 text-sm font-black text-ink shadow-soft">
              {item}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
