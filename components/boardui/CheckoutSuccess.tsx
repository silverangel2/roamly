/**
 * BoardUI CheckoutSuccess — the payment confirmation panel.
 *
 * Purpose (owner SUCCESS-SCREEN RULES, 2026-11-03): the payment is
 * the highest-stakes success in the app, so it breaks every
 * low-stakes habit on purpose —
 *   #1 it says what happened SPECIFICALLY: the product bought, the
 *      amount charged, the trip it unlocked. Never a bare "Success".
 *   #2 it offers the NEXT ACTION on the panel itself.
 *   #3 it STAYS. No timer, no auto-dismiss, no toast — the traveller
 *      leaves it by navigating, with the receipt one tap away. (The
 *      matching email half of this rule is the purchase-activation
 *      email's job — see the follow-on spec.)
 *   #4 it leaves ONE OPEN LOOP: setting up Live Companion, the step
 *      the purchase just unlocked.
 *   #5 no celebration. A calm confirmation is the right register for
 *      money; there is no confetti anywhere in this tree.
 *
 * HAND-OFF CONTRACT (read before wiring): this is the DESIGN half,
 * built for the follow-on checkout-success fix (owner decision
 * 2026-11-03; spec: goals/roamly-october-4-repair/hidden_files/
 * CHECKOUT-SUCCESS-FIX-SPEC.md). It is deliberately NOT mounted in
 * app/trip/[id]/page.tsx yet, because today that page cannot supply
 * honest props: confirmCheckoutSessionForTrip (lib/payments.ts)
 * retrieves the session server-side but returns only
 * { ok, awaitingWebhook, error } — the amount charged and the
 * receipt path never reach the page, and justPurchased
 * (page.tsx, "show the Live Companion install step once") is a
 * boolean with no purchase data behind it. The follow-on fix
 * extends that return FROM THE SERVER-CONFIRMED SESSION and mounts
 * this panel where justPurchased is true, feeding it:
 *   productName — the purchased product's display name
 *   amountLabel — amount + currency actually charged, formatted by
 *                 the caller (e.g. "CAD $7.99"), from the session
 *   tripTitle   — the trip the purchase belongs to
 *   receiptHref — the Stripe receipt URL from the confirmed
 *                 session (omit the prop and no receipt line
 *                 renders — never link a guessed receipt)
 *   setupHref   — the Live Companion setup step (the open loop)
 *   tripHref    — "View your trip"
 * A forged ?checkout=success must never render this panel: the
 * gate stays the server-confirmed state (paidForItinerary /
 * trackingUnlocked after the return-path confirm), exactly as the
 * spec requires.
 */
import { BuiCard } from "./Card";
import { BuiButtonLink } from "./Button";
import { cx } from "./cx";

export interface BuiCheckoutSuccessProps {
  productName: string;
  amountLabel: string;
  tripTitle: string;
  receiptHref?: string;
  setupHref: string;
  tripHref: string;
  className?: string;
}

export function BuiCheckoutSuccess({
  productName,
  amountLabel,
  tripTitle,
  receiptHref,
  setupHref,
  tripHref,
  className
}: BuiCheckoutSuccessProps) {
  return (
    <BuiCard className={cx("bui-enter overflow-hidden", className)}>
      <div className="border-l-4 border-cgreen p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cgreen/15 text-sm font-black text-cgreen"
          >
            ✓
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-[19px] font-bold leading-snug tracking-[-0.014em] text-chead">
              Payment confirmed — {productName}
            </h2>
            <p className="mt-1.5 text-sm leading-6 text-cink">
              {tripTitle} is unlocked. You were charged {amountLabel}.
              {receiptHref ? (
                <>
                  {" "}
                  <a
                    href={receiptHref}
                    className="font-semibold text-cblue underline decoration-cblue/40 underline-offset-4 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-cblue/25"
                  >
                    View your receipt
                  </a>
                  .
                </>
              ) : null}
            </p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2.5 pl-9">
          <BuiButtonLink href={setupHref}>Set up Live Companion</BuiButtonLink>
          <BuiButtonLink href={tripHref} variant="secondary">
            View your trip
          </BuiButtonLink>
        </div>
      </div>
    </BuiCard>
  );
}
