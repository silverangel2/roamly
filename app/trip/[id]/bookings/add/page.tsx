import { redirect } from "next/navigation";
import { ManualBookingForm } from "@/components/companion/ManualBookingForm";
import { BackHeader } from "@/components/roamly/BackHeader";
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
    <div className="safe-bottom min-h-[calc(100dvh-5rem)] bg-cbg text-ink">
      {/* Jakob's Law A1 (2026-11-03): page-level BackHeader in the
          conventional top-left spot, returning to Bookings — the
          surface this form is opened from. ManualBookingForm keeps
          its own in-form "Back" link as well: it sits in the form's
          upload / manual / back action row and serves the form's
          step flow, so removing it would change the form, not just
          this page's chrome. */}
      <div className="mx-auto w-full max-w-3xl px-4 pt-5 sm:px-6">
        <BackHeader href={`/trip/${id}/bookings`} label="Bookings" />
      </div>
      <ManualBookingForm
        tripId={id}
        tripCurrency={bundle.data.trip.budget_currency ?? null}
        referral={referral.referral ? {
          affiliateClickId: referral.referral.id,
          recommendationId: referral.referral.recommendation_id,
          provider: referral.referral.provider,
          title: referral.referral.recommendationTitle,
          bookingType: referral.referral.category
        } : null}
      />
    </div>
  );
}
