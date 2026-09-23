export type FindsCard = {
  id: string;
  title: string;
  eyebrow: string;
  description: string;
  href: string;
  provider: string;
  affiliate: boolean;
  category: "hotel" | "flight" | "activity" | "product" | "transport";
  icon: string;
  action: string;
  image: string;
  imageAlt: string;
  price?: string | null;
  priceNote?: string | null;
  recommendationLabel?: string | null;
  saving?: string | null;
  savingPercent?: number | null;
  checkedAt?: string | null;
};

type RecordValue = Record<string, unknown>;

function record(value: unknown): RecordValue | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function providerUrl(value: unknown, host: "booking.com" | "klook.com" | "aviasales.com" | "stay22.com") {
  try {
    const url = new URL(string(value));
    if (url.protocol !== "https:" || (url.hostname !== host && !url.hostname.endsWith(`.${host}`))) return "";
    if (host === "stay22.com" && /\b(app|admin|partner|partners|dashboard|login|signin|sign-in|account|referral)\b/i.test(`${url.hostname} ${url.pathname}`)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function providerImage(value: unknown, host: "bstatic.com" | "klook.com") {
  try {
    const url = new URL(string(value));
    return url.protocol === "https:" && (url.hostname === host || url.hostname.endsWith(`.${host}`)) ? url.toString() : "";
  } catch {
    return "";
  }
}

function formatPrice(amount: unknown, currency: unknown) {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount <= 0) return "";
  if (typeof currency !== "string" || !/^[A-Z]{3}$/.test(currency)) return "";
  try {
    return new Intl.NumberFormat("en", { style: "currency", currency }).format(amount);
  } catch {
    return "";
  }
}

function listingBase(value: unknown, source: string, category: FindsCard["category"], host: "booking.com" | "klook.com" | "aviasales.com", imageHost: "bstatic.com" | "klook.com" | "none") {
  const result = record(value);
  if (!result || result.source !== source || result.price_type !== "live_partner") return null;
  const metadata = record(result.metadata);
  const providerPayload = record(metadata?.providerPayload);
  const title = string(result.title);
  const href = providerUrl(result.booking_url, host);
  const image = imageHost === "none" ? "" : imageHost === "bstatic.com"
    ? (Array.isArray(providerPayload?.photo_urls) ? providerPayload.photo_urls : []).map((item) => providerImage(item, imageHost)).find(Boolean) || ""
    : klookImage(providerPayload, imageHost);
  const price = formatPrice(result.price_amount, result.currency);
  if (!title || !href || (imageHost !== "none" && !image) || !price) return null;
  return { result, providerPayload: providerPayload || {}, title, href, image, price, category };
}

function klookImage(payload: RecordValue | null, host: "klook.com") {
  if (!payload) return "";
  const candidates: unknown[] = [
    payload.image_url, payload.imageUrl, payload.cover_image_url, payload.coverImageUrl,
    payload.cover_image, payload.coverImage, payload.main_image, payload.mainImage, payload.image
  ];
  const images = payload.images;
  if (Array.isArray(images)) candidates.push(...images.flatMap((item) => {
    const image = record(item);
    return [typeof item === "string" ? item : null, image?.url, image?.src, image?.image_url];
  }));
  else {
    const image = record(images);
    candidates.push(image?.cover, image?.main, image?.primary);
  }
  return candidates.map((item) => {
    const image = record(item);
    return providerImage(typeof item === "string" ? item : image?.url || image?.src, host);
  }).find(Boolean) || "";
}

export function bookingFindCard(value: unknown): FindsCard | null {
  const base = listingBase(value, "booking_demand", "hotel", "booking.com", "bstatic.com");
  if (!base || base.providerPayload.availability_status !== "available") return null;
  const stay22Url = providerUrl(base.result.affiliate_url, "stay22.com");
  const bookingUrl = stay22Url || base.href;
  return {
    id: string(base.result.id) || bookingUrl,
    title: base.title,
    eyebrow: "Where to stay",
    description: stay22Url
      ? "A current stay result for your selected dates. Check the property, final price, taxes, room, and cancellation terms before booking."
      : "A current stay total for your selected dates. Check final taxes, cancellation terms, and room details before booking.",
    href: bookingUrl,
    provider: stay22Url ? "Booking.com via Stay22" : "Booking.com",
    // Booking Demand results require the Booking.com affiliate ID; Stay22 is the preferred handoff when configured.
    affiliate: true,
    category: base.category,
    icon: "⌂",
    action: stay22Url ? "Continue to Booking.com" : "See rooms & book",
    image: base.image,
    imageAlt: `${base.title} property photo`,
    price: base.price,
    priceNote: "total for selected stay",
    recommendationLabel: string(base.result.recommendation_label) || null,
    checkedAt: string(base.result.searched_at) || null
  };
}

export function klookFindCard(value: unknown): FindsCard | null {
  const base = listingBase(value, "klook", "activity", "klook.com", "klook.com");
  if (!base) return null;
  return {
    id: string(base.result.id) || base.href,
    title: base.title,
    eyebrow: "Things worth doing",
    description: "A current experience listing and starting price. Check date-specific availability, inclusions, and cancellation terms before booking.",
    href: base.href,
    provider: "Klook",
    affiliate: true,
    category: base.category,
    icon: "✦",
    action: "See activity & book",
    image: base.image,
    imageAlt: `${base.title} activity photo`,
    price: base.price,
    priceNote: "starting price shown by partner",
    checkedAt: string(base.result.searched_at) || null
  };
}

export function klookTransportFindCard(value: unknown): FindsCard | null {
  const base = listingBase(value, "klook", "transport", "klook.com", "klook.com");
  if (!base) return null;
  return {
    id: string(base.result.id) || base.href,
    title: base.title,
    eyebrow: "Getting around",
    description: "A current transport option and starting price. Check the route, date-specific availability, inclusions, and terms before booking.",
    href: base.href,
    provider: "Klook",
    affiliate: true,
    category: base.category,
    icon: "↗",
    action: "See transport options",
    image: base.image,
    imageAlt: `${base.title} transport photo`,
    price: base.price,
    priceNote: "starting price shown by partner",
    checkedAt: string(base.result.searched_at) || null
  };
}

export function flightFindCard(value: unknown): FindsCard | null {
  const base = listingBase(value, "travelpayouts", "flight", "aviasales.com", "none");
  if (!base) return null;
  const route = [string(base.result.origin), string(base.result.destination)].filter(Boolean).join(" → ");
  const minutesLabel = (value: unknown) => {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return "";
    const minutes = Math.round(value);
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return hours ? `${hours}h${remainder ? ` ${remainder}m` : ""}` : `${remainder}m`;
  };
  const outboundDuration = minutesLabel(base.providerPayload.duration_to);
  const returnDuration = minutesLabel(base.providerPayload.duration_back);
  const details = [
    outboundDuration ? `Outbound ${outboundDuration}` : "",
    returnDuration ? `return ${returnDuration}` : "",
    typeof base.providerPayload.transfers === "number" && Number.isInteger(base.providerPayload.transfers) && base.providerPayload.transfers >= 0
      ? `${base.providerPayload.transfers} stop${base.providerPayload.transfers === 1 ? "" : "s"} outbound`
      : ""
  ].filter(Boolean);
  return {
    id: string(base.result.id) || base.href,
    title: route ? `${route} flight` : base.title,
    eyebrow: "Flights worth checking",
    description: `A recent fare reference for your selected dates${details.length ? ` · ${details.join(" · ")}` : ""}. This is not a live quote; confirm current price, schedule, stops, and baggage before purchase.`,
    href: base.href,
    provider: "Travelpayouts",
    affiliate: true,
    category: base.category,
    icon: "↗",
    action: "See flight options",
    image: "/roamly-flight-route.svg",
    imageAlt: "Flight route illustration",
    price: base.price,
    priceNote: "recent fare reference · not live",
    checkedAt: null
  };
}
