/*
 * Roamly design tokens — SINGLE SOURCE OF TRUTH for the 8 exactness
 * screens (adopted design spec, 2026-10-26).
 *
 * Honest framing (binding): the illustrations are AI-generated
 * mockups, NOT Figma exports. There is no original CSS and no exact
 * measurements to recover. These tokens are proposed implementation
 * tokens for a PIXEL-CLOSE reproduction — the screenshots are the
 * visual authority, this file is the contract. Never claim any value
 * below is the mockups' original exact value.
 *
 * How tokens reach the UI: the Tailwind theme (tailwind.config.ts)
 * carries the same hexes under the `c*` names (cblue, chead, cgray,
 * cbg, chair, cgreen, cred, cnavy, csoft, corange, cpurple) so every
 * component uses tokens through classes, never hardcoded hexes. This
 * file is the readable contract + the typed record; the theme is the
 * enforcement point. If a value changes, change it in BOTH places.
 *
 * Photos: heroes and activity photos come ONLY from the real
 * Wikimedia/Wikidata pipeline (lib/roamly/destinationPhoto.ts) with
 * source attribution. Mockup photos are NEVER extracted as assets
 * (they may be synthetic or inaccurate). No photo from the pipeline
 * means the bare treatment + a named gap — never a generated, drawn,
 * or fake map or image.
 */

export const DESIGN_TOKENS = {
  color: {
    /** Primary actions, links, selected tabs. */
    primary: "#087BFF",
    /** Deep navy — avatar/profile accents, darkest surfaces. */
    deepNavy: "#071E55",
    /** Headings and titles. */
    headings: "#223354",
    /** Secondary text, subtitles, captions. */
    secondaryText: "#657795",
    /** Page background (iOS grouped ground). */
    pageBackground: "#F2F6FC",
    /** Cards. */
    card: "#FFFFFF",
    /** Soft blue fills (selected chips, info banners). */
    softBlue: "#E6EFFA",
    /** Card borders and dividers. */
    border: "#DCE5F0",
    /** Success, confirmations, completed states. */
    success: "#17A86B",
    /** Activity accent (food, walks, transfers). */
    activityOrange: "#FF793D",
    /** Activity accent (culture, galleries, shows). */
    activityPurple: "#8957E5",
    /** Warning / destructive (sign out, errors). */
    warningRed: "#E94F67"
  },
  layout: {
    /** Reference viewport for acceptance captures. */
    referenceViewport: { width: 390, height: 844 },
    /** Main content horizontal padding. */
    contentPaddingPx: 16,
    /** Gap between cards. */
    cardGapPx: 16,
    /** Card internal padding. */
    cardPaddingPx: 16,
    /** Card corner radius. */
    cardRadiusPx: 16,
    /** Hero image corner radius. */
    heroRadiusPx: 18,
    /** Primary button height. */
    primaryButtonHeightPx: 48,
    /** Button corner radius. */
    buttonRadiusPx: 12,
    /** Bottom navigation height, plus the safe area. */
    bottomNavHeightPx: 64
  },
  type: {
    fontFamily: "Inter or system sans-serif",
    /** Screen headings, bold. */
    headingPx: 30,
    /** Card headings, semibold. */
    cardHeadingPx: 18,
    /** Body text. */
    bodyPx: 15,
    /** Captions and footnotes. */
    captionPx: 12
  },
  shadow: {
    /** Soft, low-opacity blue-gray card shadow. */
    card: "0 1px 2px rgba(31, 45, 77, 0.05)"
  },
  alignment: {
    /** Consistent horizontal grid; text left-aligned; icons
     *  vertically centered; equal card widths. Centered text ONLY
     *  for short empty states or onboarding messages. */
    horizontalGridPx: 16,
    textAlignment: "left",
    iconAlignment: "center"
  }
} as const;

/** Tailwind class names that carry each token (the enforcement map). */
export const DESIGN_TOKEN_CLASSES = {
  primaryText: "text-cblue",
  primaryBackground: "bg-cblue",
  headingsText: "text-chead",
  secondaryText: "text-cgray",
  pageBackground: "bg-cbg",
  cardBackground: "bg-white",
  softBlueBackground: "bg-csoft",
  border: "border-chair",
  successText: "text-cgreen",
  successBackground: "bg-cgreen",
  warningText: "text-cred",
  deepNavyBackground: "bg-cnavy",
  activityOrangeText: "text-corange",
  activityPurpleText: "text-cpurple",
  cardRadius: "rounded-2xl",
  heroRadius: "rounded-[18px]",
  primaryButton: "h-12 rounded-xl"
} as const;
