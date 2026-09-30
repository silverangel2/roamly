import { buildKlookSearchUrl } from "@/lib/roamly/affiliateResolver";
import { buildAmazonSearchUrl } from "@/lib/roamly/amazonAffiliate";
import { ROAMLY_AMAZON_CURATED_TAG } from "@/lib/roamly/curatedAmazonFinds";
import { findsTravelServices } from "@/lib/roamly/findsCommercialConfig";

const quickBookItems = [
  { label: "Stay", href: findsTravelServices.stays.href, external: true },
  { label: "Flights", href: "#finds-flight-widget", external: false },
  { label: "Activities", href: buildKlookSearchUrl("travel activities"), external: true },
  { label: "Gear", href: buildAmazonSearchUrl("travel gear essentials", { marketplace: "amazon.ca", associateTag: ROAMLY_AMAZON_CURATED_TAG, enabled: true }), external: true },
  { label: "eSIM", href: "#finds-esim-widget", external: false }
].filter((item) => Boolean(item.href));

export function FindsQuickBook() {
  return <nav aria-label="Quick Book" className="mb-7 overflow-x-auto rounded-2xl border border-[#dce7dc] bg-white/85 p-2 shadow-[0_8px_24px_rgba(32,60,67,0.05)] sm:mb-10">
    <div className="flex min-w-max items-center gap-1.5">
      <span className="px-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#0f6e66]">Quick Book</span>
      {quickBookItems.map((item) => <a key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} className="inline-flex min-h-10 items-center rounded-xl border border-transparent px-3.5 text-xs font-black text-[#365f56] transition hover:border-[#b8d6c7] hover:bg-[#f1f7f1] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#0f6e66]/20">{item.label}{item.external ? <span aria-hidden="true" className="ml-1.5">↗</span> : null}</a>)}
    </div>
  </nav>;
}
