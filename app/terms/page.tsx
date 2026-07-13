import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

const sections = [
  [
    "Service",
    "Roamly provides AI-generated travel planning assistance, 1 free itinerary per account, paid full itinerary unlocks, and live trip organization tools."
  ],
  [
    "User responsibility",
    "You must verify opening hours, prices, visa rules, passport requirements, booking terms, transit schedules, weather, safety conditions, and local laws before traveling."
  ],
  [
    "Payments and refunds",
    "Paid Full Itinerary Unlocks, Live Trip Companion add-ons, and Complete Trip Packs are one-time digital purchases. Once generated, an itinerary is locked and cannot be remade or regenerated."
  ],
  [
    "No guaranteed availability",
    "Roamly may suggest places, areas, searches, and map queries, but it does not guarantee availability, safety, accuracy, or booking completion."
  ],
  [
    "Affiliate and booking links",
    "Roamly may earn a commission when you book or shop through partner links. This does not change your price."
  ]
];

export default function TermsPage() {
  return (
    <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Badge>Terms</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Roamly terms.</h1>
      <div className="mt-7 grid gap-4">
        {sections.map(([title, text]) => (
          <Card key={title}>
            <h2 className="text-2xl font-black text-ink">{title}</h2>
            <p className="mt-2 text-sm font-semibold leading-7 text-slate-600">{text}</p>
          </Card>
        ))}
      </div>
    </main>
  );
}
