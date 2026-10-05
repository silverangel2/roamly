import { BookingRecommendationButton } from "@/components/trip/BookingRecommendationButton";
import type { HotelPartnerChoice } from "@/lib/roamly/affiliateResolver";

type HotelPartnerChoicesProps = {
  partners: HotelPartnerChoice[];
  tripId: string;
  title: string;
  recommendationId?: string | null;
  /** Shown beside the actions. Use "Price not available" when no partner price exists. */
  priceNote?: string | null;
};

export function HotelPartnerChoices({ partners, tripId, title, recommendationId = null, priceNote }: HotelPartnerChoicesProps) {
  if (!partners.length) return null;
  const single = partners.length === 1;

  return (
    <div className="mt-3">
      {priceNote ? <p className="text-sm font-black text-ink">{priceNote}</p> : null}
      <p className="mt-1 text-sm font-semibold leading-6 text-slate-600">
        {single
          ? `Book stay options on ${partners[0].label}. This opens their search for these dates.`
          : "Book stay options. Same dates and area — choose a partner."}
      </p>
      <div className="mt-2 grid grid-cols-1 gap-2 min-[420px]:grid-cols-2">
        {partners.map((partner, index) => (
          <div key={partner.id} className={single || (index === partners.length - 1 && partners.length % 2 === 1) ? "min-[420px]:col-span-2" : undefined}>
            <BookingRecommendationButton
              href={partner.href}
              label={single ? "Book stay options" : partner.label}
              tripId={tripId}
              category="hotel"
              title={title}
              provider={`${partner.label} via Stay22`}
              recommendationId={recommendationId}
              hasAffiliateUrl
              urlType="affiliate"
              fill
            />
          </div>
        ))}
      </div>
      {single ? <p className="mt-1 text-xs font-bold text-slate-500">{partners[0].label}</p> : null}
      <p className="mt-2 text-xs font-semibold leading-5 text-slate-500">
        Roamly may earn a commission if you book. We don’t set the price.
      </p>
    </div>
  );
}
