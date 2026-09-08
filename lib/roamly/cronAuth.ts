import { timingSafeEqual } from "node:crypto";

type HeaderReader = {
  get(name: string): string | null;
};

function secretsEqual(provided: string, expected: string) {
  const providedBytes = Buffer.from(provided);
  const expectedBytes = Buffer.from(expected);
  return (
    providedBytes.length === expectedBytes.length &&
    timingSafeEqual(providedBytes, expectedBytes)
  );
}

export function isCronRequestAuthorized(headers: HeaderReader, expectedSecret: string) {
  const expected = expectedSecret.trim();
  if (!expected) return false;

  const authorization = headers.get("authorization")?.trim() || "";
  const bearerMatch = /^Bearer\s+(.+)$/i.exec(authorization);
  const bearerSecret = bearerMatch?.[1]?.trim() || "";
  const headerSecret = headers.get("x-cron-secret")?.trim() || "";

  return Boolean(
    (bearerSecret && secretsEqual(bearerSecret, expected)) ||
      (headerSecret && secretsEqual(headerSecret, expected))
  );
}
