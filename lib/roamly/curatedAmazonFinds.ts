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
  illustration: string;
  illustrationAlt: string;
};

const curatedFinds: readonly CuratedAmazonFind[] = [
  { id: "travel-adapter", title: "Universal travel adapter", searchQuery: "universal travel adapter", reason: "A useful starting point for international trips.", action: "Shop adapters", icon: "↯", illustration: "/images/finds/travel-adapter.webp", illustrationAlt: "Illustrative universal travel adapter" },
  { id: "packing-cubes", title: "Packing cubes", searchQuery: "packing cubes travel organizer", reason: "Make room for the things you actually want to bring.", action: "Find packing cubes", icon: "▦", illustration: "/images/finds/packing-cubes.webp", illustrationAlt: "Illustrative pair of fabric packing cubes" },
  { id: "portable-charger", title: "Portable charger", searchQuery: "portable charger travel power bank", reason: "Keep maps, tickets, and messages within reach.", action: "Browse chargers", icon: "⚡", illustration: "/images/finds/portable-charger.webp", illustrationAlt: "Illustrative portable charger and cable" },
  { id: "travel-pillow", title: "Travel pillow", searchQuery: "travel pillow", reason: "A little more comfort for the long way there.", action: "Explore travel pillows", icon: "◒", illustration: "/images/finds/travel-pillow.webp", illustrationAlt: "Illustrative teal travel neck pillow" },
  { id: "luggage-scale", title: "Luggage scale", searchQuery: "digital luggage scale travel", reason: "A simple check before the return journey.", action: "Browse luggage scales", icon: "⌁", illustration: "/images/finds/luggage-scale.webp", illustrationAlt: "Illustrative digital luggage scale" },
  { id: "toiletry-organizer", title: "Toiletry organizer", searchQuery: "travel toiletry organizer", reason: "Keep smaller essentials easy to find.", action: "Find organizers", icon: "□", illustration: "/images/finds/toiletry-organizer.webp", illustrationAlt: "Illustrative hanging toiletry organizer" },
  { id: "cable-organizer", title: "Cable organizer", searchQuery: "travel cable organizer pouch", reason: "Less untangling when it is time to charge.", action: "Browse cable organizers", icon: "⟲", illustration: "/images/finds/cable-organizer.webp", illustrationAlt: "Illustrative travel cable organizer pouch" },
  { id: "travel-bottles", title: "Reusable travel bottles", searchQuery: "reusable travel toiletry bottles", reason: "A tidy way to carry the everyday essentials.", action: "Find travel bottles", icon: "◌", illustration: "/images/finds/travel-bottles.webp", illustrationAlt: "Illustrative reusable travel toiletry bottles" }
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
  return item ? { illustration: item.illustration, illustrationAlt: item.illustrationAlt } : { illustration: "/images/finds/travel-adapter.webp", illustrationAlt: "Illustrative travel essential" };
}
