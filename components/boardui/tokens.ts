/**
 * BoardUI foundation — token layer (Roamly port).
 *
 * Provenance: structure ported from BoardUI's `theme` foundation
 * (BoardUI/boardui, MIT — color primitives → semantic tokens → radii →
 * shadows → motion). BoardUI ships this as Tailwind v4 CSS-first
 * (`styles/theme.css`); Roamly's tree runs Tailwind v3, so the same
 * structure is expressed here as data + CSS variables (see the BoardUI
 * block in `app/globals.css`) + additive Tailwind config keys.
 *
 * Brand law: BoardUI supplies the STRUCTURE. Every value below is a
 * Roamly value from the owner's adopted design tokens (2026-10-26) —
 * where BoardUI's palette and Roamly's conflict, Roamly wins. No black:
 * ink is deep navy-slate.
 */

export const buiPrimitives = {
  blue: "#087BFF", // Roamly primary
  navy: "#071E55", // deep navy (hero/deep surfaces)
  head: "#223354", // headings
  ink: "#3D4E6D", // body ink (navy-slate)
  gray: "#657795", // secondary text
  gray2: "#9AA5B8", // tertiary text
  hairline: "#DCE5F0", // borders / hairlines
  chevron: "#B7C1D2",
  bg: "#F2F6FC", // page ground
  soft: "#E6EFFA", // soft blue wash
  card: "#FFFFFF", // card surface
  success: "#17A86B",
  orange: "#FF793D",
  purple: "#8957E5",
  warning: "#E94F67"
} as const;

/** Semantic roles — the layer components reference (BoardUI's model:
 *  components name roles, never raw primitives). */
export const buiTokens = {
  bgPage: buiPrimitives.bg,
  bgSurface: buiPrimitives.card,
  bgSoft: buiPrimitives.soft,
  bgDeep: buiPrimitives.navy,
  textPrimary: buiPrimitives.head,
  textBody: buiPrimitives.ink,
  textSecondary: buiPrimitives.gray,
  textTertiary: buiPrimitives.gray2,
  borderHairline: buiPrimitives.hairline,
  accent: buiPrimitives.blue,
  accentSuccess: buiPrimitives.success,
  accentWarm: buiPrimitives.orange,
  accentAlt: buiPrimitives.purple,
  danger: buiPrimitives.warning
} as const;

/** Radius scale (BoardUI-style steps, Roamly's app radius kept). */
export const buiRadius = {
  chip: "999px",
  control: "0.75rem", // buttons / inputs (BoardUI control radius)
  card: "1.25rem", // BoardUI card craft
  panel: "1.5rem",
  app: "1.75rem" // Roamly's existing `rounded-app`
} as const;

/** Elevation scale — soft, navy-tinted, never black shadows. */
export const buiShadow = {
  card: "0 1px 2px rgba(31, 45, 77, 0.05), 0 10px 28px rgba(16, 32, 51, 0.05)",
  lift: "0 2px 4px rgba(31, 45, 77, 0.06), 0 24px 48px -24px rgba(7, 30, 85, 0.25)",
  hero: "0 24px 70px -28px rgba(7, 30, 85, 0.35)"
} as const;

/**
 * Motion tokens. BoardUI's motion craft, expressed on Roamly's house
 * easing — cubic-bezier(0.32, 0.72, 0, 1), the curve every existing
 * calm-* primitive already uses. Nothing bouncy; everything under
 * ~420ms; all primitives ship prefers-reduced-motion kill switches
 * (see the BoardUI block in app/globals.css).
 */
export const buiMotion = {
  ease: "cubic-bezier(0.32, 0.72, 0, 1)",
  enterMs: 420, // section/card entrance (fade + 8px rise)
  crossfadeMs: 350,
  sheetMs: 320,
  pressMs: 180,
  liftMs: 350
} as const;

export type BuiTone = "primary" | "navy" | "success" | "warm" | "alt" | "danger" | "neutral";

/**
 * Owner layout checklist (2026-11-03) — five standing mobile rules,
 * baked into the foundation so future screens inherit them. The CSS
 * halves live in the BoardUI block of app/globals.css (classes named
 * below); this object is the data/documentation half.
 *
 * 1. Tables become cards under 640px — wrap any data table in
 *    `.bui-table-cards` and give each cell a `data-label`.
 * 2. Big numbers never wrap — class `bui-display-number` (nowrap +
 *    tabular figures) on every price/stat display; size caps:
 *    card prices <= 1.875rem (text-3xl), hero stats <= 3rem
 *    (text-5xl).
 * 3. Input text >= 16px (class `bui-input` — stops iOS Safari
 *    auto-zoom) + the correct inputmode per field (below).
 * 4. Touch targets >= 44px on coarse pointers — classes `bui-touch`
 *    / `bui-touch-square` (BuiButton/BuiButtonLink carry them
 *    automatically; desktop density is unchanged).
 * 5. Fixed bottom bars pad with env(safe-area-inset-bottom) — class
 *    `bui-safe-bottom`; content clearance pairs with the base's
 *    existing `.safe-bottom`.
 */
