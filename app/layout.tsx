import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { AiraloImpactScript } from "@/components/roamly/AiraloImpactScript";
import { TravelpayoutsDriveScript } from "@/components/roamly/TravelpayoutsDriveScript";
import { getServerLocale } from "@/lib/i18n-server";

export const metadata: Metadata = {
  title: {
    default: "Roamly - AI travel planner for beautiful budget-aware trips",
    template: "%s | Roamly"
  },
  description: "Plan realistic single-city and multi-city trips, organize bookings, and travel with a live AI companion.",
  applicationName: "Roamly",
  manifest: "/manifest.json",
  metadataBase: new URL("https://roamlyhq.com"),
  icons: {
    icon: [
      { url: "/icon-192.png?v=3", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png?v=3", sizes: "512x512", type: "image/png" }
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

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getServerLocale();
  return (
    <html lang={locale}>
      <body>
        <AiraloImpactScript />
        <TravelpayoutsDriveScript />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
