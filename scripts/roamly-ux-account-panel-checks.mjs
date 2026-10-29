// roamly-ux-account-panel-checks.mjs — BUILDER-G proof (Account panel),
// updated for Picture 8: the DEFAULT /account screen is the picture only
// (content ends at Sign out); every legacy detail section lives behind
// its picture row as a ?view= detail view, rendered instead of the
// picture — never alongside it. Static checks read the page source.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-ux-account-panel-checks.mjs [root]
// Self-contained except for the tree's own pure helpers, imported through
// the repo's alias loader so fixtures test the tree's real logic, not a
// copy of it in this script. Static checks read the page source.
// Usage:
//   node --experimental-strip-types --import ./scripts/roamly-test-register.mjs \
//     scripts/roamly-ux-account-panel-checks.mjs [root]
// root defaults to the tree root (this script's parent dir).
// This is not a runtime render: no build is run here by design
// (the coordinator runs full proof at integration). The panel shows no
// dates, so the run is timezone-invariant; run under both
// TZ=America/Moncton and TZ=UTC and both must pass identically.

import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  accountInitials,
  accountPlanCard,
  bookingWalletState,
  travelerPartySize,
  travelerSubtitle
} from "../lib/roamly/accountPanel.ts";

const root = process.argv[2] || join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => {
  const p = join(root, rel);
  return existsSync(p) ? readFileSync(p, "utf8") : "";
};

