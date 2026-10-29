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
        ocean: "#0f6e66",
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
        sheet: "0 -2px 18px rgba(31, 45, 77, 0.10)"
      },
      fontFamily: {
        sans: ["var(--font-geist-sans)", "Inter", "ui-sans-serif", "system-ui", "sans-serif"]
      },
      borderRadius: {
        app: "1.75rem"
      }
    }
  },
  plugins: []
};

export default config;
