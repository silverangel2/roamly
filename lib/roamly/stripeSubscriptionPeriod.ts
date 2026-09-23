function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function validTimestamp(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

export function stripeSubscriptionPeriodEnd(value: unknown) {
  const timestamp = validTimestamp(value);
  if (timestamp) return new Date(timestamp * 1000).toISOString();

  const subscription = record(value);
  if (!subscription) return null;
  const legacyTimestamp = validTimestamp(subscription.current_period_end);
  if (legacyTimestamp) return new Date(legacyTimestamp * 1000).toISOString();

  const items = record(subscription.items);
  const data = Array.isArray(items?.data) ? items.data : [];
  const itemPeriods = data
    .map((item) => validTimestamp(record(item)?.current_period_end))
    .filter((item): item is number => item !== null);
  if (!itemPeriods.length) return null;

  // Keep entitlement no later than the earliest included subscription item period.
  return new Date(Math.min(...itemPeriods) * 1000).toISOString();
}
