import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#102033",
        // DEPRECATED ALIAS (consolidation 2026-11-06, app-wide teal
        // purge): every ocean utility was migrated to cblue at the
        // class level; the token survives ONLY so any dynamically
        // constructed class string lands on the BoardUI blue
        // instead of resurrecting the killed teal. Do not use in
        // new code — use cblue.
        ocean: "#087BFF",
        lagoon: "#54D6C6",
        sun: "#FFB84D",
        coral: "#FF6B6B",
        mist: "#F4F8FB",
        cloud: "#E9F1F7",
        /* Calm design system (owner-approved, 2026-10-23), retuned to
           the adopted design-spec tokens (2026-10-26, pixel-CLOSE
           contract — never claimed as the mockups' original values):
           primary/headings/secondary/page-ground/borders/success/
           warning now carry the spec hexes; deep navy, soft blue,
           and the two activity accents are added as first-class
           tokens. Zero black in design elements. */
        chead: "#223354",
        cink: "#3D4E6D",
        cgray: "#657795",
        cgray2: "#9AA5B8",
        chair: "#DCE5F0",
        cchev: "#B7C1D2",
        cbg: "#F2F6FC",
        cblue: "#087BFF",
        cgreen: "#17A86B",
        cred: "#E94F67",
        cnavy: "#071E55",
        csoft: "#E6EFFA",
        corange: "#FF793D",
        cpurple: "#8957E5"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 32, 51, 0.12)",
        glow: "0 22px 70px rgba(84, 214, 198, 0.28)",
        calm: "0 1px 2px rgba(31, 45, 77, 0.05)",
        sheet: "0 -2px 18px rgba(31, 45, 77, 0.10)",
        /* BoardUI foundation (additive, 2026-11-03): elevation scale
           ported from BoardUI's theme foundation, values = Roamly
           tokens (see components/boardui/tokens.ts). */
        "bui-card": "0 1px 2px rgba(31, 45, 77, 0.05), 0 10px 28px rgba(16, 32, 51, 0.05)",
        "bui-lift": "0 2px 4px rgba(31, 45, 77, 0.06), 0 24px 48px -24px rgba(7, 30, 85, 0.25)",
        "bui-hero": "0 24px 70px -28px rgba(7, 30, 85, 0.35)"
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      borderRadius: {
        app: "1.75rem",
        /* BoardUI foundation (additive, 2026-11-03). */
        "bui-card": "1.25rem",
        "bui-panel": "1.5rem"
      },
      transitionTimingFunction: {
        /* BoardUI foundation (additive, 2026-11-03): the house easing,
           named so BoardUI-ported components can reference it. */
        bui: "cubic-bezier(0.32, 0.72, 0, 1)"
      }
    }
  },
  plugins: []
};

export default config;
