"use client";

import {
  useEffect,
  useMemo,
  useState
} from "react";

type DemoAction =
  | "send_test_email"
  | "simulate_delay"
  | "simulate_cancellation"
  | "simulate_gate_change"
  | "simulate_hotel_change";

type Trip = {
  id: string;
  title: string | null;
  destination: string | null;
  start_date: string | null;
  end_date: string | null;
};

type Booking = {
  id: string;
  trip_id: string;
  booking_type: string;
  booking_status: string;
  title: string | null;
  flight_number: string | null;
  provider_name: string | null;
  start_at: string | null;
  gate: string | null;
  terminal: string | null;
};

const ACTIONS: Array<{
  action: DemoAction;
  title: string;
  description: string;
}> = [
  {
    action: "send_test_email",
    title: "Send test Companion email",
    description:
      "Sends a real [TEST] transactional email without changing a booking."
  },
  {
    action: "simulate_delay",
    title: "Simulate 2-hour delay",
    description:
      "Temporarily delays a selected flight, runs the full Companion workflow, then restores the original booking."
  },
  {
    action: "simulate_cancellation",
    title: "Simulate cancellation",
    description:
      "Temporarily cancels a selected booking, creates impact and repair records, then restores it."
  },
  {
    action: "simulate_gate_change",
    title: "Simulate gate change",
    description:
      "Temporarily changes a selected flight gate and terminal."
  },
  {
    action: "simulate_hotel_change",
    title: "Simulate hotel-date change",
    description:
      "Temporarily shifts a selected hotel booking by one day."
  }
];

export default function CompanionDemoConsole() {
  const [trips, setTrips] =
    useState<Trip[]>([]);

  const [bookings, setBookings] =
    useState<Booking[]>([]);

  const [tripId, setTripId] =
    useState("");

  const [bookingId, setBookingId] =
    useState("");

  const [running, setRunning] =
    useState<DemoAction | null>(null);

  const [result, setResult] =
    useState<Record<string, unknown> | null>(
      null
    );

  const [error, setError] =
    useState("");

  useEffect(() => {
    void (async () => {
      const response = await fetch(
        "/api/admin/roamly/companion-demo",
        {
          cache: "no-store"
        }
      );

      const payload = await response.json();

      if (!response.ok || !payload.ok) {
        setError(
          payload.error ||
            "Demo data could not be loaded."
        );
        return;
      }

      setTrips(payload.trips || []);
      setBookings(payload.bookings || []);
    })();
  }, []);

  const tripBookings = useMemo(
    () =>
      bookings.filter(
        (booking) =>
          booking.trip_id === tripId
      ),
    [bookings, tripId]
  );

  async function runAction(
    action: DemoAction
  ) {
    setRunning(action);
    setResult(null);
    setError("");

    try {
      const response = await fetch(
        "/api/admin/roamly/companion-demo",
        {
          method: "POST",
          headers: {
            "content-type":
              "application/json"
          },
          body: JSON.stringify({
            action,
            tripId: tripId || null,
            bookingId:
              bookingId || null
          })
        }
      );

      const payload =
        (await response.json()) as Record<
          string,
          unknown
        >;

      setResult({
        httpStatus: response.status,
        ...payload
      });

      if (!response.ok) {
        setError(
          typeof payload.error === "string"
            ? payload.error
            : "Demo action failed."
        );
      }
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Demo request failed."
      );
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="grid gap-6">
      <section className="rounded-[2rem] border border-cloud bg-white/90 p-6 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
          Companion Demo Mode
        </p>

        <h1 className="mt-2 text-3xl font-black text-ink">
          End-to-end Companion testing
        </h1>

        <p className="mt-3 max-w-3xl text-sm font-bold leading-6 text-slate-600">
          Simulations use real Companion
          events, impact analysis, repairs,
          notifications, and traveler
          history. The selected booking is
          automatically restored afterward.
        </p>

        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Trip
            </span>

            <select
              value={tripId}
              onChange={(event) => {
                setTripId(
                  event.target.value
                );
                setBookingId("");
              }}
              className="mt-2 w-full rounded-2xl border border-cloud bg-mist px-4 py-3 text-sm font-bold text-ink"
            >
              <option value="">
                Select trip
              </option>

              {trips.map((trip) => (
                <option
                  key={trip.id}
                  value={trip.id}
                >
                  {trip.title ||
                    trip.destination ||
                    trip.id}
                </option>
              ))}
            </select>
          </label>

          <label>
            <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-500">
              Booking
            </span>

            <select
              value={bookingId}
              onChange={(event) =>
                setBookingId(
                  event.target.value
                )
              }
              className="mt-2 w-full rounded-2xl border border-cloud bg-mist px-4 py-3 text-sm font-bold text-ink"
            >
              <option value="">
                Select booking
              </option>

              {tripBookings.map(
                (booking) => (
                  <option
                    key={booking.id}
                    value={booking.id}
                  >
                    {booking.title ||
                      booking.flight_number ||
                      booking.provider_name ||
                      booking.booking_type}
                    {" · "}
                    {booking.booking_type}
                  </option>
                )
              )}
            </select>
          </label>
        </div>

        <p className="mt-4 rounded-2xl bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
          Demo events and notifications remain
          visible for inspection, but the
          booking itself is restored after
          each simulation.
        </p>

        {error ? (
          <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">
            {error}
          </p>
        ) : null}
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        {ACTIONS.map((item) => (
          <article
            key={item.action}
            className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft"
          >
            <h2 className="text-lg font-black text-ink">
              {item.title}
            </h2>

            <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
              {item.description}
            </p>

            <button
              type="button"
              disabled={
                running !== null ||
                (
                  item.action !==
                    "send_test_email" &&
                  (
                    !tripId ||
                    !bookingId
                  )
                )
              }
              onClick={() =>
                void runAction(
                  item.action
                )
              }
              className="mt-5 rounded-2xl bg-ink px-5 py-3 text-sm font-black text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {running === item.action
                ? "Running…"
                : item.title}
            </button>
          </article>
        ))}
      </section>

      {result ? (
        <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.16em] text-ocean">
            Test result
          </p>

          <pre className="mt-4 max-h-[38rem] overflow-auto rounded-2xl bg-ink p-4 text-xs font-bold leading-5 text-white/80">
            {JSON.stringify(
              result,
              null,
              2
            )}
          </pre>
        </section>
      ) : null}
    </div>
  );
}