export const buiLayout = {
  tableCardsClass: "bui-table-cards",
  tableCardsBreakpointPx: 640,
  displayNumberClass: "bui-display-number",
  displayNumberCaps: { card: "1.875rem", hero: "3rem" },
  inputClass: "bui-input",
  inputTextMinPx: 16,
  inputModes: {
    integer: "numeric",
    money: "decimal",
    email: "email",
    phone: "tel"
  },
  touchTargetMinPx: 44,
  touchClass: "bui-touch",
  touchSquareClass: "bui-touch-square",
  safeBottomClass: "bui-safe-bottom"
} as const;

/**
 * Owner "vibe-coded tells" checklist (2026-11-03) — the design side,
 * as foundation contracts. Functional verification (double-submit
 * idempotency, grant persistence) lives with the app logic and the
 * Jakob round; these are the visible patterns that must never regress:
 *
 * 1. No generic AI look — Roamly tokens only; no purple-gradient
 *    defaults; no emoji icons (icon slots take real icon components;
 *    Lucide at re-base).
 * 2. Double-submit — every submit/action control uses the `busy`
 *    pattern on BuiButton/BuiButtonLink: set busy on first tap,
 *    clear when the action settles. Busy disables + spins + sets
 *    aria-busy, so a second tap can never fire.
 * 3. Keyboard never covers the field — `.bui-input` carries
 *    scroll-margin (see buiLayout) so focus scrolls clear.
 * 4. Errors are human — BuiNotice (components/boardui/Notice.tsx):
 *    plain-words title, explanation, one next step. Raw error text
 *    and silent failures are both defects.
 * 5. Persistence — a preference control binds to stored state and
 *    renders the stored value on load, never a default dressed as
 *    the traveller's choice. Controls that are transient by design
 *    (carousels, showcase rotation) must not look like preferences.
 */
export const buiVibeChecks = {
  submitBusyProp: "busy",
  noticeComponent: "BuiNotice",
  noticeTones: ["error", "info", "success"]
} as const;

/**
 * Owner form rules (2026-11-03) — the field-level contracts, mirrored
 * as data beside the layout checklist above. Behaviour lives in
 * components/boardui/Field.tsx; the autofill paint lives in
 * app/globals.css (the .bui-input:-webkit-autofill block).
 *
 * 1. Never placeholder-as-label — every field carries a persistent
 *    visible label; a placeholder is an example, never the name.
 * 2. Validate on blur, not on keystroke — `useBuiField`: first error
 *    on blur (or submit); after a first error, re-check per keystroke
 *    so the fix clears it instantly.
 * 3. The submit button never moves — `BuiFieldError` always renders
 *    its reserved one-line slot; on submit, `BuiErrorSummary` at the
 *    top of the form links to every broken field.
 * 4. Autofill styled on purpose — white surface, head-ink text, in
 *    the globals.css block named above.
 * 5. Codes are not quantities — a code-like field is type="text"
 *    with inputMode "numeric" (see buiLayout.inputModes.integer);
 *    type="number" is for genuine quantities only.
 */
export const buiFormRules = {
  fieldHook: "useBuiField",
  fieldErrorComponent: "BuiFieldError",
  errorSummaryComponent: "BuiErrorSummary",
  errorSlotMinHeightClass: "min-h-5",
  codeInputType: "text",
  codeInputMode: "numeric"
} as const;

/**
 * Owner success-screen rules (2026-11-03) — the done-state
 * contracts, mirrored as data beside the form rules above.
 * Behaviour lives in components/boardui/Toast.tsx (the leaving
 * kind) and components/boardui/CheckoutSuccess.tsx (the staying
 * kind).
 *
 * 1. Say what happened, specifically — a done state names its
 *    object (the trip, the booking, the recipient, the amount);
 *    a bare "Success" is a breach.
 * 2. Every success offers the next action — a checkmark with no
 *    button is a dead end.
 * 3. Dismissal follows stakes — low-stakes (a saved setting) is a
 *    toast gone in ~4s (buiSuccessRules.toastDurationMs); a payment
 *    is a panel that stays, with receipt + email.
 * 4. Leave one open loop — track it, share it, set up the next
 *    thing the success just unlocked.
 * 5. Celebration scales with rarity — no confetti or emoji bursts
 *    for routine saves; this tree has none anywhere.
 */
