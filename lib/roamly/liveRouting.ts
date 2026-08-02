import { mapsUrlForActivity, type LiveCompanionActivity, type LiveCoordinates, type LiveRouteStatus } from "@/lib/roamly/liveCompanion";

type RouteMode = "walking" | "transit" | "driving" | "rideshare";

type RouteRequest = {
  origin?: LiveCoordinates | null;
  destination: LiveCompanionActivity;
  mode?: RouteMode;
};

function providerMode(mode: RouteMode) {
  if (mode === "rideshare") return "driving";
  return mode;
}

function destinationValue(destination: LiveCompanionActivity) {
  if (
    typeof destination.latitude === "number" &&
    Number.isFinite(destination.latitude) &&
    typeof destination.longitude === "number" &&
    Number.isFinite(destination.longitude)
  ) {
    return `${destination.latitude},${destination.longitude}`;
  }
  return [destination.placeName, destination.address, destination.title].filter(Boolean).join(", ");
}

function unavailable(destination: LiveCompanionActivity, reason: string, mode?: RouteMode | null): LiveRouteStatus {
  return {
    status: "unavailable",
    mode: mode || null,
    durationMinutes: null,
    mapsUrl: mapsUrlForActivity(destination),
    reason
  };
}

export async function getLiveRouteStatus(params: RouteRequest): Promise<LiveRouteStatus> {
  const mode = params.mode || "walking";
  if (!params.origin) return unavailable(params.destination, "Location is unavailable. Open Maps for directions.", mode);
  const destination = destinationValue(params.destination);
  if (!destination) return unavailable(params.destination, "Destination address is missing.", mode);

  const key = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_DISTANCE_MATRIX_API_KEY;
  if (!key) return unavailable(params.destination, "No live routing provider is connected.", mode);

  const origin = `${params.origin.latitude},${params.origin.longitude}`;
  const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
  url.searchParams.set("origins", origin);
  url.searchParams.set("destinations", destination);
  url.searchParams.set("mode", providerMode(mode));
  url.searchParams.set("key", key);

  try {
    const response = await fetch(url.toString(), { cache: "no-store" });
    if (!response.ok) return unavailable(params.destination, "Live route provider did not return a usable response.", mode);
    const data = await response.json().catch(() => null) as {
      status?: string;
      rows?: Array<{ elements?: Array<{ status?: string; duration?: { value?: number } }> }>;
    } | null;
    const element = data?.rows?.[0]?.elements?.[0];
    const seconds = element?.status === "OK" ? element.duration?.value : null;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds <= 0) {
      return unavailable(params.destination, "Live route duration is unavailable.", mode);
    }
    return {
      status: "verified",
      provider: "google_distance_matrix",
      mode,
      durationMinutes: Math.max(1, Math.round(seconds / 60)),
      retrievedAt: new Date().toISOString(),
      mapsUrl: mapsUrlForActivity(params.destination)
    };
  } catch {
    return unavailable(params.destination, "Live routing failed. Open Maps for directions.", mode);
  }
}
