import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { translateExactText } from "@/lib/i18n";
import { getServerLocale } from "@/lib/i18n-server";
import { listPlanComments } from "@/lib/roamly/planComments";
import { TripCommentForm } from "@/components/trip/TripCommentForm";
import { BuiCard } from "@/components/boardui/Card";

/**
 * Plan-level comment box, mounted at the top of the Itinerary tab.
 *
 * Traveler-honest label: the notes tell Roamly how to steer the plan.
 * Owner-only: renders nothing for signed-out users, foreign trips, or while
 * the 20261016000200_plan_comments.sql migration is unapplied (fail-soft —
 * the itinerary page never breaks because of this card).
 *
 * Ship path: components/trip/TripCommentBox.tsx
 * Mount (app/trip/[id]/page.tsx, inside the day-by-day panel, right after
 * the "Your itinerary" SectionHeading):
 *   {canShowFull && full ? <TripCommentBox tripId={id} /> : null}
 */
export async function TripCommentBox({ tripId }: { tripId: string }) {
  const locale = await getServerLocale();
  try {
    const current = await getCurrentUser();
    if (!current.configured || !current.user) return null;
    const supabase = await createSupabaseServerClient();
    if (!supabase) return null;

    const result = await listPlanComments({
      supabase,
      userId: current.user.id,
      tripId
    });
    // TRIP_NOT_FOUND → not the caller's trip: render nothing. TABLE_UNAVAILABLE
    // → migration unapplied: render nothing (the box appears after the paste).
    if (result.error) return null;

    return (
      <BuiCard
        role="region"
        aria-label={translateExactText(locale, "Notes for your trip")}
        className="bui-enter mb-5 px-5 py-6 sm:px-7"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">{translateExactText(locale, "Notes for your trip")}</p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-ink">{translateExactText(locale, "Tell us anything")}</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-cgray">
          {translateExactText(locale, "Your words steer your plan \u2014 pace, food, mobility, must-haves. Only you can see these notes.")}
        </p>
        {result.comments.length ? (
          <ul className="mt-4 grid gap-2">
            {result.comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-2xl bg-csoft px-4 py-3 text-sm leading-6 text-ink"
              >
                {comment.body}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm font-medium leading-6 text-cgray">
            {translateExactText(locale, "No notes yet \u2014 write the first one. \u201cNo early mornings\u201d works perfectly.")}
          </p>
        )}
        <div className="mt-4">
          <TripCommentForm tripId={tripId} />
        </div>
      </BuiCard>
    );
  } catch {
    return null;
  }
}
