import { ImageResponse } from "next/og";

// P0-1: code-drawn OG share image (1200x630). No external assets, no AI imagery.
export const runtime = "edge";
export const alt = "Roamly — AI travel planner";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function RoamlyOgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          width: "100%",
          height: "100%",
          padding: "72px 80px",
          color: "#ffffff",
          background: "linear-gradient(135deg, #082f2c 0%, #0f766e 52%, #155e59 100%)",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', sans-serif"
        }}
      >
        <div
          style={{
            fontSize: 118,
            fontWeight: 900,
            letterSpacing: -4,
            lineHeight: 1
          }}
        >
          Roamly
        </div>
        <div
          style={{
            marginTop: 26,
            fontSize: 42,
            fontWeight: 600,
            lineHeight: 1.3,
            opacity: 0.94,
            maxWidth: 940
          }}
        >
          AI travel planner for beautiful budget-aware trips
        </div>
        <div
          style={{
            marginTop: 44,
            fontSize: 28,
            fontWeight: 600,
            opacity: 0.7
          }}
        >
          roamlyhq.com
        </div>
      </div>
    ),
    { ...size }
  );
}
