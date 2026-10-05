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
    <div className="mt-3 min-w-0 max-w-lg">
      {priceNote ? <p className="text-sm font-medium text-ink">{priceNote}</p> : null}
      <p className={`${priceNote ? "mt-0.5 " : ""}text-[0.8125rem] leading-5 text-slate-500`}>
        {single
          ? `Book stay options on ${partners[0].label}. Opens their search for these dates.`
          : "Same dates and area. Choose a partner."}
      </p>
      <div className="roamly-partner-row mt-2 flex gap-1 overflow-x-auto pb-0.5">
        {partners.map((partner, index) => {
          const primary = index === 0;
          return (
            <BookingRecommendationButton
              key={partner.id}
              href={partner.href}
              label={single ? "Book stay options" : partner.label}
              tripId={tripId}
              category="hotel"
              title={title}
              provider={`${partner.label} via Stay22`}
              recommendationId={recommendationId}
              hasAffiliateUrl
              urlType="affiliate"
              compact
              emphasis={primary ? "primary" : "secondary"}
            />
          );
        })}
      </div>
      <p className="mt-2 text-[0.75rem] leading-5 text-slate-400">
        Roamly may earn a commission if you book. We don’t set the price.
      </p>
    </div>
  );
}