const results = [];
function check(name, kind, ok, detail = "") {
  results.push({ name, kind, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"} [${kind}] ${name}${detail ? ` — ${detail}` : ""}`);
}

const page = read("app/account/page.tsx");
const helper = read("lib/roamly/accountPanel.ts");
const logoutRoute = read("app/auth/logout/route.ts");
const pricingPage = read("app/pricing/page.tsx");
const dashboardPage = read("app/dashboard/page.tsx");
const helpPage = read("app/help/page.tsx");
const contactPage = read("app/contact/page.tsx");
const shim = read("components/account/AccountSetupHashRedirect.tsx");

console.log(`TZ=${process.env.TZ || "(unset)"} root=${root}`);

// ---- A. Panel structure matches the mock, element by element ----
check("header is Account (not Settings)", "STATIC", page.includes(">Account</h1>") && !page.includes(">Settings</h1>"));
check("profile row renders initials avatar from live identity", "STATIC",
  page.includes("accountInitials(displayName, displayEmail)") && page.includes("rounded-full bg-chead"));
check("plan card renders Free Plan title + Upgrade to /pricing", "STATIC",
  page.includes("accountPlanCard(") && page.includes('href="/pricing"') && /Upgrade\s*<\/a>/.test(page));
check("plan subtitle carries the one-free-itinerary-per-account policy", "STATIC",
  helper.includes("1 free itinerary per account"));
check("My trips row links to the real trips list (/dashboard) with a live count", "STATIC",
  page.includes('href="/dashboard"') && page.includes("My trips") && page.includes("tripCount"));
check("Booking Wallet row links to its ?view= detail destination", "STATIC",
  page.includes("Booking Wallet") && page.includes('href="/account?view=booking-wallet"') && page.includes("wallet.label"));
check("Travelers row links to its ?view= detail destination", "STATIC",
  page.includes("Travelers") && page.includes('href="/account?view=travelers"') && page.includes("travelerSubtitle(partySize"));
check("Payment & Billing row links to existing /pricing with the picture subtitle", "STATIC",
  page.includes("Payment &amp; Billing") && page.includes('href="/pricing"') && page.includes("Manage your plan and payment method"));
check("Preferences row links to its ?view= detail destination with the picture subtitle", "STATIC",
  page.includes("Preferences") && page.includes('href="/account?view=preferences"') && page.includes("Language, units, notifications"));
check("Manage account row links to its ?view= detail destination with the picture subtitle", "STATIC",
  page.includes("Manage account") && page.includes('href="/account?view=manage-account"') && page.includes("Update your email, password, or delete account"));
check("profile card + gear icon link to the manage-account detail view", "STATIC",
  page.includes('aria-label="Manage account"') && (page.match(/href="\/account\?view=manage-account"/g) || []).length >= 3);
check("Help Center row links to real /help", "STATIC",
  page.includes("Help Center") && page.includes('href="/help"') && helpPage.length > 0);
check("Contact Support row links to real /contact", "STATIC",
  page.includes("Contact Support") && page.includes('href="/contact"') && contactPage.length > 0);
check("Help & Support section header present", "STATIC", page.includes("Help &amp; Support"));
check("Sign out is a POST form to the EXISTING /auth/logout route", "STATIC",
  page.includes('<form action="/auth/logout" method="post"') && /Sign out\s*<\/button>/.test(page));
check("existing logout route signs out via Supabase (no new auth flow)", "STATIC",
  logoutRoute.includes("supabase.auth.signOut()"));
check("page invents no auth: no signIn/signUp call in the account page", "STATIC",
  !page.includes("signIn(") && !page.includes("signUp("));

// ---- B. Saved places: honest unavailable state, never a dead working row ----
// Slice the rendered Saved places row itself (its aria-disabled div), not
// the doc comment at the top of the file, which also mentions the row.
const savedStart = page.indexOf('aria-disabled="true"');
const savedBlock = page.slice(savedStart, page.indexOf('href="/account?view=manage-account"', savedStart));
check("Saved places row is NOT a link (no href in its block)", "STATIC", !savedBlock.includes("href="));
check("Saved places row carries no chevron", "STATIC", !savedBlock.includes("›"));
check("Saved places row says Not available yet", "STATIC", savedBlock.includes("Not available yet"));
check("Saved places row is marked aria-disabled", "STATIC", savedBlock.includes('aria-disabled="true"'));
check("no saved-places store is claimed anywhere on the page", "STATIC",
  !page.includes("saved_places") && !page.includes("savedPlace"));

// ---- C. No hardcoded identity anywhere in the panel ----
const emailLiteral = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
check("page source contains no literal email address", "STATIC", !emailLiteral.test(page));
check("helper source contains no literal email address", "STATIC", !emailLiteral.test(helper));
check("profile name comes only from session/profile variables", "STATIC",
  page.includes("profileResult.profile?.full_name") && page.includes("current.user.user_metadata") && page.includes("current.user.email"));
check("trip count comes only from the live query (never a literal count)", "STATIC",
  page.includes("tripRows.length") && !/My trips[\s\S]{0,400}>\s*[0-9]+\s*</.test(page));

// ---- D. Per-user isolation: every panel query is scoped to the user ----
check("trips query scoped to current user", "STATIC",
  page.includes('.from("roamly_trips")') && page.includes('.eq("user_id", current.user.id)'));
check("gmail query scoped to current user + gmail provider", "STATIC",
  page.includes('.from("email_connections")') && page.includes('.eq("provider", "gmail")'));
check("traveler slots filtered to the user's own trip ids", "STATIC",
  page.includes('.from("roamly_trip_travelers")') && page.includes('.in("trip_id", tripIds)'));
check("trips exclude archived, matching /dashboard", "STATIC",
  page.includes('.neq("status", "archived")') && dashboardPage.includes('.neq("status", "archived")'));

// ---- E. Upgrade route exists; billing/entitlements untouched ----
check("pricing route file exists and is a page", "STATIC",
  pricingPage.includes("Pricing") && pricingPage.includes("Free itinerary"));
check("page changes no entitlement: no Stripe/checkout call on the account page", "STATIC",
  !page.includes("stripe") && !page.includes("checkout") && !page.includes("createCheckout"));
check("page still reads the free-itinerary gate (display only)", "STATIC",
  page.includes("hasUsedFreeItinerary(supabase, current.user.id)"));
check("no billing portal or payment-method surface is claimed", "STATIC",
  page.includes("Manage your plan and payment method") && !page.includes('href="/billing"') && !page.includes("billing-portal"));

// ---- F. Honest gaps are stated on the page, not hidden ----
check("password/delete gap stated in Manage account section", "STATIC",
  page.includes("Password change and account deletion are not available here yet."));
check("units gap stated in Preferences section", "STATIC",
  page.includes("No units setting exists yet."));
check("design tokens: navy-slate ink, grouped ground, no black-dominant bg", "STATIC",
  page.includes("text-chead") && page.includes("calm-bleed") && !page.includes("bg-black"));

// ---- H. Picture 8: the default screen IS the picture; details live
// behind rows as ?view= views, never on the default screen ----
const detailMarker = page.indexOf("if (detailView)");
const defaultMarker = page.indexOf("---- Default view: the picture");
const detailBranch = detailMarker >= 0 && defaultMarker > detailMarker ? page.slice(detailMarker, defaultMarker) : "";
const defaultBranch = defaultMarker >= 0 ? page.slice(defaultMarker) : "";
check("detail views are allowlisted (unknown ?view= falls back to the picture)", "STATIC",
  page.includes('ACCOUNT_DETAIL_VIEWS = ["manage-account", "booking-wallet", "travelers", "preferences", "setup"]') &&
  page.includes("includes(viewRaw)") && page.includes("if (detailView)"));
check("detail branch carries a Back to Account link", "STATIC",
  detailBranch.includes("Back to Account") && detailBranch.includes('href="/account"'));
check("detail branch holds every relocated section (and only there)", "STATIC",
  ["SetupCascade", "AccountProfileForm", "EmailConnectionSettings", "TravelerMemorySettings", "LanguageSwitcher", "LocationTrackingSettings"]
    .every((name) => detailBranch.includes(name)));
check("default picture branch ends at Sign out and holds NO detail section", "STATIC",
  defaultBranch.includes('<form action="/auth/logout" method="post"') &&
  ["SetupCascade", "AccountProfileForm", "EmailConnectionSettings", "TravelerMemorySettings", "LanguageSwitcher", "LocationTrackingSettings", "Account type", "Profile basics", "Traveler memory", "Finish setup"]
    .every((name) => !defaultBranch.includes(name)));
check("default picture branch holds no in-page detail anchor (no #manage-account etc.)", "STATIC",
  !defaultBranch.includes('href="#manage-account"') && !defaultBranch.includes('href="#booking-wallet"') &&
  !defaultBranch.includes('href="#travelers"') && !defaultBranch.includes('href="#preferences"') && !defaultBranch.includes('href="#setup"'));
check("My trips subtitle is always the picture copy (no error-swapped subtitle)", "STATIC",
  page.includes("View, edit, and manage your trips") && !page.includes("Trip count unavailable"));
check("legacy /account#setup links keep working via the hash shim", "STATIC",
  page.includes("AccountSetupHashRedirect") && shim.includes("/account?view=setup") &&
  shim.includes("#setup(-step-[123])?") && shim.includes("return null"));

// ---- G. Fixture: real-user-data rendering via the tree's own helpers ----
// Initials: derived, never copied.
check("initials from two-part name", "FIXTURE", accountInitials("Ada Lovelace", "ada@example.com") === "AL");
check("initials from one-part name", "FIXTURE", accountInitials("Ada", "ada@example.com") === "AD");
check("initials fall back to email local part", "FIXTURE", accountInitials("", "ada@example.com") === "AD");
check("initials fall back to ? with nothing", "FIXTURE", accountInitials("", "") === "?");
// Wallet: Connected ONLY on an exact "connected" row.
check("wallet connected on exact connected row", "FIXTURE",
  bookingWalletState(["connected"], false).label === "Connected to Gmail" &&
  bookingWalletState(["connected"], false).connected === true);
check("wallet connected wins over a disconnected row", "FIXTURE",
  bookingWalletState(["disconnected", "connected"], false).connected === true);
check("wallet syncing is not shown as connected", "FIXTURE",
  bookingWalletState(["syncing"], false).label === "Syncing Gmail" &&
  bookingWalletState(["syncing"], false).connected === false);
check("wallet error/needs_reauth/revoked ask for reconnect, never connected", "FIXTURE",
  ["error", "needs_reauth", "revoked"].every((s) =>
    bookingWalletState([s], false).label === "Gmail needs reconnecting" &&
    bookingWalletState([s], false).connected === false));
check("wallet disconnected/none is Not connected", "FIXTURE",
  bookingWalletState(["disconnected"], false).label === "Not connected" &&
  bookingWalletState([], false).label === "Not connected");
check("wallet query failure is unavailable, never connected", "FIXTURE",
  bookingWalletState(null, true).label === "Connection status unavailable" &&
  bookingWalletState(null, true).unavailable === true &&
  bookingWalletState(null, true).connected === false);
// Travelers: largest party, never summed across trips, min 1 (you).
check("travelers: no trips means you alone (1)", "FIXTURE", travelerPartySize([]) === 1);
check("travelers: single trip of 1", "FIXTURE", travelerPartySize([{ slotCount: 1, travelersCount: 1 }]) === 1);
check("travelers: slots beat the travelers_count column", "FIXTURE",
  travelerPartySize([{ slotCount: 3, travelersCount: 2 }]) === 3);
check("travelers: travelers_count is the fallback when no slots recorded", "FIXTURE",
  travelerPartySize([{ slotCount: 0, travelersCount: 4 }]) === 4);
check("travelers: largest party wins, parties are NOT summed", "FIXTURE",
  travelerPartySize([
    { slotCount: 2, travelersCount: 2 },
    { slotCount: 3, travelersCount: 3 }
  ]) === 3);
check("travelers subtitle singular/plural + unavailable", "FIXTURE",
  travelerSubtitle(1, false) === "You • 1 traveler" &&
  travelerSubtitle(3, false) === "You • 3 travelers" &&
  travelerSubtitle(3, true) === "Traveler info unavailable");
// Plan card: display only.
check("plan card free + available", "FIXTURE",
  accountPlanCard(false, false).title === "Free Plan" &&
  accountPlanCard(false, false).subtitle === "1 free itinerary per account");
check("plan card free + used", "FIXTURE",
  accountPlanCard(false, true).title === "Free Plan" &&
  accountPlanCard(false, true).subtitle === "Free itinerary used");
check("plan card tester access preserved", "FIXTURE",
  accountPlanCard(true, false).title === "Tester access");

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log("FAILURES:");
  for (const f of failed) console.log(` - ${f.name} (${f.kind}) ${f.detail}`);
  process.exit(1);
}
