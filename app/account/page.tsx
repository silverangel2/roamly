import { redirect } from "next/navigation";
import { SetupCascade } from "@/components/roamly/SetupCascade";
import { AccountSetupHashRedirect } from "@/components/account/AccountSetupHashRedirect";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { EmailConnectionSettings } from "@/components/account/EmailConnectionSettings";
import { LocationTrackingSettings } from "@/components/account/LocationTrackingSettings";
import { TravelerMemorySettings } from "@/components/account/TravelerMemorySettings";
import { LanguageSwitcher } from "@/components/i18n/LanguageSwitcher";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
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
 * - Profile card + gear icon -> ?view=manage-account (AccountProfileForm:
 *   name editing; email shown read-only; password change and account
 *   deletion honestly stated as not available there yet).
 * - My trips -> /dashboard (the real trips list; count is live).
 * - Booking Wallet -> ?view=booking-wallet (EmailConnectionSettings,
 *   the real Gmail/email-import surface).
 * - Travelers -> ?view=travelers (TravelerMemorySettings).
 * - Payment & Billing -> /pricing (existing plans + one-time trip
 *   packs; there is no stored-payment-method portal, so none is claimed
 *   beyond the picture's own subtitle wording).
 * - Preferences -> ?view=preferences (LanguageSwitcher +
 *   LocationTrackingSettings; no units setting exists, stated there).
 * - Saved places -> NO destination: no saved-places store or surface
 *   exists anywhere in the app, so the row is an honest unavailable
 *   state — not a link, no chevron, never presented as working.
 * - Manage account -> ?view=manage-account (same as profile card).
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
      <div className="mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
        <Card>
          <Badge tone="sun">Setup needed</Badge>
          <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">Connect Supabase to use accounts.</h1>
          <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">
            Add Roamly Supabase environment variables, then signup, login, sessions, and protected routes will activate.
          </p>
          <div className="mt-5">
            <Button href="/">Back home</Button>
          </div>
        </Card>
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
      <div className="calm-bleed mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
        <a href="/account" className="text-[15px] font-semibold text-cblue">
          ‹ Back to Account
        </a>

        {detailView === "manage-account" ? (
          <div id="manage-account" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4 shadow-calm">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Profile basics</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Name and access</h1>
            <div className="mt-5">
              <AccountProfileForm initialName={profileName} email={current.user.email || ""} />
            </div>
            <p className="mt-4 text-[13.5px] font-normal leading-[1.45] text-cgray">
              Password change and account deletion are not available here yet.
            </p>
            {profileResult.error ? (
              <p className="mt-4 text-[13.5px] font-normal leading-[1.45] text-cred">
                Profile table pending: {profileResult.error}. Apply the Roamly shared-auth profile migration to enable app-specific profile records.
              </p>
            ) : null}
          </div>
        ) : null}

        {detailView === "booking-wallet" ? (
          <div id="booking-wallet" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4 shadow-calm">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Email import</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Travel confirmations</h1>
            <div className="mt-5">
              <EmailConnectionSettings />
            </div>
          </div>
        ) : null}

        {detailView === "travelers" ? (
          <div id="travelers" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4 shadow-calm">
            <div id="traveler-memory" className="scroll-mt-24">
              <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Traveler memory</p>
              <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Preferences Roamly can use</h1>
              <div className="mt-5">
                <TravelerMemorySettings countryOptions={listCountryOptions()} returnTo={returnTo} />
              </div>
            </div>
          </div>
        ) : null}

        {detailView === "preferences" ? (
          <div id="preferences" className="mt-5 scroll-mt-24 rounded-2xl bg-white p-4 shadow-calm">
            <p className="text-[13px] font-normal uppercase tracking-[0.05em] text-cgray">Preferences</p>
            <h1 className="mt-1.5 text-[22px] font-bold tracking-[-0.018em] text-chead">Language and notifications</h1>
            <div className="mt-5 space-y-5">
              <div>
                <p className="mb-2 text-sm font-black text-ink">Language</p>
                <LanguageSwitcher />
              </div>
              <LocationTrackingSettings />
            </div>
            <p className="mt-4 text-[13.5px] font-normal leading-[1.45] text-cgray">
              No units setting exists yet.
            </p>
          </div>
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
              <p className="ml-4 text-[13.5px] font-normal leading-[1.45] text-cgray">
                Setup state is unavailable right now.
              </p>
            )}
          </div>
        ) : null}
      </div>
    );
  }

  // ---- Default view: the picture, and ONLY the picture. The content
  // ends at Sign out; no detail section renders below it. ----
  return (
    <div className="calm-bleed mx-auto w-full max-w-3xl px-4 pb-8 pt-5 sm:px-6">
      {/* Legacy /account#setup links from trip/live screens land here with
          no setup section on screen; map them to the ?view=setup detail
          view with the step anchor preserved. */}
      <AccountSetupHashRedirect />
      <div className="flex items-center justify-between">
        <h1 className="text-[30px] font-bold leading-[1.08] tracking-[-0.022em] text-chead">Account</h1>
        <a
          href="/account?view=manage-account"
          aria-label="Manage account"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-chead shadow-calm"
        >
          <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
            <circle cx="12" cy="12" r="3.2" />
            <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
          </svg>
        </a>
      </div>

      {/* Profile row — real session identity only. */}
      <a href="/account?view=manage-account" className="mt-5 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-calm">
        <span aria-hidden="true" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-chead text-[17px] font-bold text-white">
          {initials}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[17px] font-bold leading-snug text-chead">{displayName || displayEmail || "Account"}</span>
          {displayName && displayEmail ? (
            <span className="block truncate text-[13.5px] font-normal leading-snug text-cgray">{displayEmail}</span>
          ) : null}
        </span>
        <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
      </a>

      {/* Plan card — displays plan state; Upgrade goes to existing /pricing. */}
      <div className="mt-3 rounded-2xl bg-white p-4 shadow-calm">
        <div className="flex items-center gap-3">
          <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor">
              <path d="M3 7.5 5.6 4l4.1 3.2L12 3.4l2.3 3.8L18.4 4 21 7.5 19.4 17H4.6L3 7.5Zm2.2 11.5h13.6v1.6H5.2v-1.6Z" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-bold leading-snug text-chead">{plan.title}</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{plan.subtitle}</span>
          </span>
          <a
            href="/pricing"
            className="shrink-0 rounded-full px-4 py-2 text-[14px] font-bold text-cblue ring-1 ring-cblue/40"
          >
            Upgrade
          </a>
        </div>
      </div>

      {/* Main rows — each opens a real surface, except Saved places (no store). */}
      <div className="mt-3 divide-y divide-chair overflow-hidden rounded-2xl bg-white shadow-calm">
        <a href="/dashboard" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z" />
              <path d="M4 9.5h16M9 5v14" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">My trips</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">View, edit, and manage your trips</span>
          </span>
          {tripCount !== null ? (
            <span className="text-[16px] font-semibold text-chead">{tripCount}</span>
          ) : null}
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>

        <a href="/account?view=booking-wallet" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M3.5 7.5A1.5 1.5 0 0 1 5 6h14a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 18H5a1.5 1.5 0 0 1-1.5-1.5v-9Z" />
              <path d="M3.5 7.5 12 13l8.5-5.5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Booking Wallet</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{wallet.label}</span>
          </span>
          {wallet.connected ? (
            <span aria-label="Connected" className="h-2.5 w-2.5 shrink-0 rounded-full bg-cgreen" />
          ) : null}
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>

        <a href="/account?view=travelers" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="9" cy="8" r="3.2" />
              <path d="M3.5 19c.6-3 2.9-4.5 5.5-4.5S14 16 14.5 19M16 4.8a3.2 3.2 0 0 1 0 6.4M17.5 14.7c2 .5 3.2 2 3.5 4.3" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Travelers</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">{travelerSubtitle(partySize, travelerError)}</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>

        <a href="/pricing" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
              <path d="M3 10h18M7 15h4" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Payment &amp; Billing</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Manage your plan and payment method</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>

        <a href="/account?view=preferences" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="3.2" />
              <path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5 5l2.1 2.1M16.9 16.9L19 19M19 5l-2.1 2.1M7.1 16.9L5 19" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Preferences</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Language, units, notifications</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>

        {/* Saved places: NO store or surface exists in the app, so this is
            an honest unavailable row — not a link, no chevron, no invented
            favorites. It must never be presented as working. */}
        <div aria-disabled="true" className="flex items-center gap-3 px-4 py-3.5 opacity-70">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M12 20.5S4.5 15.6 4.5 9.6a7.5 7.5 0 0 1 15 0c0 6-7.5 10.9-7.5 10.9Z" />
              <circle cx="12" cy="9.6" r="2.6" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Saved places</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Not available yet</span>
          </span>
        </div>

        <a href="/account?view=manage-account" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="8" r="3.5" />
              <path d="M5 20c.8-3.5 3.2-5 7-5s6.2 1.5 7 5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Manage account</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Update your email, password, or delete account</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>
      </div>

      {/* Help & Support — real surfaces: /help and /contact. */}
      <p className="mb-2 ml-4 mt-7 text-[19px] font-bold tracking-[-0.018em] text-chead">Help &amp; Support</p>
      <div className="divide-y divide-chair overflow-hidden rounded-2xl bg-white shadow-calm">
        <a href="/help" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <circle cx="12" cy="12" r="8.5" />
              <path d="M9.6 9.2a2.4 2.4 0 0 1 4.7.9c0 1.6-2.3 1.8-2.3 3.1M12 17.2v.3" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Help Center</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">Get answers and travel tips</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>
        <a href="/contact" className="flex items-center gap-3 px-4 py-3.5">
          <span aria-hidden="true" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] bg-cbg text-cblue">
            <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M4 6.5A1.5 1.5 0 0 1 5.5 5h13A1.5 1.5 0 0 1 20 6.5v11a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 17.5v-11Z" />
              <path d="M4 9 12 14l8-5" />
            </svg>
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[16px] font-semibold leading-snug text-chead">Contact Support</span>
            <span className="block text-[13.5px] font-normal leading-snug text-cgray">We&apos;re here to help</span>
          </span>
          <span aria-hidden="true" className="text-[22px] font-normal leading-none text-cgray2">›</span>
        </a>
      </div>

      {/* Sign out — the EXISTING auth sign-out, nothing new invented.
          The picture's content ENDS here. */}
      <form action="/auth/logout" method="post" className="mt-3">
        <button
          type="submit"
          className="w-full rounded-2xl bg-red-50 py-3.5 text-center text-[16px] font-semibold text-cred shadow-calm"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
