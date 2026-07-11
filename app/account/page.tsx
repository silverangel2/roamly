import { redirect } from "next/navigation";
import { AccountProfileForm } from "@/components/account/AccountProfileForm";
import { LocationTrackingSettings } from "@/components/account/LocationTrackingSettings";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary } from "@/lib/roamly/billing";
import { ensureRoamlyProfile } from "@/lib/roamly/profile";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";

export default async function AccountPage() {
  const current = await getCurrentUser();

  if (!current.configured) {
    return (
      <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
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
      </main>
    );
  }

  if (!current.user) {
    redirect("/login?next=/account");
  }

  const supabase = await createSupabaseServerClient();
  const [profileResult, free] = await Promise.all([
    supabase ? ensureRoamlyProfile(current.user, {}, supabase) : Promise.resolve({ profile: null, error: "" }),
    supabase ? hasUsedFreeItinerary(supabase, current.user.id) : Promise.resolve({ used: false, entitlement: null, error: null })
  ]);
  const metadataName =
    typeof current.user.user_metadata?.full_name === "string"
      ? current.user.user_metadata.full_name
      : typeof current.user.user_metadata?.name === "string"
        ? current.user.user_metadata.name
        : "";
  const profileName = profileResult.profile?.full_name || metadataName || "";
  const access = getRoamlyAccessForUser(current.user.email);

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[0.85fr_1.15fr]">
        <section className="space-y-4">
          <Badge>Account</Badge>
          {access.hasQaAccess ? <Badge tone="ocean">Tester access</Badge> : null}
          <h1 className="text-4xl font-black tracking-tight text-ink sm:text-6xl">Your Roamly profile.</h1>
          <p className="text-base font-semibold leading-7 text-slate-600">
            Keep the profile simple. Roamly only needs the identity required for trips, ownership, and support.
          </p>
          <div className="grid gap-3">
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Account type</p>
              <p className="mt-2 text-2xl font-black text-ink">{access.hasQaAccess ? "Tester access" : "Free user"}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">
                {access.hasQaAccess
                  ? "Tester access unlocks paid feature checks without creating Stripe revenue."
                  : "Payments unlock one itinerary or Live Trip Companion for one trip."}
              </p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sun">Free itinerary</p>
              <p className="mt-2 text-2xl font-black text-ink">{access.hasQaAccess ? "Tester override" : free.used ? "Used" : "Available"}</p>
              <p className="mt-1 text-sm font-bold text-slate-500">You get 1 free itinerary per account.</p>
            </Card>
          </div>
        </section>

        <section className="space-y-4">
          <Card>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Profile basics</p>
            <h2 className="mt-2 text-2xl font-black text-ink">Name and access</h2>
            <div className="mt-5">
              <AccountProfileForm initialName={profileName} email={current.user.email || ""} />
            </div>
          </Card>

          <Card>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Privacy controls</p>
            <h2 className="mt-2 text-2xl font-black text-ink">Trip privacy and reminders</h2>
            <div className="mt-5">
              <LocationTrackingSettings />
            </div>
          </Card>

          {profileResult.error ? (
            <div className="rounded-app border border-amber-200 bg-amber-50 p-5 text-amber-900 shadow-soft">
              <p className="text-xs font-black uppercase tracking-[0.18em]">Profile table pending</p>
              <p className="mt-2 text-sm font-bold leading-6">
                {profileResult.error}. Apply the Roamly shared-auth profile migration to enable app-specific profile records.
              </p>
            </div>
          ) : null}
        </section>
      </div>
    </main>
  );
}