export const buiSuccessRules = {
  toastComponent: "BuiToast",
  toastHook: "useBuiToast",
  toastDurationMs: 4000,
  checkoutSuccessComponent: "BuiCheckoutSuccess"
} as const;

/**
 * Owner container rules (2026-11-03) — the gesture contract,
 * mirrored as data beside the rule mirrors above (Apply-All Sweep:
 * rule 3 was a recorded gap in the Container Rules pass; the
 * owner's "apply those can be applied" directive built it).
 * Behaviour lives in components/boardui/Sheet.tsx (BuiSheet).
 *
 * 3. Dismiss by velocity, not distance — a downward flick at or
 *    above flickVelocityPxPerMs (measured over the trailing
 *    velocityWindowMs of the drag) closes from any position; a
 *    slow drag must cross halfway (halfHeightFraction); anything
 *    else settles to the sheet's snap ON THE SPRING (iPhone-Feel
 *    pass, 2026-11-04: the release velocity becomes the spring's
 *    initial velocity, so a released sheet first carries with the
 *    finger's momentum, then settles — physics in
 *    components/boardui/spring.ts, buiSpringPhysics below).
 *    Past-the-snap pulls (upward, or any pull on a locked sheet)
 *    RUBBER-BAND: resistance grows with the pull
 *    (rubberBandUpConstantPx: a 200px pull stretches 86px), and
 *    locked sheets (dismissible=false) always spring back —
 *    gestures never bypass the gate lock. A grab mid-settle or
 *    mid-close retakes the sheet from its current position
 *    (interruptible); a pending close is cancelled by the grab.
 *    Desktop drawers do not drag (the breakpoint below which
 *    gestures engage).
 */
export const buiSheetGestures = {
  component: "BuiSheet",
  flickVelocityPxPerMs: 0.5,
  velocityWindowMs: 120,
  halfHeightFraction: 0.5,
  rubberBandUpConstantPx: 151,
  rubberBandLockedConstantPx: 110,
  gestureMaxBreakpointPx: 1024
} as const;

/**
 * iPhone-feel physics (owner rules, 2026-11-04 — ~/AGENTS.md
 * "IPHONE FEEL — 6 INVISIBLE DETAILS"), the foundation's data
 * mirror. Behaviour: components/boardui/spring.ts (the JS
 * integrator + rubber-band curve) and the physics block at the end
 * of app/globals.css (the CSS half).
 *
 * 1. Press feedback on touch-down (0 ms) — touch-action:
 *    manipulation (.bui-tap) kills the tap delay; :active states
 *    (bui-press, bui-tab-press) are the visible answer.
 * 2. Springs, not timers — dampingRatio 0.8 = 1.52% theoretical
 *    overshoot, the owner's ~1.5%; springEase is the CSS shadow
 *    of the same settle (peak output 1.015 on the curve).
 * 3. Momentum — native touch momentum + overscroll containment
 *    (.bui-momentum) on scroll surfaces; gesture surfaces carry
 *    the release velocity INTO the spring (see buiSheetGestures).
 * 4. Rubber band — pull·K/(pull+K); K=151 gives 86px of stretch
 *    on a 200px pull, the owner's figure.
 * 5. Interruptible — every spring retargets mid-flight with its
 *    velocity intact; pointer input is never locked by an
 *    animation (logic locks, e.g. double-submit, are not
 *    animation locks and stay).
 * 6. Continuous corners — .bui-squircle (corner-shape: squircle
 *    behind @supports) on the Card / Sheet / checkout-panel
 *    primitives; plain radius is the fallback.
 * Reduced motion neutralises all of it: springs land instantly,
 * CSS travel is killed by the foundation's reduce blocks.
 */
export const buiSpringPhysics = {
  module: "components/boardui/spring.ts",
  stiffness: 260,
  dampingRatio: 0.8,
  overshootPct: 1.52,
  springEase: "cubic-bezier(0.3, 1.22, 0.4, 1)",
  rubberBandConstantPx: 151,
  rubberBandStretchAt200Px: 86,
  tapClass: "bui-tap",
  tabPressClass: "bui-tab-press",
  momentumClass: "bui-momentum",
  squircleClass: "bui-squircle"
} as const;
