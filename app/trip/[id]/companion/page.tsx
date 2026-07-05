import { redirect } from "next/navigation";
import { NotificationPermissionCard } from "@/components/roamly/NotificationPermissionCard";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";

export default async function CompanionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getCurrentUser();
  if (current.configured && !current.user) redirect(`/login?next=${encodeURIComponent(`/trip/${id}/companion`)}`);
  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const unlocked = isTripLocked(bundle.data.trip) && tripHasTrackingUnlock(bundle.data.trip);

  return (
    <main className="safe-bottom mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <section className="rounded-[2rem] bg-ink p-5 text-white shadow-soft sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-lagoon">Live Trip Companion</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight sm:text-5xl">
          {unlocked ? "Set up phone reminders." : "Unlock the companion for this trip."}
        </h1>
        <p className="mt-3 text-sm font-bold leading-6 text-white/74">
          Roamly keeps the trip timeline, booking reminders, nearby activities, check-ins, and up-next guidance in one
          mobile-friendly place.
        </p>
        <div className="mt-5">
          <Button href={`/trip/${id}/live`} className="bg-white text-ink hover:bg-lagoon">
            Open live trip
          </Button>
        </div>
      </section>

      <section className="mt-5 grid gap-4">
        {unlocked ? (
          <NotificationPermissionCard />
        ) : (
          <Card>
            <h2 className="text-2xl font-black text-ink">Live Trip Companion is not unlocked yet.</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              Add the companion to use phone reminders, check-ins, skips, nearby sensing, and travel-day guidance.
            </p>
            <div className="mt-5">
              <Button href={`/trip/${id}`}>Return to trip</Button>
            </div>
          </Card>
        )}

        <Card>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">What reminders cover</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {["Packing and documents", "Booking and check-in times", "Nearby activities and up next"].map((item) => (
              <p key={item} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                {item}
              </p>
            ))}
          </div>
        </Card>
      </section>
    </main>
  );
}
