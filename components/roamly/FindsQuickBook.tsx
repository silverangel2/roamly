import { buildKlookSearchUrl } from "@/lib/roamly/affiliateResolver";
import { ArrowUpRight } from "lucide-react";
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
  return <nav aria-label="Quick Book" className="mb-7 overflow-x-auto rounded-2xl border border-[#DCE5F0] bg-white/85 p-2 shadow-bui-card sm:mb-10">
    <div className="flex min-w-max items-center gap-1.5">
      <span className="px-3 text-[10px] font-black uppercase tracking-[0.18em] text-[#087BFF]">Quick Book</span>
      {quickBookItems.map((item) => <a key={item.label} href={item.href} target={item.external ? "_blank" : undefined} rel={item.external ? "noopener noreferrer" : undefined} className="inline-flex min-h-11 items-center rounded-xl border border-transparent px-3.5 text-xs font-black text-[#657795] transition hover:border-[#DCE5F0] hover:bg-[#E6EFFA] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-[#087BFF]/20">{item.label}{item.external ? <ArrowUpRight aria-hidden="true" size={14} strokeWidth={2.5} className="ml-1.5" /> : null}</a>)}
    </div>
  </nav>;
}
