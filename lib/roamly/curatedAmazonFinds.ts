import { buildAmazonSearchUrl } from "@/lib/roamly/amazonAffiliate";
import type { FindsCard } from "@/lib/roamly/findsMarketCore";

export const ROAMLY_AMAZON_CURATED_TAG = "roamly060-20";

type CuratedAmazonFind = {
  id: string;
  title: string;
  searchQuery: string;
  reason: string;
  action: string;
  icon: string;
  tone: string;
};

const curatedFinds: readonly CuratedAmazonFind[] = [
  { id: "travel-adapter", title: "Universal travel adapter", searchQuery: "universal travel adapter", reason: "A useful starting point for international trips.", action: "Shop adapters", icon: "↯", tone: "from-[#dff3e8] to-[#f5fbf4]" },
  { id: "packing-cubes", title: "Packing cubes", searchQuery: "packing cubes travel organizer", reason: "Make room for the things you actually want to bring.", action: "Find packing cubes", icon: "▦", tone: "from-[#e5eef7] to-[#f7fafc]" },
  { id: "portable-charger", title: "Portable charger", searchQuery: "portable charger travel power bank", reason: "Keep maps, tickets, and messages within reach.", action: "Browse chargers", icon: "⚡", tone: "from-[#fff0d8] to-[#fffaf1]" },
  { id: "travel-pillow", title: "Travel pillow", searchQuery: "travel pillow", reason: "A little more comfort for the long way there.", action: "Explore travel pillows", icon: "◒", tone: "from-[#eee7f7] to-[#fbf8fd]" },
  { id: "luggage-scale", title: "Luggage scale", searchQuery: "digital luggage scale travel", reason: "A simple check before the return journey.", action: "Browse luggage scales", icon: "⌁", tone: "from-[#e8f3ef] to-[#f8fbf9]" },
  { id: "toiletry-organizer", title: "Toiletry organizer", searchQuery: "travel toiletry organizer", reason: "Keep smaller essentials easy to find.", action: "Find organizers", icon: "□", tone: "from-[#f7e9e3] to-[#fff9f6]" },
  { id: "cable-organizer", title: "Cable organizer", searchQuery: "travel cable organizer pouch", reason: "Less untangling when it is time to charge.", action: "Browse cable organizers", icon: "⟲", tone: "from-[#e5f0f3] to-[#f7fbfc]" },
  { id: "travel-bottles", title: "Reusable travel bottles", searchQuery: "reusable travel toiletry bottles", reason: "A tidy way to carry the everyday essentials.", action: "Find travel bottles", icon: "◌", tone: "from-[#f1eddf] to-[#fcfbf5]" }
] as const;

export function curatedAmazonFindCards(): FindsCard[] {
  return curatedFinds.map((item) => ({
    id: `amazon-curated-${item.id}`,
    title: item.title,
    eyebrow: "Travel edit",
    description: item.reason,
    href: buildAmazonSearchUrl(item.searchQuery, {
      marketplace: "amazon.ca",
      associateTag: ROAMLY_AMAZON_CURATED_TAG,
      enabled: true
    }),
    provider: "Amazon Associates",
    affiliate: true,
    category: "product",
    icon: item.icon,
    action: item.action,
    image: null,
    imageAlt: "",
    recommendationLabel: "curated-category",
    price: null,
    saving: null,
    savingPercent: null
  }));
}

export function curatedAmazonFindPresentation(id: string) {
  const item = curatedFinds.find((candidate) => `amazon-curated-${candidate.id}` === id);
  return item ? { icon: item.icon, tone: item.tone } : { icon: "✦", tone: "from-[#e8f4ec] to-[#f8fbf7]" };
}
