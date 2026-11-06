import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";

/*
 * BackHeader — the shared back control for deep (non-tab) surfaces
 * (Jakob's Law A1, 2026-11-03). Travellers look for back in one
 * place — top-left, a chevron with the destination named beside it —
 * because that is where Google Maps, Apple Maps, Airbnb, and
 * Booking.com put it. Every surface that is not a tab destination
 * renders this header first, so the way out is always in the same
 * place, including in standalone mode where there is no browser
 * back button to fall back on.
 *
 * The tap target is min-h-11 min-w-11 (44px), the platform minimum:
 * an icon-only or undersized back target is a familiarity defect
 * (A2), not a style choice.
 *
 * `right` is an optional slot for a surface's own top-right control
 * (for example the event sheet's × close, per sheet convention);
 * it carries no behaviour of its own.
 */
export function BackHeader({
  href,
  label,
  ariaLabel,
  right
}: {
  /** Where back goes — the surface this one was opened from. */
  href: string;
  /** Destination name shown beside the chevron (e.g. "Trip"). */
  label: string;
  /** Overrides the accessible name when `label` is already a full
   *  phrase (e.g. the day pass's "Back to today"). */
  ariaLabel?: string;
  /** Optional top-right control rendered opposite the back link. */
  right?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <a
        href={href}
        aria-label={ariaLabel ?? `Back to ${label.toLowerCase()}`}
        className="inline-flex min-h-11 min-w-11 items-center gap-0.5 text-chead"
      >
        <ChevronLeft aria-hidden="true" size={26} strokeWidth={2} />
        <span className="text-[15px] font-semibold leading-5">{label}</span>
      </a>
      {right ?? null}
    </div>
  );
}
