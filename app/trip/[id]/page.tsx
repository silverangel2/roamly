import { redirect } from "next/navigation";
import { ActivateTripButton } from "@/components/trip/ActivateTripButton";
import { BookingCards } from "@/components/trip/BookingCards";
import { CheckoutUrlCleanup } from "@/components/trip/CheckoutUrlCleanup";
import { GenerateLockedItineraryButton } from "@/components/trip/GenerateLockedItineraryButton";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";
import { TripBookingsManager } from "@/components/roamly/TripBookingsManager";
import { Badge } from "@/components/ui/Badge";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { buildPreviewFromItinerary, type RoamlyItinerary, type RoamlyPreview } from "@/lib/itinerary";
import { confirmCheckoutSessionForTrip } from "@/lib/payments";
import { buildAttractionAffiliateUrl } from "@/lib/roamly/affiliateLinks";
import { getRoamlyAccessForUser } from "@/lib/roamly/access";
import { hasUsedFreeItinerary, isTripLocked, tripHasTrackingUnlock } from "@/lib/roamly/billing";
import { recordAppEvent } from "@/lib/roamly/events";
import { createRoamlySessionToken } from "@/lib/roamly/session-token";
import { createSupabaseServerClient, getCurrentUser } from "@/lib/supabase/server";
import { getTripBundle, groupActivitiesByDay, isMissingTableError } from "@/lib/trips";

