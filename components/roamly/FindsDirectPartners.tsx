import { buildKlookSearchUrl } from "@/lib/roamly/affiliateResolver";
import { buildAmazonSearchUrl } from "@/lib/roamly/amazonAffiliate";
import { ROAMLY_AMAZON_CURATED_TAG } from "@/lib/roamly/curatedAmazonFinds";
import { findsTravelServices, findsWidgets } from "@/lib/roamly/findsCommercialConfig";

type PartnerCard = {
  eyebrow: string;
  title: string;
  description: string;
  href: string;
  provider: string;
};

function partnerCards(): PartnerCard[] {
  const klookUrl = buildKlookSearchUrl("travel activities");

  return [
    {
      eyebrow: "Stay22",
      title: "Book your stay",
      description: "Open Stay22 and confirm the partner's final rate, room, and availability.",
      href: findsTravelServices.stays.href,
      provider: "Open Stay22"
    },
    {
      eyebrow: "Travelpayouts · Aviasales",
      title: "Find flights",
      description: "Open the Aviasales search experience. Roamly does not verify live fares on this page.",
      href: findsWidgets.flights.src,
      provider: "Open flight search"
    },
    {
      eyebrow: "Klook",
      title: "Book activities",
      description: "Browse activity options on Klook and confirm date-specific availability and terms there.",
      href: klookUrl,
      provider: "Open Klook"
    },
    {
      eyebrow: "Amazon Associates",
      title: "Shop travel gear",
      description: "Browse travel essentials on Amazon.ca. Prices, stock, and seller details can change.",
      href: buildAmazonSearchUrl("travel gear essentials", {
        marketplace: "amazon.ca",
        associateTag: ROAMLY_AMAZON_CURATED_TAG,
        enabled: true
      }),
      provider: "Open Amazon"
    },
    {
      eyebrow: "Travelpayouts eSIM",
      title: "Get an eSIM",
      description: "Compare travel eSIM options and check coverage and device compatibility before buying.",
      href: findsWidgets.esim.src,
      provider: "Open eSIM options"
    }
  ].filter((card) => Boolean(card.href));
}

export function FindsDirectPartners() {
  return (
    <section aria-labelledby="finds-heading" className="mx-auto max-w-5xl">
      <div className="mb-6 max-w-2xl">
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-[#0f6e66]">Travel partners</p>
        <h1 id="finds-heading" className="mt-2 text-3xl font-black tracking-tight text-[#203c43] sm:text-4xl">Make the trip happen</h1>
        <p className="mt-3 text-base leading-7 text-[#5c716c]">Start with a trusted travel partner. Each option opens the partner destination directly; Roamly does not invent prices or availability.</p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {partnerCards().map((card) => (
          <a
            key={card.title}
            href={card.href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex min-h-44 flex-col justify-between rounded-[1.5rem] border border-[#d9e4de] bg-white p-6 shadow-[0_10px_28px_rgba(32,60,67,0.06)] transition hover:-translate-y-0.5 hover:border-[#9fc8bb] hover:shadow-[0_16px_34px_rgba(32,60,67,0.12)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#9fc8bb]/50"
          >
            <span>
              <span className="text-xs font-extrabold uppercase tracking-[0.14em] text-[#0f6e66]">{card.eyebrow}</span>
              <span className="mt-3 block text-2xl font-black tracking-tight text-[#203c43]">{card.title}</span>
              <span className="mt-2 block text-sm leading-6 text-[#5c716c]">{card.description}</span>
            </span>
            <span className="mt-6 inline-flex min-h-12 items-center justify-center rounded-full bg-[#0f6e66] px-5 text-sm font-extrabold text-white transition group-hover:bg-[#0b5b55]">{card.provider}<span aria-hidden="true" className="ml-2">↗</span></span>
          </a>
        ))}
      </div>
    </section>
  );
}
