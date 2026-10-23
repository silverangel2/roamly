import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getRoamlySetupState } from "@/lib/roamly/setupState";

/*
 * Single-event view (owner alert model, 2026-10-23): where a phone
 * notification tap — and the timeline's Open — lands. One event, its
 * details, calm and complete; one quiet link to the full itinerary;
 * nothing else. Alerts are temporary guests, never furniture: this
 * page is the moment, and then it's gone.
 */

type EventPageProps = {
  params: Promise<{ id: string; eventId: string }>;
};

function typeLabel(type: string) {
  return type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatWhen(value: string | null, timeZone: string | null) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      ...(timeZone ? { timeZone } : {})
    }).format(date);
  } catch {
    return date.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }
}

function metadataString(metadata: unknown, key: string): string | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export default async function TripEventPage({ params }: EventPageProps) {
  const { id, eventId } = await params;
  const current = await getCurrentUser();
  if (!current.configured) redirect(`/trip/${id}`);
  if (!current.user) redirect(`/login?next=/trip/${id}/event/${eventId}`);

  const supabase = await createSupabaseServerClient();
  if (!supabase) redirect(`/trip/${id}`);

  const [eventResult, tripResult] = await Promise.all([
    supabase
      .from("roamly_trip_companion_events")
      .select("id,trip_id,event_type,title,body,scheduled_for,status,metadata")
      .eq("id", eventId)
      .eq("trip_id", id)
      .eq("user_id", current.user.id)
      .maybeSingle(),
    supabase
      .from("roamly_trips")
      .select("id,destination,start_date,end_date,metadata")
      .eq("id", id)
      .eq("user_id", current.user.id)
      .maybeSingle()
  ]);
  const trip = tripResult.data as {
    id: string;
    destination: string | null;
    start_date: string | null;
    end_date: string | null;
    metadata: unknown;
  } | null;
  const event = eventResult.data as {
    id: string;
    event_type: string;
    title: string | null;
    body: string | null;
    scheduled_for: string | null;
    status: string;
    metadata: unknown;
  } | null;

  if (!trip) redirect("/dashboard");

  // Opening the event is reading it: clear the unread marker on the
  // notification rows minted from this event (best effort).
  await supabase
    .from("roamly_notifications")
    .update({ status: "read" })
    .eq("user_id", current.user.id)
    .eq("event_id", eventId)
    .eq("status", "unread")
    .then(() => undefined, () => undefined);

  const itineraryLink = (
    <a href={`/trip/${id}`} className="text-sm font-bold text-ocean underline underline-offset-2">
      See the full itinerary
    </a>
  );

  if (!event) {
    return (
      <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-2xl items-start px-4 py-10 sm:px-6">
        <section className="w-full rounded-[1.75rem] border border-cloud bg-white/90 p-6 shadow-soft sm:p-8">
          <h1 className="text-2xl font-black tracking-tight text-ink">This update is no longer here.</h1>
          <p className="mt-3 text-base font-semibold leading-7 text-slate-600">
            It was for a moment that has passed — your itinerary holds everything that still matters.
          </p>
          <p className="mt-5">{itineraryLink}</p>
        </section>
      </div>
    );
  }

  const timeZone =
    metadataString(event.metadata, "timezone") ||
    metadataString(event.metadata, "timeZone") ||
    metadataString(trip.metadata, "timezone");
  const when = formatWhen(event.scheduled_for, timeZone);
  const place =
    metadataString(event.metadata, "placeName") ||
    metadataString(event.metadata, "activityName") ||
    metadataString(event.metadata, "address");

  // The travel-day catch, once (owner design, 2026-10-23): the one
  // alert allowed to invite finishing setup — in the moment, then gone.
  let setupInvitation = false;
  if (event.event_type === "travel_day_started") {
    const setup = await getRoamlySetupState(supabase, current.user).catch(() => null);
    setupInvitation = setup ? !setup.complete : false;
  }

  return (
    <div className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-2xl items-start px-4 py-10 sm:px-6">
      <section className="w-full rounded-[1.75rem] border border-cloud bg-white/90 p-6 shadow-soft sm:p-8">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
          {typeLabel(event.event_type)}
        </p>
        <h1 className="mt-2 text-3xl font-black tracking-tight text-ink">
          {event.title || "Roamly update"}
        </h1>
        {when ? (
          <p className="mt-2 text-sm font-bold text-slate-500">
            {when}
            {trip.destination ? ` · ${trip.destination}` : ""}
          </p>
        ) : null}
        {event.body ? (
          <p className="mt-4 whitespace-pre-line text-base font-semibold leading-7 text-slate-600">
            {event.body}
          </p>
        ) : null}
        {place ? <p className="mt-3 text-sm font-bold text-slate-500">{place}</p> : null}
        {setupInvitation ? (
          <p className="mt-5 rounded-2xl bg-mist px-4 py-3 text-sm font-semibold leading-6 text-slate-600">
            One last thing for today: finish setup so Roamly can watch your bookings, reach you in the
            moment, and keep the companion live.{" "}
            <a href="/account#setup" className="font-bold text-ocean underline underline-offset-2">
              Finish setup
            </a>
          </p>
        ) : null}
        <p className="mt-6 border-t border-slate-100 pt-4">{itineraryLink}</p>
      </section>
    </div>
  );
}
