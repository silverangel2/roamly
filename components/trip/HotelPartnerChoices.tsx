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
    <div className="mt-3 max-w-lg">
      {priceNote ? <p className="text-sm font-medium text-ink">{priceNote}</p> : null}
      <p className={`${priceNote ? "mt-0.5 " : ""}text-[0.8125rem] leading-5 text-slate-500`}>
        {single
          ? `Book stay options on ${partners[0].label}. Opens their search for these dates.`
          : "Book stay options — same dates and area. Choose a partner."}
      </p>
      <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {partners.map((partner, index) => {
          const primary = index === 0;
          const secondaryCount = partners.length - 1;
          const lastSecondaryAlone = !primary && index === partners.length - 1 && secondaryCount % 2 === 1;
          return (
            <div key={partner.id} className={primary || single || lastSecondaryAlone ? "sm:col-span-2" : undefined}>
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
                emphasis={primary ? "primary" : "secondary"}
              />
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[0.75rem] leading-5 text-slate-400">
        Roamly may earn a commission if you book. We don’t set the price.
      </p>
    </div>
  );
}
