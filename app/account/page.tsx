import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, CircleQuestionMark, CircleUserRound, CreditCard, Crown, Download, Home, LayoutPanelLeft, Mail, MapPin, Search, Settings, User, Users, Wallet } from "lucide-react";
import { SetupCascade } from "@/components/roamly/SetupCascade";
import { AccountSetupHashRedirect } from "@/components/account/AccountSetupHashRedirect";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { EmailConnectionSettings } from "@/components/account/EmailConnectionSettings";
import { LocationTrackingSettings } from "@/components/account/LocationTrackingSettings";
import { TravelerMemorySettings } from "@/components/account/TravelerMemorySettings";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { BuiNotice } from "@/components/boardui/Notice";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfileBestEffort } from "@/lib/roamly/profile";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { listCountryOptions } from "@/lib/roamly/placeResolver";
import {
  accountInitials,
  accountPlanCard,
  bookingWalletState,
  travelerPartySize,
  travelerSubtitle
} from "@/lib/roamly/accountPanel";

type AccountPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

/**
 * Picture 8 — Account. The DEFAULT /account screen IS the picture, top to
 * bottom, and nothing else: header, profile card, plan card, menu rows,
 * Help & Support rows, Sign out. The content ENDS at Sign out.
 *
 * Every legacy block that used to render below Sign out (finish-setup
 * cascade, profile-basics form, email-import detail, traveler-memory
 * form, preferences detail, account-type cards) moved BEHIND the
 * picture's own rows: each row's destination is a ?view= detail view on
 * this same page, rendered INSTEAD of the picture — never alongside it.
 * Row destinations (all real, none invented):
 * - Profile card + account icon -> ?view=manage-account (AccountProfileForm:
 *   name editing; email shown read-only; password change and account
 *   deletion honestly stated as not available there yet).
 * - My trips -> /dashboard (the real trips list; count is live).
 * - Booking Wallet -> ?view=booking-wallet (EmailConnectionSettings,
 *   the real Gmail/email-import surface).
 * - Travelers -> ?view=travelers (TravelerMemorySettings).
 * - Payment & Billing -> /pricing (existing plans + one-time trip
 *   packs; there is no stored-payment-method portal, so the subtitle
 *   claims only what /pricing does: view plan and one-time prices).
 * - Preferences -> ?view=preferences (LanguageSwitcher +
 *   LocationTrackingSettings; no units setting exists, stated there).
 * - Saved places -> NO destination: no saved-places store or surface
 *   exists anywhere in the app, so the row is an honest unavailable
 *   state — not a link, no chevron, never presented as working.
 * - Manage account -> ?view=manage-account (same as profile card).
 * - Install Roamly -> /account?view=setup#setup-step-2 (the setup
 *   cascade's "Download the app" step — the surface where the
 *   platform-correct install guidance already implemented in
 *   SetupCascade / CompanionInstallStep lives; no second guidance
 *   implementation is written here).
 * - Roamly homepage -> / (the marketing homepage; signed-in chrome
 *   offers no other path to it — Fix round item 3, audit D5).
 * - Help Center -> /help; Contact Support -> /contact (real routes).
 * - Upgrade -> /pricing (existing route; no plan invented).
 * - Sign out -> POST to the EXISTING /auth/logout route.
 * - Finish-setup cascade (no picture row) -> ?view=setup, kept so the
 *   trip/live screens' existing /account#setup and #setup-step-N links
 *   keep working: AccountSetupHashRedirect maps those legacy hashes to
 *   ?view=setup with the step anchor preserved.
 * - Account-type cards -> REMOVED, not relocated: their content is the
 *   plan card itself (Free Plan / Tester access + the one-free-itinerary
 *   policy), already on the picture.
 *
 * Data rule (unchanged from the panel build): STRUCTURE, ORDER, and
 * COPY match the picture; VALUES are always the signed-in user's live
 * data (real initials, name, email, trip count, traveler count, plan
 * state). Nothing here changes billing, entitlements, or the
 * one-free-itinerary policy — the plan card only DISPLAYS state.
 * Every query below is scoped to current.user.id, so one user can only
 * ever see their own panel.
 */
const ACCOUNT_DETAIL_VIEWS = ["manage-account", "booking-wallet", "travelers", "preferences", "setup"] as const;
type AccountDetailView = (typeof ACCOUNT_DETAIL_VIEWS)[number];

