export type Coordinates = {
  latitude: number;
  longitude: number;
};

export type LocationInput = Coordinates & {
  accuracy?: number | null;
};

export function normalizeCoordinates(input: Partial<LocationInput> | null | undefined): LocationInput | null {
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  const accuracy = input?.accuracy == null ? null : Number(input.accuracy);

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) return null;

  const normalizedAccuracy = typeof accuracy === "number" && Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : null;

  return {
    latitude,
    longitude,
    accuracy: normalizedAccuracy
  };
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function calculateDistanceMeters(lat1: number, lon1: number, lat2: number, lon2: number) {
  const earthRadiusMeters = 6_371_000;
  const dLat = toRadians(lat2 - lat1);
  const dLon = toRadians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(earthRadiusMeters * c);
}

export function isWithinRadius(
  userLat: number,
  userLon: number,
  activityLat: number | null | undefined,
  activityLon: number | null | undefined,
  radiusMeters = 250
) {
  if (activityLat == null || activityLon == null) return false;
  if (!Number.isFinite(activityLat) || !Number.isFinite(activityLon)) return false;
  return calculateDistanceMeters(userLat, userLon, activityLat, activityLon) <= radiusMeters;
}
