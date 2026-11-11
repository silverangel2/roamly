import type { Config } from "tailwindcss";
import { buiMotion, buiPrimitives, buiRadius, buiShadow } from "./components/boardui/tokens";

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
           tokens. Zero black in design elements.
           G11 (Stage 8, 2026-11-11): the values are NOT literals —
           they are imported from the one canonical home,
           components/boardui/tokens.ts (buiPrimitives), so this
           palette can never drift from the BoardUI tokens. */
        chead: buiPrimitives.head,
        cink: buiPrimitives.ink,
        cgray: buiPrimitives.gray,
        cgray2: buiPrimitives.gray2,
        chair: buiPrimitives.hairline,
        cchev: buiPrimitives.chevron,
        cbg: buiPrimitives.bg,
        cblue: buiPrimitives.blue,
        cgreen: buiPrimitives.success,
        cred: buiPrimitives.warning,
        cnavy: buiPrimitives.navy,
        csoft: buiPrimitives.soft,
        corange: buiPrimitives.orange,
        cpurple: buiPrimitives.purple
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 32, 51, 0.12)",
        glow: "0 22px 70px rgba(84, 214, 198, 0.28)",
        calm: "0 1px 2px rgba(31, 45, 77, 0.05)",
        sheet: "0 -2px 18px rgba(31, 45, 77, 0.10)",
        /* BoardUI foundation (additive, 2026-11-03): elevation scale
           ported from BoardUI's theme foundation, values = Roamly
           tokens — imported from components/boardui/tokens.ts
           (buiShadow), the one canonical home (G11, Stage 8). */
        "bui-card": buiShadow.card,
        "bui-lift": buiShadow.lift,
        "bui-hero": buiShadow.hero
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      borderRadius: {
        app: buiRadius.app,
        /* BoardUI foundation (additive, 2026-11-03) — values imported
           from components/boardui/tokens.ts (buiRadius) (G11). */
        "bui-card": buiRadius.card,
        "bui-panel": buiRadius.panel
      },
      transitionTimingFunction: {
        /* BoardUI foundation (additive, 2026-11-03): the house easing,
           named so BoardUI-ported components can reference it —
           imported from components/boardui/tokens.ts (buiMotion) (G11). */
        bui: buiMotion.ease
      }
    }
  },
  plugins: []
};

export default config;
