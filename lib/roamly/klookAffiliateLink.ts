type KlookAffiliateOptions = {
  referralUrl?: string | null;
  partnerId?: string | null;
};

function clean(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function isKlookHost(hostname: string) {
  const host = hostname.toLowerCase();
  return host === "klook.com" || host.endsWith(".klook.com");
}

export function buildKlookProductAffiliateUrl(value: unknown, options: KlookAffiliateOptions = {}) {
  let productUrl: URL;
  try {
    productUrl = new URL(clean(value));
  } catch {
    return "";
  }
  if (productUrl.protocol !== "https:" || !isKlookHost(productUrl.hostname) || productUrl.username || productUrl.password) return "";

  const referralUrl = clean(options.referralUrl);
  if (referralUrl) {
    try {
      const referral = new URL(referralUrl);
      if (referral.protocol === "https:" && referral.hostname.toLowerCase() === "affiliate.klook.com") {
        referral.searchParams.set("k_site", productUrl.toString());
        return referral.toString();
      }
    } catch {
      // Fall through to a partner-ID link only when one is explicitly configured.
    }
  }

  const partnerId = clean(options.partnerId);
  if (!partnerId) return "";
  productUrl.searchParams.set("aid", partnerId);
  return productUrl.toString();
}
