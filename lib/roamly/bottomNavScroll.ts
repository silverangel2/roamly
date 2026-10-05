/** Facebook-style mobile nav: hide while the page moves down, show on the way up. */

export const BOTTOM_NAV_SCROLL_THRESHOLD = 12;
export const BOTTOM_NAV_REVEAL_UNTIL = 32;

export function nextBottomNavHidden(input: {
  anchorY: number;
  currentY: number;
  hidden: boolean;
  /** Keep the nav available while a control inside it has focus. */
  focused?: boolean;
  threshold?: number;
  revealUntil?: number;
}): { hidden: boolean; anchorY: number } {
  const threshold = input.threshold ?? BOTTOM_NAV_SCROLL_THRESHOLD;
  const revealUntil = input.revealUntil ?? BOTTOM_NAV_REVEAL_UNTIL;
  const y = Number.isFinite(input.currentY) ? Math.max(0, input.currentY) : 0;

  if (input.focused || y <= revealUntil) {
    return { hidden: false, anchorY: y };
  }

  const delta = y - input.anchorY;
  if (Math.abs(delta) < threshold) {
    return { hidden: input.hidden, anchorY: input.anchorY };
  }

  return { hidden: delta > 0, anchorY: y };
}
