import { redirect } from "next/navigation";
import { ManualBookingForm } from "@/components/companion/ManualBookingForm";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle } from "@/lib/trips";
import { resolveAffiliateReferral } from "@/lib/roamly/affiliateTracking";

export default async function AddTripBookingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const current = await getCurrentUser();

  if (current.configured && !current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}/bookings/add`)}`);
  }

  if (!current.configured || !current.user) redirect("/dashboard");

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect("/dashboard");

  const bundle = await getTripBundle(supabase, current.user.id, id);
  if (!bundle.data) redirect("/dashboard?tripAccess=denied");

  const affiliateClickId = typeof search.affiliateClickId === "string" ? search.affiliateClickId : "";
  const recommendationId = typeof search.recommendationId === "string" ? search.recommendationId : "";
  const referral = affiliateClickId
    ? await resolveAffiliateReferral({
        supabase,
        userId: current.user.id,
        tripId: id,
        affiliateClickId,
        recommendationId: recommendationId || null
      })
    : { referral: null, error: null };

  return (
    <main className="safe-bottom min-h-[calc(100dvh-5rem)] bg-[#fbf8ef] text-ink">
      <ManualBookingForm
        tripId={id}
        referral={referral.referral ? {
          affiliateClickId: referral.referral.id,
          recommendationId: referral.referral.recommendation_id,
          provider: referral.referral.provider,
          title: referral.referral.recommendationTitle,
          bookingType: referral.referral.category
        } : null}
      />
    </main>
  );
}
