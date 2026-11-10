import type { Metadata } from "next";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiCard } from "@/components/boardui/Card";

// SEO (consolidation 2026-11-06, Block I / SEO-FIX-3): this page
// shipped the HOMEPAGE title + description with og:url at the
// root. It now carries its own title, description, canonical,
// and og:url.
export const metadata: Metadata = {
  title: "Terms of Service",
  description:
    "The terms for using Roamly: what the service provides, one-time trip pricing, Live Companion and Booking Recon, and your responsibilities as a traveller.",
  alternates: { canonical: "https://roamlyhq.com/terms" },
  openGraph: {
    title: "Roamly Terms of Service",
    description:
      "What Roamly provides, how one-time trip pricing works, and the terms that govern Live Companion and Booking Recon.",
    url: "https://roamlyhq.com/terms",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

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
    <div className="safe-bottom mx-auto w-full max-w-4xl px-4 py-8 sm:px-6">
      <BuiBadge>Terms</BuiBadge>
      <h1 className="mt-4 text-4xl font-black tracking-tight text-chead sm:text-6xl">Roamly terms.</h1>
      <div className="mt-7 grid gap-4">
        {sections.map(([title, text]) => (
          <BuiCard key={title} className="p-5">
            <h2 className="text-2xl font-black text-chead">{title}</h2>
            <p className="mt-2 text-sm font-semibold leading-7 text-cink">{text}</p>
          </BuiCard>
        ))}
      </div>
    </div>
  );
}
