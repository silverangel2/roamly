export type AmazonFindProduct = {
  id: string;
  title: string;
  imageUrl: string;
  href: string;
  price: string | null;
  currency: string | null;
  saving: string | null;
  savingPercent: number | null;
  deal: boolean;
  merchant: string | null;
  availability: "in_stock";
};

type AmazonApiRecord = Record<string, unknown>;

function record(value: unknown): AmazonApiRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as AmazonApiRecord : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nested(recordValue: unknown, ...keys: string[]): AmazonApiRecord | null {
  let current = record(recordValue);
  for (const key of keys) current = record(current?.[key]);
  return current;
}

function safeAmazonLink(value: unknown, marketplaceHost: string, itemId: string, associateTag: string) {
  const raw = string(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== marketplaceHost || url.pathname.toUpperCase() !== `/DP/${itemId}`) return "";
    const tagged = new URL(`https://${marketplaceHost}/dp/${itemId}`);
    tagged.searchParams.set("tag", associateTag);
    return tagged.toString();
  } catch {
    return "";
  }
}

function safeAmazonImage(value: unknown) {
  const raw = string(value);
  if (!raw) return "";
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && ["m.media-amazon.com", "images-na.ssl-images-amazon.com", "images-eu.ssl-images-amazon.com"].includes(url.hostname)
      ? url.toString()
      : "";
  } catch {
    return "";
  }
}

export function amazonFindProductFromApi(value: unknown, marketplaceHost: string, associateTag: string): AmazonFindProduct | null {
  const item = record(value);
  if (!item) return null;
  const title = string(nested(item.itemInfo, "title")?.displayValue);
  const imageUrl = safeAmazonImage(
    nested(item.images, "primary", "large")?.url || nested(item.images, "primary", "medium")?.url
  );
  const id = string(item.asin).toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(id)) return null;
  const href = safeAmazonLink(item.detailPageURL, marketplaceHost, id, associateTag);
  const listings = record(item.offersV2)?.listings;
  const listing = Array.isArray(listings)
    ? listings.map(record).find((offer) => string(nested(offer?.availability)?.type).toUpperCase() === "IN_STOCK") || null
    : null;
  const availability = string(nested(listing?.availability)?.type).toUpperCase();
  const price = nested(listing?.price, "money");
  const savings = nested(listing?.price, "savings");
  const savingMoney = nested(savings, "money");
  const amount = string(price?.displayAmount);
  const savingAmount = string(savingMoney?.displayAmount);
  const savingPercent = typeof savings?.percentage === "number" && Number.isFinite(savings.percentage)
    ? savings.percentage
    : null;
  if (!title || !imageUrl || !href || availability !== "IN_STOCK") return null;

  return {
    id,
    title,
    imageUrl,
    href,
    price: amount || null,
    currency: string(price?.currency) || null,
    saving: savingAmount || null,
    savingPercent,
    deal: Boolean(savingPercent && savingPercent > 0),
    merchant: string(nested(listing?.merchantInfo)?.name) || null,
    availability: "in_stock"
  };
}
