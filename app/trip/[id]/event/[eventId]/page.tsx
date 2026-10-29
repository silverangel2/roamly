import { redirect } from "next/navigation";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getRoamlySetupState } from "@/lib/roamly/setupState";
import { getTripOriginLabel } from "@/lib/roamly/tripMetadata";
import { tripIdentityLine } from "@/lib/roamly/tripIdentity";

/*
 * Single-event view (owner alert model, 2026-10-23): where a phone
 * notification tap — and the timeline's Open — lands. One event, its
 * details, calm and complete; one quiet link to the full itinerary;
 * nothing else. Alerts are temporary guests, never furniture: this
 * page is the moment, and then it's gone. One exception (Round 2,
 * B2): a country_info sheet also links onward to the tabbed
 * country-info page for this trip, so the sheet's notes have a full
 * home instead of being the only country surface.
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

function metadataRecord(metadata: unknown, key: string): Record<string, unknown> | null {
  if (!metadata || typeof metadata !== "object") return null;
  const value = (metadata as Record<string, unknown>)[key];
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

/*
 * Destination content is computed at companion-schedule time and stored
 * under trip.metadata.companion (see lib/roamly/tripCompanion.ts); this
 * sheet only RENDERS those stored strings. It never invents travel
 * advice or country facts: when the stored content is absent, the sheet
 * says so plainly instead of filling the gap.
 */
