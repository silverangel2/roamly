"use client";

import { useEffect, useMemo, useState } from "react";
import { NavigationButtons } from "@/components/roamly/NavigationButtons";
import { buildNavigationLinks } from "@/lib/roamly/navigationLinks";
import type { ActivityRecord, ChecklistRecord } from "@/lib/trips";

export type LiveSimulatorPlace = {
  id: string;
  title: string;
  kind: "activity" | "hotel" | "booking" | "airport" | "destination";
  latitude: number | null;
  longitude: number | null;
  address?: string | null;
  status?: string | null;
};

type SimulatedLocation = {
  active: boolean;
  tripId: string;
  latitude: number;
  longitude: number;
  label: string;
  target?: string;
  updatedAt: number;
};

type SimulationResponse = {
  ok?: boolean;
  latitude?: number;
  longitude?: number;
  nearbyActivities?: Array<{ id?: string; title?: string; distance_meters?: number | null }>;
  upNextActivity?: { id?: string; title?: string; distance_meters?: number | null } | null;
  notificationCreated?: boolean;
  error?: string | null;
};

type SimulationTarget = {
  latitude: number;
  longitude: number;
  label?: string;
  target?: string;
};

type QuickSimulationAction = {
  label: string;
  resolve: () => SimulationTarget;
};

const SIMULATED_LOCATION_KEY = "roamly_live_simulated_location";

function statusLabel(status: string) {
  if (status === "completed") return "Done";
  if (status === "skipped") return "Skipped";
  if (status === "checked_in" || status === "active") return "Checked in";
  if (status === "nearby") return "Nearby";
  if (status === "missed") return "Missed";
  return "Planned";
}

function getNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function placeText(place: Pick<LiveSimulatorPlace, "title" | "address"> | string | null | undefined, destination = "") {
  const text = typeof place === "string" ? `${place} ${destination}` : `${place?.title || ""} ${place?.address || ""} ${destination}`;
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function knownCoordinates(input: string, destination: string) {
  const text = placeText(input, destination);
  const known: Array<[RegExp, { latitude: number; longitude: number; label: string }]> = [
    [/notre.?dame basilica|basilique notre.?dame/, { latitude: 45.5045, longitude: -73.5561, label: "Notre-Dame Basilica" }],
    [/pointe.?a.?calliere/, { latitude: 45.5027, longitude: -73.5545, label: "Pointe-a-Calliere Museum" }],
    [/montreal museum of fine arts|musee des beaux.?arts/, { latitude: 45.4987, longitude: -73.5793, label: "Montreal Museum of Fine Arts" }],
    [/mount royal|mont royal|mont-royal/, { latitude: 45.5017, longitude: -73.587, label: "Mount Royal" }],
    [/plateau/, { latitude: 45.5255, longitude: -73.5817, label: "Plateau Mont-Royal" }],
    [/ville.?marie|downtown montreal/, { latitude: 45.5017, longitude: -73.5673, label: "Ville-Marie" }],
    [/old montreal|vieux.?montreal|old port/, { latitude: 45.5066, longitude: -73.554, label: "Old Montreal" }],
    [/yul|trudeau|montreal airport/, { latitude: 45.4706, longitude: -73.7408, label: "YUL airport" }],
    [/yyz|pearson|toronto airport/, { latitude: 43.6777, longitude: -79.6248, label: "YYZ airport" }],
    [/yvr|vancouver airport/, { latitude: 49.1967, longitude: -123.1815, label: "YVR airport" }],
    [/cn tower/, { latitude: 43.6426, longitude: -79.3871, label: "CN Tower" }],
    [/ripley/, { latitude: 43.6424, longitude: -79.386, label: "Ripley's Aquarium" }],
    [/harbourfront/, { latitude: 43.6387, longitude: -79.3822, label: "Harbourfront" }],
    [/royal ontario museum|\brom\b/, { latitude: 43.6677, longitude: -79.3948, label: "Royal Ontario Museum" }],
    [/kensington/, { latitude: 43.6545, longitude: -79.4015, label: "Kensington Market" }]
  ];
  return known.find(([pattern]) => pattern.test(text))?.[1] || null;
}

function cityFallback(destination: string) {
  const text = placeText(destination);
  const known: Array<[RegExp, { latitude: number; longitude: number; label: string }]> = [
    [/montreal/, { latitude: 45.5019, longitude: -73.5674, label: "Montreal center" }],
    [/toronto/, { latitude: 43.6532, longitude: -79.3832, label: "Toronto center" }],
    [/vancouver/, { latitude: 49.2827, longitude: -123.1207, label: "Vancouver center" }],
    [/new york/, { latitude: 40.7128, longitude: -74.006, label: "New York center" }],
    [/london/, { latitude: 51.5072, longitude: -0.1276, label: "London center" }],
    [/paris/, { latitude: 48.8566, longitude: 2.3522, label: "Paris center" }],
    [/tokyo/, { latitude: 35.6762, longitude: 139.6503, label: "Tokyo center" }]
  ];
  return known.find(([pattern]) => pattern.test(text))?.[1] || { latitude: 45.5019, longitude: -73.5674, label: "Destination center" };
}

function offsetMeters(coords: { latitude: number; longitude: number }, meters: number) {
  return {
    latitude: coords.latitude + meters / 111_320,
    longitude: coords.longitude
  };
}

export function LiveTripClient({
  tripId,
  activities,
  checklist,
  canSimulateLocation = false,
  destinationLabel = "",
  simulatorPlaces = []
}: {
  tripId: string;
  activities: ActivityRecord[];
  checklist: ChecklistRecord[];
  canSimulateLocation?: boolean;
  destinationLabel?: string;
  simulatorPlaces?: LiveSimulatorPlace[];
}) {
  const [items, setItems] = useState(activities);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [simulatedLocation, setSimulatedLocation] = useState<SimulatedLocation | null>(null);
  const [selectedPlaceId, setSelectedPlaceId] = useState(simulatorPlaces[0]?.id || "");
  const [manualLatitude, setManualLatitude] = useState("");
  const [manualLongitude, setManualLongitude] = useState("");
  const [simulatorBusy, setSimulatorBusy] = useState("");
  const [simulatorNotice, setSimulatorNotice] = useState("");
  const [simulatorError, setSimulatorError] = useState("");
  const [simulationResult, setSimulationResult] = useState<SimulationResponse | null>(null);

  const active = useMemo(
    () =>
      items.find((item) => item.status === "checked_in" || item.status === "active") ||
      items.find((item) => item.status === "nearby") ||
      items.find((item) => item.status === "planned") ||
      items[0],
    [items]
  );
  const next = useMemo(
    () =>
      items.find((item) => !["completed", "skipped", "missed"].includes(item.status) && item.id !== active?.id) ||
      null,
    [active?.id, items]
  );
  const activeDirections = useMemo(
    () =>
      active
        ? buildNavigationLinks({
            destinationLabel: active.title,
            address: active.map_query || active.location_name
          })[0] || null
        : null,
    [active]
  );
  const placeOptions = useMemo(() => {
    const byKey = new Map<string, LiveSimulatorPlace>();
    for (const place of simulatorPlaces) {
      byKey.set(place.id, place);
    }
    for (const activity of activities) {
      const id = `display:${activity.id}`;
      if (!byKey.has(id)) {
        byKey.set(id, {
          id,
          title: activity.title,
          kind: "activity",
          latitude: null,
          longitude: null,
          address: activity.map_query || activity.location_name,
          status: activity.status
        });
      }
    }
    return Array.from(byKey.values());
  }, [activities, simulatorPlaces]);
  const selectedPlace = placeOptions.find((place) => place.id === selectedPlaceId) || placeOptions[0] || null;

  useEffect(() => {
    setItems(activities);
  }, [activities]);

  useEffect(() => {
    if (!selectedPlaceId && placeOptions[0]) setSelectedPlaceId(placeOptions[0].id);
  }, [placeOptions, selectedPlaceId]);

  useEffect(() => {
    if (!canSimulateLocation) return;
    try {
      const raw = localStorage.getItem(SIMULATED_LOCATION_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SimulatedLocation>;
      if (parsed.active && parsed.tripId !== tripId) {
        localStorage.removeItem(SIMULATED_LOCATION_KEY);
        return;
      }
      const latitude = getNumber(parsed.latitude);
      const longitude = getNumber(parsed.longitude);
      if (parsed.active && latitude != null && longitude != null) {
        const restored = {
          active: true,
          tripId,
          latitude,
          longitude,
          label: typeof parsed.label === "string" ? parsed.label : "Simulated location",
          target: typeof parsed.target === "string" ? parsed.target : undefined,
          updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now()
        };
        setSimulatedLocation(restored);
        setManualLatitude(String(latitude));
        setManualLongitude(String(longitude));
      }
    } catch {
      localStorage.removeItem(SIMULATED_LOCATION_KEY);
    }
  }, [canSimulateLocation, tripId]);

  function resolvePlace(place: LiveSimulatorPlace | null, fallbackLabel = "Simulated location") {
    const latitude = getNumber(place?.latitude);
    const longitude = getNumber(place?.longitude);
    if (latitude != null && longitude != null) {
      return { latitude, longitude, label: place?.title || fallbackLabel, target: place?.id };
    }
    const known = knownCoordinates(placeText(place, destinationLabel), destinationLabel);
    if (known) return { ...known, target: place?.id };
    const fallback = cityFallback(destinationLabel);
    return { ...fallback, label: place?.title || fallback.label || fallbackLabel, target: place?.id };
  }

  function resolveActivityPlace(activity: ActivityRecord | null | undefined, fallbackLabel: string) {
    if (!activity) return resolvePlace(selectedPlace, fallbackLabel);
    const match = placeOptions.find((place) => place.title.toLowerCase() === activity.title.toLowerCase()) || null;
    return resolvePlace(
      match || {
        id: `activity:${activity.id}`,
        title: activity.title,
        kind: "activity",
        latitude: null,
        longitude: null,
        address: activity.map_query || activity.location_name,
        status: activity.status
      },
      fallbackLabel
    );
  }

  function persistSimulatedLocation(location: SimulatedLocation | null) {
    if (!location) {
      localStorage.removeItem(SIMULATED_LOCATION_KEY);
      return;
    }
    localStorage.setItem(SIMULATED_LOCATION_KEY, JSON.stringify(location));
  }

  function applySimulationResponse(data: SimulationResponse | null) {
    if (!data) return;
    const nearbyTitles = new Set((data.nearbyActivities || []).map((item) => item.title).filter(Boolean));
    if (!nearbyTitles.size) return;
    setItems((current) =>
      current.map((item) =>
        nearbyTitles.has(item.title) && !["completed", "skipped", "checked_in"].includes(item.status)
          ? { ...item, status: "nearby" }
          : item
      )
    );
  }

  async function activateSimulatedLocation(location: { latitude: number; longitude: number; label: string; target?: string }) {
    setSimulatorBusy("simulate");
    setSimulatorError("");
    setSimulatorNotice("");
    const nextLocation: SimulatedLocation = {
      active: true,
      tripId,
      latitude: location.latitude,
      longitude: location.longitude,
      label: location.label,
      target: location.target,
      updatedAt: Date.now()
    };

    try {
      const response = await fetch("/api/roamly/location/simulate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          latitude: location.latitude,
          longitude: location.longitude,
          label: location.label,
          target: location.target,
          simulated: true
        })
      });
      const data = (await response.json().catch(() => null)) as SimulationResponse | null;
      if (!response.ok || !data?.ok) throw new Error(data?.error || "Could not simulate location.");
      setSimulatedLocation(nextLocation);
      persistSimulatedLocation(nextLocation);
      setManualLatitude(String(location.latitude));
      setManualLongitude(String(location.longitude));
      setSimulationResult(data);
      applySimulationResponse(data);
      setSimulatorNotice(
        `Simulated location active: ${location.label}. Nearby detected: ${data.nearbyActivities?.length || 0}.`
      );
    } catch (err) {
      setSimulatorError(err instanceof Error ? err.message : "Could not simulate location.");
    } finally {
      setSimulatorBusy("");
    }
  }

  async function activateManualSimulation() {
    const latitude = Number(manualLatitude);
    const longitude = Number(manualLongitude);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      setSimulatorError("Enter valid latitude and longitude.");
      return;
    }
    await activateSimulatedLocation({
      latitude,
      longitude,
      label: selectedPlace?.title || "Manual simulated location",
      target: selectedPlace?.id
    });
  }

  async function requestRealLocation() {
    setSimulatorBusy("real");
    setSimulatorError("");
    setSimulatorNotice("");
    setSimulatedLocation(null);
    persistSimulatedLocation(null);

    try {
      if (!navigator.geolocation) throw new Error("This browser does not support location sensing.");
      await fetch("/api/roamly/location/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locationTrackingEnabled: true, notificationEnabled: true })
      });
      navigator.geolocation.getCurrentPosition(
        async (position) => {
          try {
            const response = await fetch("/api/roamly/location/update", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
                permissionState: "granted"
              })
            });
            const data = (await response.json().catch(() => null)) as SimulationResponse | null;
            if (!response.ok) throw new Error(data?.error || "Location update failed.");
            setSimulationResult(data);
            applySimulationResponse(data);
            setSimulatorNotice("Real location active for this browser.");
          } catch (err) {
            setSimulatorError(err instanceof Error ? err.message : "Location update failed.");
          } finally {
            setSimulatorBusy("");
          }
        },
        () => {
          setSimulatorBusy("");
          setSimulatorError("Location permission was not granted.");
        },
        { enableHighAccuracy: true, timeout: 10_000, maximumAge: 60_000 }
      );
    } catch (err) {
      setSimulatorBusy("");
      setSimulatorError(err instanceof Error ? err.message : "Location setup failed.");
    }
  }

  function clearSimulatedLocation() {
    setSimulatedLocation(null);
    setSimulationResult(null);
    setSimulatorNotice("Simulated location cleared. Real GPS can be used again.");
    setSimulatorError("");
    persistSimulatedLocation(null);
  }

  const quickSimulationActions: QuickSimulationAction[] = [
    {
      label: "Start of trip",
      resolve: () => resolvePlace(placeOptions.find((place) => place.kind === "activity") || selectedPlace, "Start of trip")
    },
    {
      label: "Airport",
      resolve: () => ({ ...(knownCoordinates(`${destinationLabel} airport`, destinationLabel) || cityFallback(destinationLabel)), target: "airport" })
    },
    {
      label: "Hotel",
      resolve: () => resolvePlace(placeOptions.find((place) => place.kind === "hotel") || selectedPlace, "Hotel")
    },
    {
      label: "Next activity",
      resolve: () => resolveActivityPlace(next || active, "Next activity")
    },
    {
      label: "Current day activity",
      resolve: () => resolveActivityPlace(active || items[0], "Current day activity")
    },
    {
      label: "100m away",
      resolve: () => {
        const base = selectedPlace ? resolvePlace(selectedPlace) : resolveActivityPlace(active, "Selected place");
        return { ...offsetMeters(base, 100), label: `${base.label} - 100m away`, target: base.target };
      }
    },
    {
      label: "500m away",
      resolve: () => {
        const base = selectedPlace ? resolvePlace(selectedPlace) : resolveActivityPlace(active, "Selected place");
        return { ...offsetMeters(base, 500), label: `${base.label} - 500m away`, target: base.target };
      }
    },
    {
      label: "2km away",
      resolve: () => {
        const base = selectedPlace ? resolvePlace(selectedPlace) : resolveActivityPlace(active, "Selected place");
        return { ...offsetMeters(base, 2000), label: `${base.label} - 2km away`, target: base.target };
      }
    }
  ];

  async function runAction(activityId: string, action: "check-in" | "skip" | "complete") {
    setBusy(activityId + action);
    setError("");

    const endpoint =
      action === "check-in"
        ? "/api/roamly/activities/check-in"
        : action === "skip"
          ? "/api/roamly/activities/skip"
          : "/api/roamly/activities/complete";
    const nextStatus = action === "check-in" ? "checked_in" : action === "skip" ? "skipped" : "completed";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          tripId,
          activityId,
          ...(simulatedLocation?.active
            ? {
                latitude: simulatedLocation.latitude,
                longitude: simulatedLocation.longitude,
                simulated: true
              }
            : {})
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || "Could not update activity.");
      setItems((current) => current.map((item) => (item.id === activityId ? { ...item, status: nextStatus } : item)));
      if (data?.upNextActivity) setSimulationResult((current) => ({ ...(current || {}), upNextActivity: data.upNextActivity }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not update activity.");
    } finally {
      setBusy("");
    }
  }

  return (
    <div className="space-y-5 pb-24 md:pb-0">
      {canSimulateLocation ? (
        <section className="rounded-[1.75rem] border border-ocean/20 bg-white/95 p-5 shadow-soft">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Simulate location</p>
                {simulatedLocation?.active ? (
                  <span className="rounded-full border border-orange-200 bg-orange-50 px-3 py-1 text-xs font-black text-orange-700">
                    Simulated location
                  </span>
                ) : null}
              </div>
              <h2 className="mt-2 text-2xl font-black text-ink">Test Live Companion location behavior</h2>
              <p className="mt-2 max-w-2xl text-sm font-bold leading-6 text-slate-600">
                Use simulated location to test Live Companion without being in the destination.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => void requestRealLocation()}
                disabled={Boolean(simulatorBusy)}
                className="rounded-full border border-ocean/20 bg-white px-4 py-2 text-sm font-black text-ocean shadow-soft disabled:opacity-60"
              >
                {simulatorBusy === "real" ? "Checking..." : "Use real location"}
              </button>
              <button
                type="button"
                onClick={() => void activateManualSimulation()}
                disabled={Boolean(simulatorBusy)}
                className="rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-4 py-2 text-sm font-black text-white shadow-lg shadow-cyan-500/20 disabled:opacity-60"
              >
                {simulatorBusy === "simulate" ? "Simulating..." : "Use simulated location"}
              </button>
              <button
                type="button"
                onClick={clearSimulatedLocation}
                disabled={Boolean(simulatorBusy)}
                className="rounded-full bg-cloud px-4 py-2 text-sm font-black text-slate-700 disabled:opacity-60"
              >
                Clear simulated location
              </button>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_0.45fr_0.45fr]">
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Itinerary place</span>
              <select
                value={selectedPlaceId}
                onChange={(event) => {
                  const placeId = event.target.value;
                  setSelectedPlaceId(placeId);
                  const place = placeOptions.find((item) => item.id === placeId) || null;
                  const coords = resolvePlace(place);
                  setManualLatitude(String(coords.latitude));
                  setManualLongitude(String(coords.longitude));
                }}
                className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink outline-none focus:border-ocean"
              >
                {placeOptions.map((place) => (
                  <option key={place.id} value={place.id}>
                    {place.title} {place.status ? `(${place.status})` : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Latitude</span>
              <input
                value={manualLatitude}
                onChange={(event) => setManualLatitude(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink outline-none focus:border-ocean"
                inputMode="decimal"
              />
            </label>
            <label className="block">
              <span className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Longitude</span>
              <input
                value={manualLongitude}
                onChange={(event) => setManualLongitude(event.target.value)}
                className="mt-2 w-full rounded-2xl border border-cloud bg-white px-4 py-3 text-sm font-black text-ink outline-none focus:border-ocean"
                inputMode="decimal"
              />
            </label>
          </div>

          <div className="mt-4 flex flex-wrap gap-2">
            {quickSimulationActions.map(({ label, resolve }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  const coords = resolve();
                  void activateSimulatedLocation({
                    latitude: coords.latitude,
                    longitude: coords.longitude,
                    label: coords.label || label,
                    target: coords.target
                  });
                }}
                disabled={Boolean(simulatorBusy)}
                className="rounded-full border border-ocean/15 bg-ocean/5 px-3 py-2 text-xs font-black text-ocean transition hover:border-ocean/35 hover:bg-ocean/10 disabled:opacity-60"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="mt-4 grid gap-3 sm:grid-cols-3">
            <div className="rounded-2xl bg-mist px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Current test location</p>
              <p className="mt-1 text-sm font-black text-ink">{simulatedLocation?.active ? simulatedLocation.label : "Real GPS / none"}</p>
            </div>
            <div className="rounded-2xl bg-mist px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Nearby detected</p>
              <p className="mt-1 text-sm font-black text-ink">{simulationResult?.nearbyActivities?.length || 0}</p>
            </div>
            <div className="rounded-2xl bg-mist px-4 py-3">
              <p className="text-xs font-black uppercase tracking-[0.14em] text-slate-400">Up next</p>
              <p className="mt-1 text-sm font-black text-ink">{simulationResult?.upNextActivity?.title || active?.title || "None"}</p>
            </div>
          </div>

          {simulatorNotice ? <p className="mt-4 rounded-2xl bg-ocean/10 px-4 py-3 text-sm font-black text-ocean">{simulatorNotice}</p> : null}
          {simulatorError ? <p className="mt-4 rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{simulatorError}</p> : null}
        </section>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-[1.75rem] bg-gradient-to-r from-cyan-500 to-sky-500 p-5 text-white shadow-lg shadow-cyan-500/20">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-white/75">Now</p>
          <h2 className="mt-2 text-2xl font-black">{active?.title || "Start your day"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-white/88">{active?.description || "Open your itinerary and choose the first stop."}</p>
          {active ? (
            <NavigationButtons
              tripId={tripId}
              destinationLabel={active.title}
              address={active.map_query || active.location_name}
              showHeading
              className="mt-4 [&_p]:text-white/75 [&_a]:bg-white/15 [&_a]:text-white [&_a]:ring-white/25 [&_a:hover]:bg-white [&_a:hover]:text-cyan-700"
            />
          ) : null}
        </div>
        <div className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Next</p>
          <h2 className="mt-2 text-2xl font-black text-ink">{next?.title || "Flexible time"}</h2>
          <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{next?.description || "Use this space for food, rest, or transit."}</p>
          {next ? (
            <NavigationButtons
              tripId={tripId}
              destinationLabel={next.title}
              address={next.map_query || next.location_name}
              showHeading
              className="mt-4"
            />
          ) : null}
        </div>
      </section>

      <p className="rounded-2xl border border-cloud bg-white/85 px-4 py-3 text-sm font-bold leading-6 text-slate-600 shadow-soft">
        Live Trip Companion records progress for this locked itinerary. Major changes need a new itinerary.
      </p>

      {error ? <p className="rounded-2xl bg-coral/10 px-4 py-3 text-sm font-black text-coral">{error}</p> : null}

      <section className="space-y-3">
        {items.map((activity) => (
          <article key={activity.id} className="rounded-[1.5rem] border border-cloud bg-white/90 p-4 shadow-soft">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <p className="text-xs font-black uppercase tracking-[0.16em] text-slate-400">
                  {activity.time_label || "Anytime"} · {statusLabel(activity.status)}
                </p>
                <h3 className="mt-1 text-xl font-black text-ink">{activity.title}</h3>
                <p className="mt-2 text-sm font-bold leading-6 text-slate-500">{activity.description}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "check-in")}
                  disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-gradient-to-r from-cyan-500 to-sky-500 px-3 py-2 text-xs font-black text-white shadow-lg shadow-cyan-500/20 disabled:opacity-45"
                >
                  Check in
                </button>
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "complete")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-gradient-to-r from-orange-400 to-rose-400 px-3 py-2 text-xs font-black text-white shadow-lg shadow-orange-400/20 disabled:opacity-45"
                >
                  Mark done
                </button>
                <button
                  type="button"
                  onClick={() => runAction(activity.id, "skip")}
                  disabled={Boolean(busy) || ["completed", "skipped"].includes(activity.status)}
                  className="rounded-full bg-cloud px-3 py-2 text-xs font-black text-slate-600"
                >
                  Skip
                </button>
              </div>
            </div>
            <NavigationButtons
              tripId={tripId}
              destinationLabel={activity.title}
              address={activity.map_query || activity.location_name}
              className="mt-3"
            />
          </article>
        ))}
      </section>

      <section className="rounded-[1.75rem] border border-cloud bg-white/90 p-5 shadow-soft">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Checklist reminder</p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {checklist.slice(0, 6).map((item) => (
            <p key={item.id} className="rounded-2xl bg-mist px-4 py-3 text-sm font-black text-slate-600">
              {item.is_done ? "✓ " : ""}{item.item}
            </p>
          ))}
        </div>
      </section>

      {active ? (
        <section className="fixed inset-x-3 bottom-24 z-30 rounded-[1.4rem] border border-white/80 bg-white/95 p-2 shadow-soft backdrop-blur md:hidden">
          <p className="mb-2 px-2 text-[0.68rem] font-black uppercase tracking-[0.14em] text-slate-400">
            Up next: {active.title}
          </p>
          <div className="grid grid-cols-4 gap-2">
            <button
              type="button"
              onClick={() => runAction(active.id, "check-in")}
              disabled={Boolean(busy) || ["checked_in", "completed", "skipped"].includes(active.status)}
              className="min-h-12 rounded-2xl bg-gradient-to-r from-cyan-500 to-sky-500 px-2 text-[0.72rem] font-black text-white shadow-lg shadow-cyan-500/20 disabled:opacity-45"
            >
              Check in
            </button>
            <button
              type="button"
              onClick={() => runAction(active.id, "skip")}
              disabled={Boolean(busy) || ["completed", "skipped"].includes(active.status)}
              className="min-h-12 rounded-2xl bg-cloud px-2 text-[0.72rem] font-black text-slate-700 disabled:opacity-45"
            >
              Skip
            </button>
            <button
              type="button"
              onClick={() => runAction(active.id, "complete")}
              disabled={Boolean(busy) || ["completed", "skipped"].includes(active.status)}
              className="min-h-12 rounded-2xl bg-gradient-to-r from-orange-400 to-rose-400 px-2 text-[0.72rem] font-black text-white shadow-lg shadow-orange-400/20 disabled:opacity-45"
            >
              Done
            </button>
            {activeDirections ? (
              <a
                href={activeDirections.href}
                target="_blank"
                rel="noreferrer"
                className="flex min-h-12 items-center justify-center rounded-2xl bg-sun/25 px-2 text-center text-[0.72rem] font-black text-amber-900"
              >
                Directions
              </a>
            ) : (
              <span className="flex min-h-12 items-center justify-center rounded-2xl bg-mist px-2 text-center text-[0.72rem] font-black text-slate-400">
                Directions
              </span>
            )}
          </div>
        </section>
      ) : null}
    </div>
  );
}
