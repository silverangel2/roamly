import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { listPlanComments } from "@/lib/roamly/planComments";
import { TripCommentForm } from "@/components/trip/TripCommentForm";

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
      <section
        aria-label="Notes for your trip"
        className="roamly-enter mb-5 rounded-3xl border border-ocean/25 bg-white/90 px-5 py-6 shadow-[0_12px_34px_rgba(16,32,51,0.06)] sm:px-7"
      >
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Notes for your trip</p>
        <h2 className="mt-2 text-xl font-black tracking-tight text-ink">Tell us anything</h2>
        <p className="mt-1 max-w-2xl text-sm font-semibold leading-6 text-slate-600">
          Your words steer your plan — pace, food, mobility, must-haves. Only you can see these notes.
        </p>
        {result.comments.length ? (
          <ul className="mt-4 grid gap-2">
            {result.comments.map((comment) => (
              <li
                key={comment.id}
                className="rounded-2xl bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700"
              >
                {comment.body}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm font-medium leading-6 text-slate-500">
            No notes yet — write the first one. &ldquo;No early mornings&rdquo; works perfectly.
          </p>
        )}
        <div className="mt-4">
          <TripCommentForm tripId={tripId} />
        </div>
      </section>
    );
  } catch {
    return null;
  }
}
