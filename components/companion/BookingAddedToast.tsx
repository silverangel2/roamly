"use client";

/**
 * BookingAddedToast — the arrival half of the manual booking add.
 *
 * Success Rules pass (2026-11-03), census row 13: adding a booking
 * by hand completed SILENTLY — the form just navigated to the
 * bookings list, where the new booking sat unlabelled among the
 * rest. Rule 1 wants the moment named; rule 3 wants it light (the
 * list itself is the artifact, so a ~4s toast is the right weight).
 *
 * Mechanism: ManualBookingForm writes the booking's title to
 * sessionStorage under BOOKING_ADDED_FLAG just before it navigates;
 * this component, mounted on the bookings page, reads the flag
 * exactly once on arrival, removes it (a refresh never re-toasts),
 * and shows the toast. No flag — direct arrival, a refresh, the
 * Gmail import path — no toast.
 */
import { useEffect } from "react";
import { BuiToast, useBuiToast } from "@/components/boardui/Toast";

export const BOOKING_ADDED_FLAG = "roamly:booking-added";

export function BookingAddedToast() {
  const { toast, showToast, clearToast } = useBuiToast();

  useEffect(() => {
    let title = "";
    try {
      const raw = window.sessionStorage.getItem(BOOKING_ADDED_FLAG);
      if (raw) {
        window.sessionStorage.removeItem(BOOKING_ADDED_FLAG);
        const parsed = JSON.parse(raw) as { title?: unknown };
        title = typeof parsed?.title === "string" ? parsed.title.trim() : "";
      }
    } catch {
      title = "";
    }
    if (title) showToast(`Booking added: ${title}.`);
    // Arrival-only: runs once on mount, by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!toast) return null;
  return <BuiToast key={toast.id} message={toast.message} tone={toast.tone} onDismiss={clearToast} />;
}
