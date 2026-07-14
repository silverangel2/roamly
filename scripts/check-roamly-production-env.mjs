const REQUIRED = "required";
const OPTIONAL = "optional";

const EXPECTED_APP_URL = "https://roamlyhq.com";
const EXPECTED_SUPABASE_URL = "https://ikrfkpnbtkdohoxnbphu.supabase.co";

const checks = [
  {
    label: "NEXT_PUBLIC_APP_URL",
    required: REQUIRED,
    keys: ["NEXT_PUBLIC_APP_URL"],
    expected: EXPECTED_APP_URL
  },
  {
    label: "NEXT_PUBLIC_SUPABASE_URL",
    required: REQUIRED,
    keys: ["NEXT_PUBLIC_SUPABASE_URL"],
    expected: EXPECTED_SUPABASE_URL
  },
  {
    label: "Supabase public key",
    required: REQUIRED,
    keys: ["NEXT_PUBLIC_SUPABASE_ANON_KEY", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"]
  },
  {
    label: "SUPABASE_SERVICE_ROLE_KEY",
    required: REQUIRED,
    keys: ["SUPABASE_SERVICE_ROLE_KEY"]
  },
  {
    label: "OPENAI_API_KEY",
    required: REQUIRED,
    keys: ["OPENAI_API_KEY"]
  },
  {
    label: "Stripe secret key",
    required: REQUIRED,
    keys: ["STRIPE_SECRET_KEY"]
  },
  {
    label: "Stripe webhook secret",
    required: REQUIRED,
    keys: ["STRIPE_WEBHOOK_SECRET"]
  },
  {
    label: "Stripe itinerary price",
    required: REQUIRED,
    keys: [
      "ROAMLY_STRIPE_ITINERARY_PRICE_ID",
      "ROAMLY_STRIPE_ITINERARY_UNLOCK_PRICE_ID",
      "ROAMLY_STRIPE_ACTIVATED_TRIP_PRICE_ID"
    ]
  },
  {
    label: "Stripe features price",
    required: REQUIRED,
    keys: ["ROAMLY_STRIPE_FEATURES_PRICE_ID", "ROAMLY_STRIPE_TRACKING_ADDON_PRICE_ID"]
  },
  {
    label: "Stripe complete trip price",
    required: REQUIRED,
    keys: ["ROAMLY_STRIPE_COMPLETE_TRIP_PRICE_ID", "ROAMLY_STRIPE_TRIP_BUNDLE_PRICE_ID"]
  },
  {
    label: "Stripe publishable key",
    required: OPTIONAL,
    keys: ["NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY"]
  },
  {
    label: "VAPID public key",
    required: OPTIONAL,
    keys: ["NEXT_PUBLIC_VAPID_PUBLIC_KEY"]
  },
  {
    label: "VAPID private key",
    required: OPTIONAL,
    keys: ["VAPID_PRIVATE_KEY"]
  },
  {
    label: "VAPID subject",
    required: OPTIONAL,
    keys: ["VAPID_SUBJECT"]
  },
  {
    label: "Notification cron secret",
    required: REQUIRED,
    keys: ["ROAMLY_NOTIFICATION_CRON_SECRET"]
  },
  {
    label: "Itinerary generation cron secret",
    required: REQUIRED,
    keys: ["ROAMLY_GENERATION_CRON_SECRET", "CRON_SECRET"]
  },
  {
    label: "Itinerary generation batch size",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_BATCH_SIZE"]
  },
  {
    label: "Itinerary generation concurrency",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_CONCURRENCY"]
  },
  {
    label: "Itinerary generation max retries",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_MAX_RETRIES"]
  },
  {
    label: "Itinerary generation lease seconds",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_LEASE_SECONDS"]
  },
  {
    label: "Itinerary generation max layers per run",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_MAX_LAYERS_PER_RUN"]
  },
  {
    label: "Itinerary generation retry base seconds",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_RETRY_BASE_SECONDS"]
  },
  {
    label: "Itinerary generation retry max seconds",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_RETRY_MAX_SECONDS"]
  },
  {
    label: "Paid queue priority",
    required: OPTIONAL,
    keys: ["ROAMLY_PAID_QUEUE_PRIORITY"]
  },
  {
    label: "Free queue priority",
    required: OPTIONAL,
    keys: ["ROAMLY_FREE_QUEUE_PRIORITY"]
  },
  {
    label: "Free generation daily limit",
    required: OPTIONAL,
    keys: ["ROAMLY_FREE_GENERATION_DAILY_LIMIT"]
  },
  {
    label: "Paid generation daily limit",
    required: OPTIONAL,
    keys: ["ROAMLY_PAID_GENERATION_DAILY_LIMIT"]
  },
  {
    label: "OpenAI daily token limit",
    required: OPTIONAL,
    keys: ["ROAMLY_OPENAI_DAILY_TOKEN_LIMIT"]
  },
  {
    label: "Provider rate limits JSON",
    required: OPTIONAL,
    keys: ["ROAMLY_PROVIDER_RATE_LIMITS_JSON"]
  },
  {
    label: "Rail provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_RAIL_PROVIDER_API_KEY"]
  },
  {
    label: "Bus provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_BUS_PROVIDER_API_KEY"]
  },
  {
    label: "Ferry provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_FERRY_PROVIDER_API_KEY"]
  },
  {
    label: "Reviews provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_REVIEWS_PROVIDER_API_KEY"]
  },
  {
    label: "Weather provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_WEATHER_API_KEY"]
  },
  {
    label: "Currency provider API key",
    required: OPTIONAL,
    keys: ["ROAMLY_CURRENCY_API_KEY"]
  },
  {
    label: "Affiliate webhook secret",
    required: OPTIONAL,
    keys: ["ROAMLY_AFFILIATE_WEBHOOK_SECRET"]
  },
  {
    label: "Token encryption key",
    required: OPTIONAL,
    keys: ["ROAMLY_TOKEN_ENCRYPTION_KEY"]
  },
  {
    label: "Gmail OAuth client ID",
    required: OPTIONAL,
    keys: ["GOOGLE_GMAIL_CLIENT_ID"]
  },
  {
    label: "Gmail OAuth client secret",
    required: OPTIONAL,
    keys: ["GOOGLE_GMAIL_CLIENT_SECRET"]
  },
  {
    label: "Gmail redirect URI",
    required: OPTIONAL,
    keys: ["GOOGLE_GMAIL_REDIRECT_URI"]
  },
  {
    label: "Gmail Pub/Sub topic",
    required: OPTIONAL,
    keys: ["ROAMLY_GMAIL_PUBSUB_TOPIC"]
  },
  {
    label: "Gmail webhook secret",
    required: OPTIONAL,
    keys: ["ROAMLY_GMAIL_WEBHOOK_SECRET"]
  },
  {
    label: "Microsoft Outlook client ID",
    required: OPTIONAL,
    keys: ["MICROSOFT_OUTLOOK_CLIENT_ID"]
  },
  {
    label: "Microsoft Outlook client secret",
    required: OPTIONAL,
    keys: ["MICROSOFT_OUTLOOK_CLIENT_SECRET"]
  },
  {
    label: "Microsoft Outlook tenant ID",
    required: OPTIONAL,
    keys: ["MICROSOFT_OUTLOOK_TENANT_ID"]
  },
  {
    label: "Microsoft Outlook redirect URI",
    required: OPTIONAL,
    keys: ["MICROSOFT_OUTLOOK_REDIRECT_URI"]
  },
  {
    label: "Microsoft Outlook webhook URL",
    required: OPTIONAL,
    keys: ["MICROSOFT_OUTLOOK_WEBHOOK_URL"]
  },
  {
    label: "Outlook webhook secret",
    required: OPTIONAL,
    keys: ["ROAMLY_OUTLOOK_WEBHOOK_SECRET"]
  },
  {
    label: "Live flight status API key",
    required: OPTIONAL,
    keys: ["ROAMLY_FLIGHT_STATUS_API_KEY"]
  },
  {
    label: "Live flight status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_FLIGHT_STATUS_API_URL"]
  },
  {
    label: "Train status API key",
    required: OPTIONAL,
    keys: ["ROAMLY_TRAIN_STATUS_API_KEY"]
  },
  {
    label: "Train status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_TRAIN_STATUS_API_URL"]
  },
  {
    label: "Transit status API key",
    required: OPTIONAL,
    keys: ["ROAMLY_TRANSIT_STATUS_API_KEY"]
  },
  {
    label: "Transit status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_TRANSIT_STATUS_API_URL"]
  },
  {
    label: "Weather status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_WEATHER_API_URL"]
  },
  {
    label: "Traffic status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_TRAFFIC_STATUS_API_URL"]
  },
  {
    label: "Attraction status API key",
    required: OPTIONAL,
    keys: ["ROAMLY_ATTRACTION_STATUS_API_KEY"]
  },
  {
    label: "Attraction status API URL",
    required: OPTIONAL,
    keys: ["ROAMLY_ATTRACTION_STATUS_API_URL"]
  },
  {
    label: "Generation retry budget",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_RETRY_BUDGET"]
  },
  {
    label: "Generation cost budget",
    required: OPTIONAL,
    keys: ["ROAMLY_GENERATION_COST_BUDGET_USD"]
  },
  {
    label: "Admin emails",
    required: REQUIRED,
    keys: ["ROAMLY_ADMIN_EMAILS"]
  },
  {
    label: "Tester emails",
    required: OPTIONAL,
    keys: ["ROAMLY_TESTER_EMAILS"]
  },
  {
    label: "Support email",
    required: REQUIRED,
    keys: ["ROAMLY_SUPPORT_EMAIL"],
    expected: "support@roamlyhq.com"
  },
  {
    label: "From email",
    required: REQUIRED,
    keys: ["ROAMLY_FROM_EMAIL"],
    expected: "support@roamlyhq.com"
  },
  {
    label: "From name",
    required: OPTIONAL,
    keys: ["ROAMLY_FROM_NAME"]
  },
  {
    label: "Email provider",
    required: REQUIRED,
    keys: ["ROAMLY_EMAIL_PROVIDER"],
    expected: "smtp"
  },
  {
    label: "SMTP host",
    required: REQUIRED,
    keys: ["SMTP_HOST"],
    expected: "smtp.gmail.com"
  },
  {
    label: "SMTP port",
    required: REQUIRED,
    keys: ["SMTP_PORT"],
    expected: "465"
  },
  {
    label: "SMTP secure",
    required: REQUIRED,
    keys: ["SMTP_SECURE"],
    expected: "true"
  },
  {
    label: "SMTP user",
    required: REQUIRED,
    keys: ["SMTP_USER"],
    expected: "support@roamlyhq.com"
  },
  {
    label: "SMTP app password",
    required: REQUIRED,
    keys: ["SMTP_PASSWORD"]
  },
  {
    label: "Email capture mode",
    required: OPTIONAL,
    keys: ["ROAMLY_EMAIL_CAPTURE_ENABLED"]
  },
  {
    label: "Optional Resend fallback API key",
    required: OPTIONAL,
    keys: ["RESEND_API_KEY"]
  },
  {
    label: "Social cron secret",
    required: REQUIRED,
    keys: ["ROAMLY_SOCIAL_CRON_SECRET"]
  },
  {
    label: "Meta page ID",
    required: OPTIONAL,
    keys: ["ROAMLY_META_PAGE_ID"]
  },
  {
    label: "Meta access token",
    required: OPTIONAL,
    keys: ["ROAMLY_META_ACCESS_TOKEN"]
  },
  {
    label: "Instagram business account ID",
    required: OPTIONAL,
    keys: ["ROAMLY_INSTAGRAM_BUSINESS_ACCOUNT_ID"]
  }
];

