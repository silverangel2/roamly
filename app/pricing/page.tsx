import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

const featureCards = [
  {
    title: "Free start",
    body: "Create your first AI itinerary free."
  },
  {
    title: "More itinerary planning",
    body: "If you need another full itinerary, Roamly will offer an unlock when you reach that step."
  },
  {
    title: "Live Companion",
    body: "Add live reminders and trip guidance when you want Roamly with you during the trip."
  },
  {
    title: "Complete Trip Pack",
    body: "Unlock itinerary planning and companion features together when it makes sense."
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
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <section className="overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#effaff_52%,#fff0dc)] p-6 text-ink shadow-soft sm:p-10">
        <Badge tone="sun">Features</Badge>
        <h1 className="mt-4 max-w-3xl text-4xl font-black tracking-tight sm:text-6xl">
          Start free, then choose extra support only when the trip needs it.
        </h1>
        <p className="mt-4 max-w-2xl text-base font-semibold leading-7 text-slate-700">
          Roamly keeps planning first: build the route, check the budget, organize bookings, and decide on trip support
          inside the authenticated flow.
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row">
          <Button href="/plan">Start planning</Button>
          <Button href="/signup?next=/plan" tone="secondary" className="border border-ocean/20 bg-white/84 text-ink hover:border-ocean/40 hover:bg-white">
            Create your free itinerary first
          </Button>
        </div>
      </section>

      <section className="mt-8 grid gap-4 lg:grid-cols-4">
        {featureCards.map((card) => (
          <Card key={card.title} className="p-5 transition hover:-translate-y-1 hover:border-ocean/30 hover:shadow-glow">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">{card.title}</p>
            <p className="mt-4 text-sm font-bold leading-6 text-slate-600">{card.body}</p>
          </Card>
        ))}
      </section>

      <section className="mt-8">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <Badge>What Roamly can include</Badge>
            <h2 className="mt-3 text-3xl font-black tracking-tight text-ink sm:text-5xl">
              Planning tools stay clear until checkout.
            </h2>
          </div>
          <p className="max-w-md text-sm font-bold leading-6 text-slate-600">
            Exact unlock amounts appear only when you reach an authenticated checkout or trip unlock screen.
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
    </main>
  );
}
