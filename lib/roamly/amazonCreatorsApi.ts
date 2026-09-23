import { getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { amazonFindProductFromApi, type AmazonFindProduct } from "@/lib/roamly/amazonCreatorsCore";

const marketplaceHostByDomain: Record<string, string> = {
  "amazon.com": "www.amazon.com",
  "amazon.ca": "www.amazon.ca",
  "amazon.com.mx": "www.amazon.com.mx",
  "amazon.com.br": "www.amazon.com.br",
  "amazon.co.uk": "www.amazon.co.uk",
  "amazon.de": "www.amazon.de",
  "amazon.fr": "www.amazon.fr",
  "amazon.it": "www.amazon.it",
  "amazon.es": "www.amazon.es",
  "amazon.nl": "www.amazon.nl",
  "amazon.com.be": "www.amazon.com.be",
  "amazon.ie": "www.amazon.ie",
  "amazon.se": "www.amazon.se",
  "amazon.pl": "www.amazon.pl",
  "amazon.com.tr": "www.amazon.com.tr",
  "amazon.ae": "www.amazon.ae",
  "amazon.sa": "www.amazon.sa",
  "amazon.eg": "www.amazon.eg",
  "amazon.in": "www.amazon.in",
  "amazon.co.jp": "www.amazon.co.jp",
  "amazon.sg": "www.amazon.sg",
  "amazon.com.au": "www.amazon.com.au"
};

const tokenEndpointByVersion: Record<string, string> = {
  "3.1": "https://api.amazon.com/auth/o2/token",
  "3.2": "https://api.amazon.co.uk/auth/o2/token",
  "3.3": "https://api.amazon.co.jp/auth/o2/token"
};

const itemResources = [
  "images.primary.large",
  "images.primary.medium",
  "itemInfo.title",
  "offersV2.listings.availability",
  "offersV2.listings.dealDetails",
  "offersV2.listings.merchantInfo",
  "offersV2.listings.price"
];

let cachedToken: { key: string; value: string; expiresAt: number } | null = null;
let pendingToken: Promise<string | null> | null = null;
const productCache = new Map<string, { value: AmazonFindProduct[]; checkedAt: string; expiresAt: number }>();
const PRODUCT_CACHE_TTL_MS = 5 * 60 * 1000;

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function string(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function nested(recordValue: unknown, ...keys: string[]): Record<string, unknown> | null {
  let current = record(recordValue);
  for (const key of keys) current = record(current?.[key]);
  return current;
}

function marketplaceConfig() {
  const affiliate = getAmazonAffiliateConfig();
  const marketplace = marketplaceHostByDomain[affiliate.marketplace];
  const version = string(process.env.ROAMLY_AMAZON_CREATORS_VERSION);
  const clientId = string(process.env.ROAMLY_AMAZON_CREATORS_CLIENT_ID);
  const clientSecret = string(process.env.ROAMLY_AMAZON_CREATORS_CLIENT_SECRET);
  const tokenEndpoint = tokenEndpointByVersion[version];
  if (!affiliate.enabled || !marketplace || !affiliate.associateTag || !clientId || !clientSecret || !tokenEndpoint) return null;
  return { affiliate, marketplace, version, clientId, clientSecret, tokenEndpoint };
}

async function accessToken(fetchImpl: typeof fetch, config: NonNullable<ReturnType<typeof marketplaceConfig>>) {
  const cacheKey = `${config.version}:${config.clientId}`;
  if (cachedToken?.key === cacheKey && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  if (pendingToken) return pendingToken;

  pendingToken = (async () => {
    try {
      const response = await fetchImpl(config.tokenEndpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          grant_type: "client_credentials",
          client_id: config.clientId,
          client_secret: config.clientSecret,
          scope: "creatorsapi::default"
        }),
        cache: "no-store"
      });
      if (!response.ok) return null;
      const body = record(await response.json());
      const token = string(body?.access_token);
      const expiresIn = Number(body?.expires_in);
      if (!token || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
      cachedToken = { key: cacheKey, value: token, expiresAt: Date.now() + expiresIn * 1000 };
      return token;
    } catch {
      return null;
    } finally {
      pendingToken = null;
    }
  })();
  return pendingToken;
}

export async function searchAmazonFindProducts(input: {
  keywords: string;
  fetchImpl?: typeof fetch;
}): Promise<{ status: "not_configured" | "unavailable" | "ready" | "no_products"; checkedAt: string | null; products: AmazonFindProduct[] }> {
  const config = marketplaceConfig();
  if (!config) return { status: "not_configured", checkedAt: null, products: [] };

  const keywords = input.keywords.trim().slice(0, 100);
  if (keywords.length < 2) return { status: "no_products", checkedAt: null, products: [] };
  const cacheKey = `${config.marketplace}:${config.affiliate.associateTag}:${keywords.toLowerCase()}`;
  const cached = productCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { status: cached.value.length ? "ready" : "no_products", checkedAt: cached.checkedAt, products: cached.value };
  if (cached) productCache.delete(cacheKey);
  const fetchImpl = input.fetchImpl || fetch;
  const token = await accessToken(fetchImpl, config);
  if (!token) return { status: "unavailable", checkedAt: null, products: [] };

  try {
    const response = await fetchImpl("https://creatorsapi.amazon/catalog/v1/searchItems", {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "x-marketplace": config.marketplace,
        accept: "application/json"
      },
      body: JSON.stringify({
        marketplace: config.marketplace,
        partnerTag: config.affiliate.associateTag,
        keywords,
        itemCount: 10,
        availability: "Available",
        resources: itemResources
      }),
      cache: "no-store"
    });
    if (!response.ok) return { status: "unavailable", checkedAt: null, products: [] };
    const body = record(await response.json());
    const items = nested(body?.searchResult)?.items;
    if (!Array.isArray(items)) return { status: "unavailable", checkedAt: null, products: [] };
    const products = Array.isArray(items)
      ? items.map((item) => amazonFindProductFromApi(item, config.marketplace, config.affiliate.associateTag)).filter((item): item is AmazonFindProduct => Boolean(item))
      : [];
    const checkedAt = new Date().toISOString();
    productCache.set(cacheKey, { value: products, checkedAt, expiresAt: Date.now() + PRODUCT_CACHE_TTL_MS });
    while (productCache.size > 32) productCache.delete(productCache.keys().next().value as string);
    return { status: products.length ? "ready" : "no_products", checkedAt, products };
  } catch {
    return { status: "unavailable", checkedAt: null, products: [] };
  }
}

export function resetAmazonCreatorsTokenForTests() {
  cachedToken = null;
  pendingToken = null;
  productCache.clear();
}
