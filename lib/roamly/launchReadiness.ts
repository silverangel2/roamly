import { hasSupabaseConfig } from "@/lib/supabase/config";
import { getAffiliateReadiness } from "@/lib/roamly/affiliateLinks";
import { getAmazonAffiliateConfig } from "@/lib/roamly/amazonAffiliate";
import { getEsimProviderConfig } from "@/lib/roamly/esim";
import { getRoamlyAdminEmails, getRoamlyTesterEmails, type RoamlyAccess } from "@/lib/roamly/access";
import { isEmailConfigured } from "@/lib/roamly/email";
import { getRoamlySocialEnvStatus } from "@/lib/roamly/social";

export type ReadinessStatus = "Ready" | "Missing" | "Optional" | "Needs setup";

export type RoamlyReadinessCheck = {
  group: string;
  label: string;
  status: ReadinessStatus;
  detail: string;
};

function requiredStatus(configured: boolean): ReadinessStatus {
  return configured ? "Ready" : "Missing";
}

function optionalStatus(configured: boolean, enabled = false): ReadinessStatus {
  if (configured) return "Ready";
  return enabled ? "Needs setup" : "Optional";
}

function appUrl() {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "";
}

function stripeConfigured() {
  return Boolean(
    process.env.STRIPE_SECRET_KEY &&
      process.env.STRIPE_WEBHOOK_SECRET &&
      (process.env.ROAMLY_STRIPE_ITINERARY_PRICE_ID || process.env.ROAMLY_STRIPE_ITINERARY_UNLOCK_PRICE_ID) &&
      (process.env.ROAMLY_STRIPE_FEATURES_PRICE_ID || process.env.ROAMLY_STRIPE_TRACKING_ADDON_PRICE_ID) &&
      (process.env.ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID || process.env.ROAMLY_STRIPE_TRIP_BUNDLE_PRICE_ID)
  );
}

export function getRoamlyLaunchReadiness(access?: RoamlyAccess): RoamlyReadinessCheck[] {
  const affiliates = getAffiliateReadiness();
  const amazon = getAmazonAffiliateConfig();
  const esim = getEsimProviderConfig();
  const email = isEmailConfigured();
  const social = getRoamlySocialEnvStatus();
  const affiliatesEnabled = affiliates.affiliatesEnabled;
  const url = appUrl();
  const adminEmailsConfigured = getRoamlyAdminEmails().length > 0;
  const testerEmailsConfigured = getRoamlyTesterEmails().length > 0;

  return [
    {
      group: "Launch",
      label: "Domain roamlyhq.com configured",
      status: url.includes("roamlyhq.com") ? "Ready" : "Needs setup",
      detail: url.includes("roamlyhq.com") ? "Public app URL points at the Roamly domain." : "Set NEXT_PUBLIC_APP_URL to https://roamlyhq.com before production launch."
    },
    {
      group: "Launch",
      label: "Standalone Supabase configured",
      status: requiredStatus(hasSupabaseConfig() && Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)),
      detail: "Requires Supabase URL, public key, and service role for admin-only operations."
    },
    {
      group: "Launch",
      label: "Google login configured",
      status: hasSupabaseConfig() ? "Ready" : "Needs setup",
      detail: "Google OAuth is initiated through Supabase; verify the Google provider in the Supabase dashboard."
    },
    {
      group: "Support",
      label: "Support email configured",
      status: requiredStatus(email.supportEmailConfigured),
      detail: "ROAMLY_SUPPORT_EMAIL should be support@roamlyhq.com."
    },
    {
      group: "Support",
      label: "From email configured",
      status: requiredStatus(email.fromEmailConfigured),
      detail: "ROAMLY_FROM_EMAIL should be support@roamlyhq.com."
    },
    {
      group: "Support",
      label: "Email provider configured",
      status: requiredStatus(email.configured),
      detail: email.configured ? `${email.activeProviderLabel} email delivery is selected.` : email.reason
    },
    {
      group: "Payments",
      label: "Stripe envs configured",
      status: requiredStatus(stripeConfigured()),
      detail: "Checks Stripe secret, webhook secret, and Roamly price IDs without exposing values."
    },
    {
      group: "AI",
      label: "OpenAI configured",
      status: requiredStatus(Boolean(process.env.OPENAI_API_KEY)),
      detail: "Required for itinerary generation and AI social draft generation."
    },
    {
      group: "Access",
      label: "Admin/tester emails configured",
      status: requiredStatus(adminEmailsConfigured && testerEmailsConfigured),
      detail: "ROAMLY_ADMIN_EMAILS and ROAMLY_TESTER_EMAILS support comma-separated email lists."
    },
    {
      group: "Access",
      label: "Current user is admin",
      status: access?.isAdmin ? "Ready" : "Missing",
      detail: "Uses ROAMLY_ADMIN_EMAILS; configured admin addresses are not exposed."
    },
    {
      group: "Access",
      label: "Current user is tester",
      status: access?.isTester ? "Ready" : "Optional",
      detail: "Admins automatically have tester-style access."
    },
    {
      group: "Affiliate",
      label: "Travelpayouts enabled",
      status: optionalStatus(affiliates.travelpayoutsMarkerConfigured, affiliatesEnabled),
      detail: "Flight partner links are enabled when Travelpayouts marker and provider settings are present."
    },
    {
      group: "Affiliate",
      label: "Stay22 configured",
      status: optionalStatus(affiliates.stay22PartnerConfigured, affiliatesEnabled),
      detail: "Hotel/stay partner links can use Stay22 when configured."
    },
    {
      group: "Affiliate",
      label: "Klook configured",
      status: optionalStatus(affiliates.klookPartnerConfigured, affiliatesEnabled),
      detail: "Tours, tickets, activities, and some transport searches can use Klook when configured."
    },
    {
      group: "Affiliate",
      label: "Amazon configured",
      status: optionalStatus(amazon.enabled, process.env.ROAMLY_AMAZON_ENABLED === "true"),
      detail: "Travel essentials use Amazon only when enabled and an associate tag is configured."
    },
    {
      group: "Affiliate",
      label: "Airalo configured",
      status: optionalStatus(Boolean(esim.referralUrl || esim.affiliateId), esim.enabled),
      detail: "Travel eSIM links use Airalo when enabled and referral or affiliate values are present."
    },
    {
      group: "Social",
      label: "Facebook connected",
      status: social.facebookConnected ? "Ready" : "Optional",
      detail: social.facebookStatusLabel
    },
    {
      group: "Social",
      label: "Instagram connected",
      status: social.instagramConnected ? "Ready" : "Optional",
      detail: social.instagramStatusLabel
    },
    {
      group: "Social",
      label: "Social autopost enabled/disabled",
      status: social.autoPostEnabled ? "Needs setup" : "Optional",
      detail: social.autoPostEnabled ? "Auto-post is enabled; confirm approval and Meta credentials." : "Auto-post is disabled; draft/copy mode is active."
    },
    {
      group: "Social",
      label: "Cron secret configured",
      status: requiredStatus(social.cronSecretConfigured),
      detail: "ROAMLY_SOCIAL_CRON_SECRET protects /api/cron/roamly-social-autopost."
    }
  ];
}