function companionContent(metadata: unknown) {
  const companion = metadataRecord(metadata, "companion");
  if (!companion) return { travelCountryInfo: null, packingChecklist: [], documentChecklist: [] };
  const info = metadataRecord(companion, "travelCountryInfo");
  return {
    travelCountryInfo: info
      ? {
          title: typeof info.title === "string" && info.title.trim() ? info.title : null,
          summary: typeof info.summary === "string" && info.summary.trim() ? info.summary : null,
          reminders: stringList(info.reminders),
          // Round 2, HIGH 4: the builder stores the trip's route type
          // (see lib/roamly/tripCompanion.ts buildCountryInfo). A stored
          // domestic record must never render cross-border bullets, even
          // if it was written before the builder fix.
          routeType: typeof info.routeType === "string" ? info.routeType : null
        }
      : null,
    packingChecklist: stringList(companion.packingChecklist),
    documentChecklist: stringList(companion.documentChecklist)
  };
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
      .select("id,destination,origin,start_date,end_date,metadata")
      .eq("id", id)
      .eq("user_id", current.user.id)
      .maybeSingle()
  ]);
  const trip = tripResult.data as {
    id: string;
    destination: string | null;
    origin: string | null;
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

  // Round 2 trip identity: every event sheet names the trip it belongs
  // to — destination + dates + origin, from THIS trip's own row only
  // (the event query above is already scoped eq trip_id + eq user_id,
  // so another trip's event can never reach this sheet). Missing
  // pieces are omitted, never invented.
  const tripIdentity = tripIdentityLine({
    destination: trip.destination,
    origin: getTripOriginLabel({ origin: trip.origin, metadata: trip.metadata }),
    startDate: trip.start_date,
    endDate: trip.end_date
  });

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
    <a
      href={`/trip/${id}`}
      className="mt-[22px] flex min-h-12 items-center gap-2.5 rounded-xl bg-cbg px-4 text-[16.5px] font-medium text-chead"
    >
      See the full itinerary
      <span aria-hidden className="ml-auto text-xl leading-none text-cchev">
        ›
      </span>
    </a>
  );

  const sheetClass =
    "calm-sheet w-full max-sm:flex-1 rounded-t-[20px] bg-white px-5 pb-10 pt-2.5 shadow-sheet sm:mt-16 sm:rounded-[20px]";
  const grabHandle = (
    <span aria-hidden className="mx-auto mb-[18px] block h-[5px] w-9 rounded-full bg-chair" />
  );

  if (!event) {
    return (
      <div className="calm-bleed mx-auto flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col px-0 sm:px-6">
        <section className={sheetClass}>
          {grabHandle}
          {tripIdentity ? (
            <p className="mb-2 text-[13px] font-semibold uppercase tracking-[0.05em] text-cgray">{tripIdentity}</p>
          ) : null}
          <h1 className="text-[26px] font-bold leading-[1.15] tracking-[-0.018em] text-chead">This update is no longer here.</h1>
          <p className="mt-3 text-[16.5px] font-normal leading-[1.5] text-cink">
            It was for a moment that has passed — your itinerary holds everything that still matters.
          </p>
          {itineraryLink}
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

  // Destination panel: the stored companion content for this trip, shown
  // only for the three pre-trip info types whose cards promise it.
  const companion = companionContent(trip.metadata);
  const destinationPanel = (() => {
    if (event.event_type === "country_info") {
      const info = companion.travelCountryInfo;
      if (!info || (!info.title && !info.summary && info.reminders.length === 0)) {
        return { heading: "Travel notes", unavailable: "Travel notes are not available for this trip yet", items: [] as string[], summary: null as string | null };
      }
      // Round 2, HIGH 4 guard: a domestic record renders zero
      // passport/embassy/roaming bullets, whatever the stored list holds.
      const items =
        info.routeType === "domestic"
          ? info.reminders.filter((item) => !/passport|embassy|consulate|roaming|eSIM|visa|entry documents/i.test(item))
          : info.reminders;
      return { heading: info.title || "Travel notes", unavailable: null, items, summary: info.summary };
    }
    if (event.event_type === "document_check") {
      if (companion.documentChecklist.length === 0) {
        return { heading: "Document checklist", unavailable: "The document checklist is not available for this trip yet", items: [] as string[], summary: null as string | null };
      }
      return { heading: "Document checklist", unavailable: null, items: companion.documentChecklist, summary: null as string | null };
    }
    if (event.event_type === "one_week_before") {
      const preparation = [...companion.packingChecklist, ...companion.documentChecklist.filter((item) => !companion.packingChecklist.includes(item))];
      if (preparation.length === 0) {
        return { heading: "Preparation checklist", unavailable: "The preparation checklist is not available for this trip yet", items: [] as string[], summary: null as string | null };
      }
      return { heading: "Preparation checklist", unavailable: null, items: preparation, summary: null as string | null };
    }
    return null;
  })();

  return (
    <div className="calm-bleed mx-auto flex min-h-[calc(100dvh-6.5rem-env(safe-area-inset-bottom))] w-full max-w-2xl flex-col px-0 sm:px-6">
      <section className={sheetClass}>
        {grabHandle}
        <p className="text-xs font-semibold uppercase tracking-[0.09em] text-cgray">
          {typeLabel(event.event_type)}
        </p>
        {tripIdentity ? (
          <p className="mt-1.5 text-[15px] font-normal text-cgray">{tripIdentity}</p>
        ) : null}
        <h1 className="mt-1.5 text-[26px] font-bold leading-[1.15] tracking-[-0.018em] text-chead">
          {event.title || "Roamly update"}
        </h1>
        {when ? (
          <p className="mt-1.5 text-[15px] font-normal text-cgray">
            {when}
            {trip.destination ? ` · ${trip.destination}` : ""}
          </p>
        ) : null}
        {event.body ? (
          <p className="mt-3.5 whitespace-pre-line text-[16.5px] font-normal leading-[1.5] text-cink">
            {event.body}
          </p>
        ) : null}
        {place ? <p className="mt-3 text-[15px] font-normal text-cgray">{place}</p> : null}
        {destinationPanel ? (
          <section className="mt-5 border-t border-chair pt-[15px]">
            <h2 className="text-[19px] font-bold tracking-[-0.018em] text-chead">{destinationPanel.heading}</h2>
            {destinationPanel.unavailable ? (
              <p className="mt-2 text-[16.5px] font-normal leading-[1.5] text-cink">{destinationPanel.unavailable}</p>
            ) : (
              <>
                {destinationPanel.summary ? (
                  <p className="mt-2 text-[16.5px] font-normal leading-[1.5] text-cink">{destinationPanel.summary}</p>
                ) : null}
                <ul className="mt-3 space-y-2">
                  {destinationPanel.items.map((item) => (
                    <li key={item} className="flex gap-2.5 text-[16.5px] font-normal leading-[1.5] text-cink">
                      <span aria-hidden className="mt-[9px] h-[6px] w-[6px] shrink-0 rounded-full bg-cgray2" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </section>
        ) : null}
        {event.event_type === "country_info" ? (
          <a
            href={`/trip/${id}/country-info`}
            className="mt-5 flex min-h-12 items-center gap-2.5 rounded-xl bg-cbg px-4 text-[16.5px] font-medium text-chead"
          >
            Open the full country info page
            <span aria-hidden className="ml-auto text-xl leading-none text-cchev">
              ›
            </span>
          </a>
        ) : null}
        {setupInvitation ? (
          <p className="mt-5 border-t border-chair pt-[15px] text-[15px] font-normal leading-[1.5] text-cgray">
            One last thing for today: finish setup so Booking Recon is activated, Roamly can reach you in
            the moment, and the companion can go live.{" "}
            <a href="/account#setup" className="font-semibold text-cblue">
              Finish setup
            </a>
          </p>
        ) : null}
        {itineraryLink}
      </section>
    </div>
  );
}