function safeRequirementsReturn(value: unknown) {
  if (typeof value !== "string" || !value.startsWith("/trip/") || value.startsWith("//")) return null;
  try {
    const url = new URL(value, "https://roamly.internal");
    if (url.origin !== "https://roamly.internal" || !/^\/trip\/[0-9a-f-]+$/i.test(url.pathname)) return null;
    if (url.hash !== "#requirements" || url.searchParams.get("focus") !== "requirements" || [...url.searchParams.keys()].length !== 1) return null;
    return `${url.pathname}?focus=requirements#requirements`;
  } catch {
    return null;
  }
}

function firstSearchValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function AccountPage({ searchParams }: AccountPageProps) {
  const current = await getCurrentUser();
  const search = searchParams ? await searchParams : {};
  const returnTo = safeRequirementsReturn(firstSearchValue(search.return));
  const viewRaw = firstSearchValue(search.view);
  const detailView: AccountDetailView | null =
    typeof viewRaw === "string" && (ACCOUNT_DETAIL_VIEWS as ReadonlyArray<string>).includes(viewRaw)
      ? (viewRaw as AccountDetailView)
      : null;

  if (!current.configured) {
    return (
      <div className="bui-safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <BuiCard className="bui-enter p-5">
          <BuiBadge tone="warm">Setup needed</BuiBadge>
          <h1 className="mt-4 text-3xl font-black text-chead sm:text-5xl">Connect Supabase to use accounts.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-cink">
            Add Roamly Supabase environment variables, then signup, login, sessions, and protected routes will activate.
          </p>
          <div className="mt-5">
            <BuiButtonLink href="/">Back home</BuiButtonLink>
          </div>
        </BuiCard>
      </div>
    );
  }

  if (!current.user) {
    redirect("/login?next=/account");
  }

  const supabase = await createSupabaseServerClient();
  const [profileResult, free] = await Promise.all([
    supabase ? ensureRoamlyProfileBestEffort(current.user, {}, supabase, "account_page") : Promise.resolve({ profile: null, error: "" }),
    supabase ? hasUsedFreeItinerary(supabase, current.user.id) : Promise.resolve({ used: false, entitlement: null, error: null })
  ]);
  const setupState = supabase ? await getRoamlySetupState(supabase, current.user).catch(() => null) : null;
  const metadataName =
    typeof current.user.user_metadata?.full_name === "string"
      ? current.user.user_metadata.full_name
      : typeof current.user.user_metadata?.name === "string"
        ? current.user.user_metadata.name
        : "";
  const profileName = profileResult.profile?.full_name || metadataName || "";
  const displayName = profileName || "";
  const displayEmail = current.user.email || "";
  const access = getRoamlyAccessForUser(current.user.email);

  // Real per-user panel data. Each query is scoped to this user_id; a
  // failure degrades to an honest unavailable state on that row only.
  const tripResult = supabase
    ? await supabase
        .from("roamly_trips")
        .select("id,travelers_count")
        .eq("user_id", current.user.id)
        .neq("status", "archived")
    : { data: null, error: new Error("Trip history is unavailable.") };
  const tripRows = (tripResult.data || []) as Array<{ id: string; travelers_count?: number | null }>;
  const tripCount = tripResult.error ? null : tripRows.length;
  const tripIds = tripRows.map((trip) => trip.id).filter(Boolean);

  const walletResult = supabase
    ? await supabase
        .from("email_connections")
        .select("connection_status")
        .eq("user_id", current.user.id)
        .eq("provider", "gmail")
    : { data: null, error: new Error("Email connection status is unavailable.") };
  const wallet = bookingWalletState(
    walletResult.error
      ? null
      : ((walletResult.data || []) as Array<{ connection_status?: unknown }>).map((row) =>
          typeof row.connection_status === "string" ? row.connection_status : ""
        ),
    Boolean(walletResult.error)
  );

  const slotResult =
    supabase && tripIds.length > 0
      ? await supabase.from("roamly_trip_travelers").select("trip_id").in("trip_id", tripIds)
      : { data: null, error: null };
  const slotsByTrip = new Map<string, number>();
  if (!slotResult.error) {
    for (const row of (slotResult.data || []) as Array<{ trip_id?: unknown }>) {
      if (typeof row.trip_id !== "string") continue;
      slotsByTrip.set(row.trip_id, (slotsByTrip.get(row.trip_id) || 0) + 1);
    }
  }
  const travelerError = Boolean(tripResult.error);
  const partySize = travelerPartySize(
    tripRows.map((trip) => ({
      slotCount: slotsByTrip.get(trip.id) || 0,
      travelersCount: typeof trip.travelers_count === "number" ? trip.travelers_count : null
    }))
  );
  const plan = accountPlanCard(access.hasQaAccess, free.used);
  const initials = accountInitials(displayName, displayEmail);

  // ---- Detail views: ONE section, reached from its picture row — never
  // rendered on the default account screen. ----
  if (detailView) {
    return (
      <div className="calm-bleed bui-safe-bottom mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <a href="/account" className="bui-touch inline-flex items-center text-[15px] font-semibold text-cblue">
          <ChevronLeft aria-hidden="true" size={16} strokeWidth={2.5} className="-mt-0.5 inline-block" /> Back to Account
        </a>

        {detailView === "manage-account" ? (
          <BuiCard id="manage-account" className="bui-enter mt-5 scroll-mt-24 rounded-bui-panel p-4">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Profile basics</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Name and access</h1>
            <div className="mt-5">
              <AccountProfileForm initialName={profileName} email={current.user.email || ""} />
            </div>
            <p className="mt-4 text-[13.5px] font-normal leading-[1.45] text-cgray">
              Password change and account deletion are not available here yet.
            </p>
            {profileResult.error ? (
              <BuiNotice tone="error" title={`Profile table pending: ${profileResult.error}. Apply the Roamly shared-auth profile migration to enable app-specific profile records.`} className="mt-4" />
            ) : null}
          </BuiCard>
        ) : null}

        {detailView === "booking-wallet" ? (
          <BuiCard id="booking-wallet" className="bui-enter mt-5 scroll-mt-24 rounded-bui-panel p-4">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Email import</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Travel confirmations</h1>
            <div className="mt-5">
              <EmailConnectionSettings />
            </div>
          </BuiCard>
        ) : null}

        {detailView === "travelers" ? (
          <BuiCard id="travelers" className="bui-enter mt-5 scroll-mt-24 rounded-bui-panel p-4">
            <div id="traveler-memory" className="scroll-mt-24">
              <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Traveler memory</p>
              <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Preferences Roamly can use</h1>
              <div className="mt-5">
                <TravelerMemorySettings countryOptions={listCountryOptions()} returnTo={returnTo} />
              </div>
            </div>
          </BuiCard>
        ) : null}

        {detailView === "preferences" ? (
          <BuiCard id="preferences" className="bui-enter mt-5 scroll-mt-24 rounded-bui-panel p-4">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Preferences</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Language and notifications</h1>
            <div className="mt-5 space-y-5">
              <div>
                <p className="mb-2 text-sm font-black text-chead">Language</p>
                <LanguageSwitcher />
              </div>
              <LocationTrackingSettings />
            </div>
            <p className="mt-4 text-[13.5px] font-normal leading-[1.45] text-cgray">
              No units setting exists yet.
            </p>
          </BuiCard>
        ) : null}

        {detailView === "setup" ? (
          <div id="setup" className="mt-5 scroll-mt-24">
            <p className="mb-2 ml-4 text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">Finish setup — once</p>
            <h1 className="sr-only">Three steps, once</h1>
            {setupState ? (
              <>
                <SetupCascade initialState={setupState} />
                <p className="ml-4 mt-2 text-[13.5px] font-normal leading-[1.4] text-cgray">
                  Each step powers one thing. Done once, remembered forever.
                </p>
              </>
            ) : (
              <BuiNotice tone="info" title="Setup state is unavailable right now." className="ml-4" />
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ---- Default view: the picture, and ONLY the picture. The content
  // ends at Sign out; no detail section renders below it. ----
  return (
    <div className="calm-bleed bui-safe-bottom mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      {/* Legacy /account#setup links from trip/live screens land here with
          no setup section on screen; map them to the ?view=setup detail
          view with the step anchor preserved. */}
      <AccountSetupHashRedirect />
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Account</h1>
        <a
          href="/account?view=manage-account"
          aria-label="Manage account"
          className="bui-press bui-touch-square flex h-10 w-10 items-center justify-center rounded-full border border-chair bg-white text-chead shadow-bui-card"
        >
          <CircleUserRound aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
        </a>
      </div>

      {/* Profile row — real session identity only. */}
      <a href="/account?view=manage-account" className="bui-enter bui-press bui-touch mt-5 block">
        <BuiCard interactive className="flex items-center gap-3 rounded-bui-panel p-4">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chead text-[17px] font-bold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold leading-snug text-chead">{displayName || displayEmail || "Account"}</span>
          {displayName && displayEmail ? (
            <span className="block truncate text-[13.5px] font-normal leading-snug text-cgray">{displayEmail}</span>
          ) : null}
        </span>
        <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </BuiCard>
      </a>

      {/* Plan card — displays plan state; Upgrade goes to existing /pricing. */}
      <BuiCard className="bui-enter mt-3 rounded-bui-panel p-4">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="bui-touch-square flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-csoft text-cblue">
            <Crown aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-bold leading-snug text-chead">{plan.title}</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{plan.subtitle}</span>
          </span>
          <a
            href="/pricing"
            className="bui-press bui-touch inline-flex shrink-0 items-center rounded-full px-4 py-2 text-[14px] font-bold text-cblue ring-1 ring-cblue/40"
          >
            Upgrade
          </a>
        </div>
      </BuiCard>

      {/* Main rows — each opens a real surface, except Saved places (no store). */}
      <BuiCard className="bui-enter mt-3 divide-y divide-chair overflow-hidden rounded-bui-panel">
        <a href="/dashboard" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <LayoutPanelLeft aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">My trips</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">View, edit, and manage your trips</span>
          </span>
          {tripCount !== null ? (
            <span className="bui-display-number text-[16px] font-semibold text-chead">{tripCount}</span>
          ) : null}
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        <a href="/account?view=booking-wallet" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Wallet aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Booking Wallet</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{wallet.label}</span>
          </span>
          {wallet.connected ? (
            <span aria-label="Connected" className="h-2.5 w-2.5 shrink-0 rounded-full bg-cgreen" />
          ) : null}
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        <a href="/account?view=travelers" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Users aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Travelers</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{travelerSubtitle(partySize, travelerError)}</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        <a href="/pricing" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <CreditCard aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Payment &amp; Billing</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">View plan and one-time prices</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        <a href="/account?view=preferences" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Settings aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Preferences</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Language and notifications</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        {/* Saved places: NO store or surface exists in the app, so this is
            an honest unavailable row — not a link, no chevron, no invented
            favorites. It must never be presented as working. */}
        <div aria-disabled="true" className="bui-touch flex items-center gap-3 px-4 py-3.5 opacity-70">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <MapPin aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Saved places</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Not available yet</span>
          </span>
        </div>

        <a href="/account?view=manage-account" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <User aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Manage account</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Update your email, password, or delete account</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        <a href="/account?view=setup#setup-step-2" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <Download aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Install Roamly</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Add Roamly to your Home Screen</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>

        {/* Roamly homepage: signed-in chrome deliberately offers no
            other path to "/" (audit D5) — this row is that path.
            Rendered with next/link: the build's no-html-link-for-pages
            lint rule forbids a raw <a> to "/" specifically. */}
        <Link href="/" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Home aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Roamly homepage</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Visit the Roamly home page</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </Link>

        {/* Deals (Finds): the second exit the owner found missing
            from Account (2026-11-06) — the same row shape as the
            homepage row above, to the same destination the tab bar
            and nav call "Deals" (/finds). */}
        <a href="/finds" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Search aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Deals</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Stays, flights and things to do, hand-picked for your trips</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>
      </BuiCard>

      {/* Help & Support — real surfaces: /help and /contact. */}
      <p className="mb-2 ml-4 mt-7 text-[19px] font-bold tracking-[-0.018em] text-chead">Help &amp; Support</p>
      <BuiCard className="bui-enter divide-y divide-chair overflow-hidden rounded-bui-panel">
        <a href="/help" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <CircleQuestionMark aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Help Center</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Get answers and travel tips</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>
        <a href="/contact" className="bui-press bui-touch flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="bui-touch-square flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-csoft text-cblue">
            <Mail aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Contact Support</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">We&apos;re here to help</span>
          </span>
          <ChevronRight aria-hidden="true" size={22} strokeWidth={2} className="shrink-0 text-cgray2" />
        </a>
      </BuiCard>

      {/* Sign out — the EXISTING auth sign-out, nothing new invented.
          The picture's content ENDS here. */}
      <form action="/auth/logout" method="post" className="mt-3">
        <button
          type="submit"
          className="bui-press bui-touch w-full rounded-bui-panel border border-cred/30 bg-cred/10 py-3.5 text-center text-[16px] font-semibold text-cred shadow-bui-card"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
