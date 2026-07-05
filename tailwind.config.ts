import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        ink: "#102033",
        ocean: "#1B9AAA",
        lagoon: "#54D6C6",
        sun: "#FFB84D",
        coral: "#FF6B6B",
        mist: "#F4F8FB",
        cloud: "#E9F1F7"
      },
      boxShadow: {
        soft: "0 18px 50px rgba(16, 32, 51, 0.12)",
        glow: "0 22px 70px rgba(84, 214, 198, 0.28)"
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
