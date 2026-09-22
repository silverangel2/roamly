import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";

const sections = [
  ["Data we collect", "Roamly stores account details, trip destinations and dates, traveler and budget choices, itinerary content, saved booking and checklist details, and basic product usage. If you use traveler memory, Roamly also stores travel preferences you provide, which may include your passport-issuing country. Trip feedback can include ratings, activity choices, and free-text comments linked to that trip."],
  ["Where trip data is stored", "Roamly uses a dedicated Supabase project for account and trip records. The database includes tables with different names; the roamly_ prefix is not a complete list of where app data is stored."],
  ["Travel email import", "If you connect Gmail, Roamly requests read-only access to identify travel confirmations and changes. Messages the travel filter identifies are saved as limited metadata (sender, subject, and received date) plus structured booking facts; Roamly does not retain the raw email body. For matching messages, the sender, subject, Gmail snippet, and up to 6,000 characters of text preview may be sent to OpenAI for booking extraction. Messages that do not pass the travel filter are skipped and not saved. Disconnecting Gmail revokes the connection and clears stored access credentials, but does not automatically delete message metadata or booking details already saved to a trip."],
  ["AI processing", "Trip details may be sent to the OpenAI API to generate itineraries. Matching Gmail content may also be sent there to extract booking details. Locked itineraries are not regenerated."],
  ["Payments", "Stripe handles checkout. Roamly stores payment status and Stripe identifiers, not raw card numbers."],
  ["Location and reminders", "If you enable trip sensing and grant location permission, Roamly uses your location for trip activation and nearby itinerary features. You can turn trip sensing off in Account. Push notifications require separate browser or phone permission; in-app reminders remain available if push is denied."],
  ["Travel memory and controls", "You can review and edit saved travel preferences, turn personalization off, or delete travel memory in Account. Deleting travel memory does not delete trip feedback, saved bookings, or itinerary data."],
  ["Facebook and Meta", "Roamly uses Meta/Facebook APIs only for Roamly-owned Facebook Page functionality, including publishing Roamly-generated social content and checking Page and publication information. An authorized Page connection provides Page identifiers, Page name, available Page tasks, and a Page access token to Roamly's server. Roamly does not use customer Facebook profiles for trip planning, and does not sell Facebook or Meta data. Page connection credentials are kept on the server and are not exposed in the browser."],
  ["User data deletion", "You may request deletion of personal data associated with your Roamly account by emailing support@roamlyhq.com. Include the email address on the Roamly account, your name, and enough information to locate the account or trip involved. We may retain limited information when necessary for legitimate legal, accounting, fraud-prevention, security, or dispute-resolution obligations."],
  ["Your control and contact", "You can log out, update your profile, disconnect Gmail, edit or delete traveler memory, turn off trip sensing, and contact Roamly about account or trip data. Email support@roamlyhq.com for privacy, deletion, or support requests."]
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
