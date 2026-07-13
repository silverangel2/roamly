import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { TravelpayoutsDriveScript } from "@/components/roamly/TravelpayoutsDriveScript";

export const metadata: Metadata = {
  title: {
    default: "Roamly - AI travel planner for beautiful budget-aware trips",
    template: "%s | Roamly"
  },
  description: "Plan realistic single-city and multi-city trips, organize bookings, and travel with a live AI companion.",
  applicationName: "Roamly",
  manifest: "/manifest.json",
  metadataBase: new URL("https://getroamly.com"),
  icons: {
    icon: [
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#0f766e"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <TravelpayoutsDriveScript />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
