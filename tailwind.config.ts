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
        /* Calm design system (owner-approved, 2026-10-23): navy-slate
           ink on the iOS grouped ground; system blue is the only
           accent, spent sparingly. Zero black in design elements. */
        chead: "#1F2D4D",
        cink: "#3D4E6D",
        cgray: "#7C8698",
        cgray2: "#9AA5B8",
        chair: "#E1E7F0",
        cchev: "#B7C1D2",
        cbg: "#EFF2F7",
        cblue: "#007AFF",
        cgreen: "#34C759",
        cred: "#FF3B30"
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
