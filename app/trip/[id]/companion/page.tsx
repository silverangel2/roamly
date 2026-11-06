import { redirect } from "next/navigation";
import { NotificationPermissionCard } from "@/components/roamly/NotificationPermissionCard";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
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

  const locked = isTripLocked(bundle.data.trip);
  const companionUnlocked = tripHasTrackingUnlock(bundle.data.trip);
  const unlocked = locked && companionUnlocked;

  return (
    <div className="safe-bottom mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <section className="bui-enter overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-5 text-chead shadow-bui-hero sm:p-7">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Live Trip Companion</p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-chead sm:text-5xl">
          {unlocked ? "Set up phone reminders." : "Unlock the companion for this trip."}
        </h1>
        <p className="mt-3 text-sm font-bold leading-6 text-cink">
          Roamly keeps the trip timeline, booking reminders, nearby activities, check-ins, and up-next guidance in one
          mobile-friendly place.
        </p>
        <div className="mt-5">
          <BuiButtonLink href={`/trip/${id}/live`}>
            Open live trip
          </BuiButtonLink>
        </div>
      </section>

      <section className="mt-5 grid gap-4">
        {unlocked ? (
          <NotificationPermissionCard />
        ) : (
          <BuiCard className="bui-enter p-5">
            <h2 className="text-2xl font-black text-chead">Live Trip Companion is not unlocked yet.</h2>
            <p className="mt-2 text-sm font-bold leading-6 text-cink">
              Add the companion to use phone reminders, check-ins, skips, nearby sensing, and travel-day guidance.
            </p>
            <div className="mt-5">
              <BuiButtonLink href={`/trip/${id}`}>Return to trip</BuiButtonLink>
            </div>
          </BuiCard>
        )}

        <BuiCard className="bui-enter p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">What reminders cover</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            {["Packing and documents", "Booking and check-in times", "Nearby activities and up next"].map((item) => (
              <p key={item} className="rounded-xl border border-chair bg-cbg px-4 py-3 text-sm font-black text-cink">
                {item}
              </p>
            ))}
          </div>
        </BuiCard>
      </section>
    </div>
  );
}
