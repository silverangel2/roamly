import Script from "next/script";

type AdContainerProps = {
  adSlot?: string;
  ariaLabel?: string;
  children?: React.ReactNode;
  className?: string;
};

export function AdContainer({
  adSlot,
  ariaLabel = "Travel partner placement",
  children,
  className = ""
}: AdContainerProps) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_ADSENSE_CLIENT;

  return (
    <aside
      aria-label={ariaLabel}
      data-no-translate
      className={`min-h-24 rounded-[1.5rem] border border-cloud bg-white/55 shadow-soft ${className}`}
    >
      {clientId && adSlot ? (
        <>
          <Script
            id="roamly-adsense"
            async
            strategy="afterInteractive"
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${clientId}`}
            crossOrigin="anonymous"
          />
          <ins
            className="adsbygoogle block h-full w-full"
            data-ad-client={clientId}
            data-ad-slot={adSlot}
            data-ad-format="auto"
            data-full-width-responsive="true"
          />
        </>
      ) : (
        children
      )}
    </aside>
  );
}
