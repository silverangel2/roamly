import { AdContainer } from "@/components/AdContainer";

type TravelPartnerPlacementVariant = "horizontal" | "native" | "footer";

type TravelPartnerPlacementProps = {
  variant: TravelPartnerPlacementVariant;
  label?: string;
  className?: string;
};

const adsenseSlots: Record<TravelPartnerPlacementVariant, string | undefined> = {
  horizontal: process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_SLOT_HOME_HORIZONTAL,
  native: process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_SLOT_HOME_NATIVE,
  footer: process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_SLOT_HOME_FOOTER
};

const placementContent: Record<
  TravelPartnerPlacementVariant,
  {
    eyebrow: string;
    title: string;
    body: string;
    outerClassName: string;
    adClassName: string;
  }
> = {
  horizontal: {
    eyebrow: "Trip planning match",
    title: "Relevant travel options can meet travelers here.",
    body: "Relevant stays, tours, and transport can appear here when partner placements are enabled.",
    outerClassName: "py-8 sm:py-10",
    adClassName:
      "overflow-hidden rounded-[1.65rem] border-white/90 bg-white/82 shadow-[0_18px_55px_rgba(16,32,51,0.1)] backdrop-blur-xl"
  },
  native: {
    eyebrow: "Native travel picks",
    title: "Partner recommendations can sit beside destination inspiration.",
    body: "Relevant stays, tours, and transport can appear here when partner placements are enabled.",
    outerClassName: "pb-12 pt-0 sm:pb-16",
    adClassName:
      "overflow-hidden rounded-[1.85rem] border-white/90 bg-white/86 shadow-[0_22px_70px_rgba(16,32,51,0.12)] backdrop-blur-xl"
  },
  footer: {
    eyebrow: "Before travelers book",
    title: "Travel partners can support the next step.",
    body: "Relevant stays, tours, and transport can appear here when partner placements are enabled.",
    outerClassName: "py-8 sm:py-10",
    adClassName:
      "overflow-hidden rounded-[1.65rem] border-white/90 bg-white/84 shadow-[0_18px_55px_rgba(16,32,51,0.1)] backdrop-blur-xl"
  }
};

const nativeCategories = ["Stays", "Tours", "Transport"];

export function TravelPartnerPlacement({
  variant,
  label,
  className = ""
}: TravelPartnerPlacementProps) {
  const content = placementContent[variant];
  const displayLabel = label ?? (variant === "native" ? "Sponsored" : "Travel partner");

  return (
    <section
      className={`mx-auto w-full max-w-6xl px-4 sm:px-6 ${content.outerClassName} ${className}`}
      data-monetization-placement="travel-partner"
      data-placement-variant={variant}
    >
      <AdContainer
        adSlot={adsenseSlots[variant]}
        ariaLabel={`${displayLabel} placement`}
        className={content.adClassName}
      >
        <div className="relative bg-[linear-gradient(135deg,rgba(255,255,255,0.96),rgba(239,250,255,0.82)_54%,rgba(255,250,242,0.92))] p-5 text-ink sm:p-6 lg:p-7">
          <div className="grid gap-5 lg:grid-cols-[1fr_auto] lg:items-center">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex rounded-full border border-ocean/15 bg-white/90 px-3 py-1.5 text-[0.68rem] font-black uppercase tracking-[0.14em] text-ocean shadow-[0_8px_22px_rgba(16,32,51,0.06)]">
                  {displayLabel}
                </span>
                <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
                  {content.eyebrow}
                </span>
              </div>
              <h2 className="mt-3 max-w-2xl text-xl font-black tracking-tight text-ink sm:text-2xl">
                {content.title}
              </h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">
                {content.body}
              </p>
            </div>

            {variant === "native" ? (
              <div className="grid gap-3 sm:grid-cols-3 lg:w-[28rem]">
                {nativeCategories.map((category) => (
                  <div
                    key={category}
                    className="rounded-[1.15rem] border border-cloud/90 bg-white/82 p-4 shadow-[0_12px_30px_rgba(16,32,51,0.07)]"
                  >
                    <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
                      {category}
                    </p>
                    <p className="mt-2 text-sm font-black leading-5 text-ink">
                      Partner offers can appear here.
                    </p>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-[1.15rem] border border-cloud/90 bg-white/78 p-4 shadow-[0_12px_30px_rgba(16,32,51,0.07)] lg:w-72">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-ocean">
                  Stays, tours, transport
                </p>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                  Built for future hotel, activity, affiliate, and travel network placements.
                </p>
              </div>
            )}
          </div>
        </div>
      </AdContainer>
    </section>
  );
}
