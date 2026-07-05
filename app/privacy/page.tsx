import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

const sections = [
  ["Data collected", "Roamly stores account email, profile name, trip inputs, itinerary data, booking fields you confirm, checklist status, payments, and basic usage counts."],
  ["Data separation", "Roamly uses roamly_ database tables and separate environment variables. ReviewIntel data must not be mixed into Roamly."],
  ["AI processing", "Trip details may be sent to the OpenAI API to generate itineraries. Locked itineraries are not regenerated."],
  ["Payments", "Stripe handles checkout. Roamly stores payment status and Stripe identifiers, not raw card numbers."],
  ["Location and reminders", "Roamly asks for location and push permission only when Live Trip Companion needs it. In-app reminders still work if phone/browser push is denied."],
  ["Your control", "You can log out, update your profile, turn off trip sensing, and contact support for account or trip data questions."]
];

export default function PrivacyPage() {
  return (
    <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <Badge>Privacy</Badge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">Roamly privacy.</h1>
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