function read(key) {
  return process.env[key]?.trim() || "";
}

function configuredKeys(keys) {
  return keys.filter((key) => Boolean(read(key)));
}

function formatKeys(keys) {
  return keys.join(" or ");
}

function print(status, label, detail = "") {
  console.log(`${status.padEnd(8)} ${label}${detail ? ` - ${detail}` : ""}`);
}

let missingRequired = 0;

for (const check of checks) {
  const present = configuredKeys(check.keys);

  if (present.length === 0) {
    if (check.required === OPTIONAL) {
      print("Optional", check.label, `${formatKeys(check.keys)} not set`);
    } else {
      print("Missing", check.label, `set ${formatKeys(check.keys)}`);
      missingRequired += 1;
    }
    continue;
  }

  if (check.expected && read(check.keys[0]) !== check.expected) {
    print("Missing", check.label, `expected ${check.expected}`);
    missingRequired += 1;
    continue;
  }

  print("Ready", check.label, present.length === 1 ? `${present[0]} set` : `${present.length} accepted keys set`);
}

if (missingRequired > 0) {
  console.log(`\nMissing ${missingRequired} required production environment check${missingRequired === 1 ? "" : "s"}.`);
  process.exit(1);
}

console.log("\nReady: required Roamly production environment checks passed.");
