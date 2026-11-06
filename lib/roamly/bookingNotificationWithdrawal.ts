/**
 * X1 write-path helper (Workstream A): when a booking leaves the
 * active set (wallet cancel, booking-monitor status flip), the
 * notifications minted from its companion events are MARKED withdrawn
 * — never deleted, so audit history is preserved.
 *
 * Link used: roamly_notifications.event_id → roamly_trip_companion_
 * events.id, whose booking_id names the booking. That is the
 * strongest link the notifications table carries (it has no
 * booking_id column of its own). Marking = metadata.withdrawn flag +
 * withdrawn_reason/withdrawn_at/booking_id stamps, with action_url
 * cleared so the row can no longer deep-link as a live travel update.
 * The Alerts read path additionally suppresses rows whose linked
 * booking is currently cancelled, so rows this helper could not reach
 * (no companion-event link) still cannot render as confirmed travel.
 *
 * Zero imports on purpose: both server callers (bookingWallet,
 * bookingMonitor) use it with their own Supabase client, and failure
 * here must never un-cancel a booking — callers treat a non-ok result
 * as a logged secondary failure.
 */

type WithdrawalClient = {
  from: (table: string) => any; // eslint-disable-line @typescript-eslint/no-explicit-any
};

export async function markBookingNotificationsWithdrawn(
  supabase: WithdrawalClient,
  params: { userId: string; tripId: string; bookingId: string; reason: string }
): Promise<{ ok: boolean; marked: number; error: string | null }> {
  try {
    const events = await supabase
      .from("roamly_trip_companion_events")
      .select("id")
      .eq("booking_id", params.bookingId)
      .eq("trip_id", params.tripId)
      .eq("user_id", params.userId);
    if (events.error) return { ok: false, marked: 0, error: String(events.error.message || events.error) };
    const eventIds = ((events.data || []) as Array<{ id?: unknown }>)
      .map((row) => (typeof row.id === "string" ? row.id : ""))
      .filter(Boolean);
    if (!eventIds.length) return { ok: true, marked: 0, error: null };

    const notifications = await supabase
      .from("roamly_notifications")
      .select("id,metadata")
      .eq("user_id", params.userId)
      .eq("trip_id", params.tripId)
      .in("event_id", eventIds);
    if (notifications.error) {
      return { ok: false, marked: 0, error: String(notifications.error.message || notifications.error) };
    }

    let marked = 0;
    for (const row of (notifications.data || []) as Array<{ id?: unknown; metadata?: unknown }>) {
      if (typeof row.id !== "string") continue;
      const metadata =
        row.metadata && typeof row.metadata === "object" && !Array.isArray(row.metadata)
          ? (row.metadata as Record<string, unknown>)
          : {};
      if (metadata.withdrawn === true) continue;
      const update = await supabase
        .from("roamly_notifications")
        .update({
          action_url: null,
          metadata: {
            ...metadata,
            withdrawn: true,
            withdrawn_reason: params.reason,
            withdrawn_at: new Date().toISOString(),
            booking_id: params.bookingId
          }
        })
        .eq("id", row.id)
        .eq("user_id", params.userId);
      if (!update.error) marked += 1;
    }
    return { ok: true, marked, error: null };
  } catch (error) {
    return { ok: false, marked: 0, error: error instanceof Error ? error.message : "NOTIFICATION_WITHDRAWAL_FAILED" };
  }
}