type TripPageProps = {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function SetupCard({ title, summary }: { title: string; summary: string }) {
  return (
    <main className="safe-bottom mx-auto flex min-h-[calc(100dvh-7rem)] w-full max-w-4xl items-center px-4 py-8 sm:px-6">
      <Card>
        <Badge tone="sun">Setup</Badge>
        <h1 className="mt-4 text-3xl font-black text-ink sm:text-5xl">{title}</h1>
        <p className="mt-3 text-sm font-semibold leading-6 text-slate-600">{summary}</p>
        <div className="mt-5">
          <Button href="/plan">Plan trip</Button>
        </div>
      </Card>
    </main>
  );
}

function LockedCard({ title, text }: { title: string; text: string }) {
  return (
    <div className="rounded-[1.5rem] border border-cloud bg-white/80 p-4 shadow-soft">
      <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">Locked</p>
      <h3 className="mt-2 text-lg font-black text-ink">{title}</h3>
      <p className="mt-2 text-sm font-bold leading-5 text-slate-500">{text}</p>
    </div>
  );
}

function DayCard({
  day,
  destination,
  tripId
}: {
  day: RoamlyItinerary["daily_itinerary"][number];
  destination: string;
  tripId: string;
}) {
  const activityLink = buildAttractionAffiliateUrl({
    category: "tour",
    destination,
    query: `${destination} ${day.title} tours tickets activities`
  });
  return (
    <article className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            Day {day.day_number}{day.city ? ` · ${day.city}` : ""}
          </p>
          <h3 className="mt-1 text-2xl font-black text-ink">{day.title}</h3>
        </div>
        <span className="w-fit rounded-full bg-mist px-3 py-2 text-xs font-black text-slate-600">
          Est. ${day.estimated_cost}
        </span>
      </div>

      <div className="mt-4 grid gap-3">
        {[
          ["Morning", day.morning],
          ["Afternoon", day.afternoon],
          ["Evening", day.evening]
        ].map(([label, value]) => (
          <div key={label} className="rounded-2xl bg-mist p-4">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">{label}</p>
            <p className="mt-1 text-sm font-bold leading-6 text-slate-600">{value}</p>
          </div>
        ))}
        <div className="grid gap-3">
          {day.map_queries.slice(0, 4).map((query) => (
            <div key={query} className="rounded-2xl border border-cloud bg-white px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">{query}</p>
              <NavigationButtons tripId={tripId} destinationLabel={query} address={query} showHeading className="mt-3" />
            </div>
          ))}
          <a
            href={activityLink.href}
            target="_blank"
            rel="noreferrer"
            className="rounded-full bg-ocean/10 px-3 py-2 text-xs font-black text-ocean ring-1 ring-ocean/15"
          >
            Find tours for this day
          </a>
        </div>
      </div>
    </article>
  );
}

function PreviewDayCard({ item }: { item: RoamlyPreview["day_outline"][number] }) {
  const legacyActivityKey = "sam" + "ple_activity";
  const activityPreview =
    item.activity_preview || (item as unknown as Record<string, string>)[legacyActivityKey] || "";

  return (
    <Card className="p-4">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Day {item.day_number}</p>
      <h3 className="mt-2 text-xl font-black text-ink">{item.title}</h3>
      <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{activityPreview}</p>
    </Card>
  );
}

function isItineraryPaid(trip: {
  itinerary_payment_status?: string | null;
  itinerary_unlock_source?: string | null;
}) {
  return (
    trip.itinerary_payment_status === "paid" ||
    trip.itinerary_payment_status === "bundled" ||
    trip.itinerary_unlock_source === "paid" ||
    trip.itinerary_unlock_source === "bundle" ||
    trip.itinerary_unlock_source === "admin"
  );
}

export default async function TripPage({ params, searchParams }: TripPageProps) {
  const { id } = await params;
  const search = searchParams ? await searchParams : {};
  const current = await getCurrentUser();

  if (!current.configured) {
    return <SetupCard title="Connect Supabase to open trips." summary="Roamly trips need the roamly_ tables and Supabase auth." />;
  }

  if (!current.user) {
    redirect(`/login?next=${encodeURIComponent(`/trip/${id}`)}`);
  }

  const sessionId = one(search.session_id);
  let checkoutSyncError = "";
  const access = getRoamlyAccessForUser(current.user.email);
  const apiAuthToken = createRoamlySessionToken(current.user);
  if (sessionId && one(search.checkout) === "success") {
    const confirmation = await confirmCheckoutSessionForTrip({ sessionId, tripId: id, userId: current.user.id });
    if (!confirmation.ok) {
      checkoutSyncError = confirmation.error || "Checkout confirmation failed.";
      console.error("[Roamly trip] Checkout confirmation failed", {
        tripId: id,
        userId: current.user.id,
        error: checkoutSyncError
      });
    }
  }

  const supabase = await createSupabaseServerClient();
  if (!supabase) {
    return <SetupCard title="Supabase is unavailable." summary="Check Roamly environment variables." />;
  }

  if (one(search.checkout) === "cancelled") {
    await recordAppEvent(supabase, {
      userId: current.user.id,
      eventType: "checkout_cancelled",
      metadata: { tripId: id }
    });
  }

  const [bundleResult, freeResult] = await Promise.all([
    getTripBundle(supabase, current.user.id, id),
    hasUsedFreeItinerary(supabase, current.user.id)
  ]);

  if (!bundleResult.data) {
    if (isMissingTableError(bundleResult.error)) {
      return (
        <SetupCard
          title="Trip tables are not ready."
          summary="Run the Roamly schema, tracking, itinerary locking, and budget/booking/companion migrations, then generate the trip again."
        />
      );
    }
    redirect("/dashboard?tripAccess=denied");
  }

  const { trip, itinerary, checklist, activities } = bundleResult.data;
  const full = itinerary?.full_json || null;
  const itineraryLocked = isTripLocked(trip);
  const trackingUnlocked = tripHasTrackingUnlock(trip) || (access.hasQaAccess && itineraryLocked);
  const paidForItinerary = isItineraryPaid(trip) || access.hasQaAccess;
  const checkoutNeedsAttention = Boolean(checkoutSyncError && !paidForItinerary && !trackingUnlocked);
  const checkoutStartFailed = one(search.checkout) === "failed";
  const shouldCleanCheckoutUrl = Boolean((one(search.checkout) || sessionId) && !checkoutNeedsAttention);
  const freeAvailable = !freeResult.used;
  const generationRequiresPayment = !itineraryLocked && !paidForItinerary && !freeAvailable;
  const preview = full ? buildPreviewFromItinerary(full) : itinerary?.preview_json || null;
  const canShowFull = Boolean(itineraryLocked && full);
  const activitiesByDay = groupActivitiesByDay(activities);
  const bookingsResult = await supabase
    .from("roamly_bookings")
    .select("*")
    .eq("trip_id", id)
    .eq("user_id", current.user.id)
    .order("start_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });
  const importedBookings = bookingsResult.error && isMissingTableError(bookingsResult.error.message) ? [] : bookingsResult.data || [];

  const accessLabel = itineraryLocked
    ? "Locked itinerary"
    : access.hasQaAccess
      ? "Tester access"
      : paidForItinerary
      ? "Ready to generate"
      : freeAvailable
        ? "Free itinerary available"
        : "Payment required";

  if (checkoutNeedsAttention) {
    await recordAppEvent(supabase, {
      userId: current.user.id,
      eventType: "checkout_sync_failed",
      metadata: { tripId: id, error: checkoutSyncError }
    });
  }

  return (
    <main className="safe-bottom mx-auto w-full max-w-6xl px-4 py-8 sm:px-6">
      {shouldCleanCheckoutUrl ? <CheckoutUrlCleanup /> : null}
      <section className="grid gap-5 lg:grid-cols-[1fr_0.75fr] lg:items-end">
        <div>
          <Badge tone={itineraryLocked ? "ocean" : freeAvailable || paidForItinerary ? "sun" : "coral"}>{accessLabel}</Badge>
          {access.hasQaAccess ? <Badge tone="ocean">Tester access</Badge> : null}
          <h1 className="mt-4 text-4xl font-black tracking-tight text-ink sm:text-6xl">
            {trip.title || preview?.trip_title || trip.destination}
          </h1>
          <p className="mt-3 max-w-3xl text-base font-semibold leading-7 text-slate-600">
            {canShowFull
              ? full?.destination_summary
              : preview?.destination_summary ||
                "Review your trip details before generating. Once generated, this itinerary is locked permanently."}
          </p>
          {itineraryLocked ? (
            <p className="mt-4 rounded-2xl border border-ocean/20 bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">
              This itinerary is locked. To make major changes, create a new itinerary.
            </p>
          ) : null}
          {checkoutNeedsAttention ? (
            <p className="mt-4 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
              Stripe returned successfully, but Roamly could not confirm the payment yet. Refresh this page in a
              moment; if it stays locked, contact support with your checkout receipt.
            </p>
          ) : null}
          {checkoutStartFailed ? (
            <p className="mt-4 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
              Checkout could not start. Your trip draft was saved, so you can try unlocking it again from this page.
            </p>
          ) : null}
          {generationRequiresPayment ? (
            <p className="mt-4 rounded-2xl border border-coral/20 bg-coral/10 px-4 py-3 text-sm font-black text-coral">
              You’ve used your free itinerary. Unlock this trip to generate a new full itinerary.
            </p>
          ) : null}
        </div>

        <Card className="p-4">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
            {itineraryLocked ? "Trip access" : "Generate access"}
          </p>
          <p className="mt-2 text-2xl font-black text-ink">
            {itineraryLocked
              ? trackingUnlocked
                ? "Itinerary + companion"
                : "Full itinerary"
              : paidForItinerary
                ? access.hasQaAccess
                  ? "Tester access"
                  : "Payment received"
                : freeAvailable
                  ? "1 free itinerary"
                  : "$4.99 or $7.99"}
          </p>
          <p className="mt-1 text-sm font-bold leading-6 text-slate-500">
            {itineraryLocked
              ? "The itinerary is permanent for this trip. Live Trip Companion is optional per trip."
              : paidForItinerary
                ? access.hasQaAccess
                  ? "Tester access unlocks itinerary generation, Live Trip Companion, and Complete Trip Pack checks without creating Stripe revenue."
                  : "Generate once to lock the final itinerary for this trip."
                : freeAvailable
                  ? "You get 1 free itinerary per account."
                : "You’ve used your free itinerary. Unlock this trip to generate a new full itinerary."}
          </p>
          <div className="mt-4">
            {itineraryLocked ? (
              trackingUnlocked ? (
                <Button href={`/trip/${id}/live`}>Start Live Trip Companion</Button>
              ) : (
                <ActivateTripButton
                  tripId={id}
                  itineraryLocked
                  trackingUnlocked={false}
                  showItineraryUnlock={false}
                  testerAccess={access.hasQaAccess}
                  apiAuthToken={apiAuthToken}
                />
              )
            ) : paidForItinerary ? (
              <GenerateLockedItineraryButton
                tripId={id}
                label="Generate itinerary"
                subtext="This will lock the final itinerary permanently."
                apiAuthToken={apiAuthToken}
              />
            ) : freeAvailable ? (
              <GenerateLockedItineraryButton
                tripId={id}
                label="Generate my free itinerary"
                subtext="You get 1 free itinerary per account."
                apiAuthToken={apiAuthToken}
              />
            ) : (
              <ActivateTripButton tripId={id} itineraryLocked={false} trackingUnlocked={false} testerAccess={access.hasQaAccess} apiAuthToken={apiAuthToken} />
            )}
          </div>
        </Card>
      </section>

      {canShowFull && full ? (
        <>
          <section className="mt-7 grid gap-4 md:grid-cols-3">
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Best for</p>
              <p className="mt-2 text-lg font-black text-ink">{full.best_for.slice(0, 3).join(" · ")}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sun">Budget</p>
              <p className="mt-2 text-lg font-black text-ink">{full.estimated_budget_breakdown.total_estimate}</p>
            </Card>
            <Card className="p-4">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Transport</p>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">{full.transport_overview}</p>
            </Card>
          </section>

          <section className="mt-7 grid gap-4 lg:grid-cols-3">
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Route logic</p>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{full.route_reasoning}</p>
            </Card>
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sun">Budget fit</p>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{full.budget_fit_summary}</p>
            </Card>
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Booking status</p>
              <p className="mt-3 text-sm font-bold leading-6 text-slate-600">{full.booking_status_summary}</p>
            </Card>
            {full.free_or_low_cost_notes.length ? (
              <Card className="lg:col-span-3">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Free and low-cost options</p>
                <div className="mt-3 grid gap-2 md:grid-cols-2">
                  {full.free_or_low_cost_notes.map((note) => (
                    <p key={note} className="rounded-2xl bg-mist px-4 py-3 text-sm font-bold leading-6 text-slate-600">
                      {note}
                    </p>
                  ))}
                </div>
              </Card>
            ) : null}
          </section>

          <section className="mt-7 grid gap-4">
            {full.daily_itinerary.map((day) => (
              <DayCard key={day.day_number} day={day} destination={trip.destination} tripId={id} />
            ))}
          </section>

          <section className="mt-7 grid gap-4 lg:grid-cols-2">
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Budget breakdown</p>
              <div className="mt-4 grid gap-3">
                {Object.entries(full.estimated_budget_breakdown).map(([key, value]) => (
                  <p key={key} className="rounded-2xl bg-mist px-4 py-3 text-sm font-bold text-slate-600">
                    <span className="font-black capitalize text-ink">{key.replace("_", " ")}:</span> {value}
                  </p>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Hotels and local notes</p>
              <div className="mt-4 grid gap-3">
                {full.hotel_area_suggestions.map((area) => (
                  <p key={area} className="rounded-2xl bg-mist px-4 py-3 text-sm font-bold text-slate-600">{area}</p>
                ))}
              </div>
            </Card>
          </section>

          <section className="mt-7 grid gap-4 lg:grid-cols-3">
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Packing checklist</p>
              <div className="mt-4 grid gap-2">
                {checklist.slice(0, 12).map((item) => (
                  <p key={item.id} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
                    {item.item}
                  </p>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-sun">Local tips</p>
              <div className="mt-4 grid gap-2">
                {full.local_tips.map((tip) => (
                  <p key={tip} className="text-sm font-bold leading-6 text-slate-600">- {tip}</p>
                ))}
              </div>
            </Card>
            <Card>
              <p className="text-xs font-black uppercase tracking-[0.18em] text-coral">Safety</p>
              <div className="mt-4 grid gap-2">
                {[...full.safety_notes, ...full.emergency_notes].slice(0, 8).map((tip) => (
                  <p key={tip} className="text-sm font-bold leading-6 text-slate-600">- {tip}</p>
                ))}
              </div>
            </Card>
          </section>

          <section className="mt-7">
            <Card className="border-ocean/25 bg-gradient-to-br from-white to-ocean/10">
              <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Locked itinerary</p>
              <h2 className="mt-2 text-2xl font-black text-ink">This itinerary is final for this trip.</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                To change destination, dates, traveler count, budget, interests, or schedule, create a new itinerary.
                Live Trip Companion can be added without changing the itinerary.
              </p>
              <div className="mt-4 max-w-md">
                {trackingUnlocked ? (
                  <Button href={`/trip/${id}/live`}>Start Live Trip Companion</Button>
                ) : (
                  <ActivateTripButton tripId={id} itineraryLocked trackingUnlocked={false} showItineraryUnlock={false} apiAuthToken={apiAuthToken} />
                )}
              </div>
            </Card>
          </section>

          <section className="mt-7">
            <Card className="mb-4">
              <TripBookingsManager tripId={id} initialBookings={importedBookings} />
            </Card>
          </section>

          <section className="mt-7">
            <BookingCards trip={trip} itinerary={full} />
          </section>

          {Object.keys(activitiesByDay).length ? null : null}
        </>
      ) : (
        <>
          <section className="mt-7">
            <Card className="mb-4">
              <TripBookingsManager tripId={id} initialBookings={importedBookings} />
            </Card>
          </section>

          {preview ? (
            <section className="mt-7">
              <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
                <div>
                  <Badge tone="sun">Preview</Badge>
                  <h2 className="mt-3 text-3xl font-black tracking-tight text-ink">Preview only.</h2>
                  <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">
                    Full details, addresses, maps, timing, checklist, and activity details are shown only after this
                    itinerary is generated and locked.
                  </p>
                </div>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {preview.day_outline.map((item) => (
                  <PreviewDayCard key={item.day_number} item={item} />
                ))}
              </div>
              <div className="mt-5 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
                {preview.locked_sections.map((section) => (
                  <LockedCard
                    key={section}
                    title={section}
                    text="Generate and lock this itinerary to see the full details."
                  />
                ))}
              </div>
            </section>
          ) : (
            <Card className="mt-7">
              <Badge tone="sun">No itinerary yet</Badge>
              <h2 className="mt-3 text-3xl font-black text-ink">Generate this trip when the details are final.</h2>
              <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
                Once generated, the itinerary cannot be edited or regenerated.
              </p>
              <div className="mt-5 max-w-md">
                {paidForItinerary || freeAvailable ? (
                  <GenerateLockedItineraryButton
                    tripId={id}
                    label={freeAvailable && !paidForItinerary ? "Generate my free itinerary" : "Generate itinerary"}
                    subtext={freeAvailable && !paidForItinerary ? "You get 1 free itinerary per account." : "This will lock the final itinerary permanently."}
                    apiAuthToken={apiAuthToken}
                  />
                ) : (
                  <ActivateTripButton tripId={id} itineraryLocked={false} trackingUnlocked={false} apiAuthToken={apiAuthToken} />
                )}
              </div>
            </Card>
          )}
        </>
      )}
    </main>
  );
}
