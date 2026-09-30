import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";
import { TravelpayoutsDriveScript } from "@/components/roamly/TravelpayoutsDriveScript";
import { ServiceWorkerRegistrar } from "@/components/ServiceWorkerRegistrar";
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
  },
  openGraph: {
    title: "Roamly - AI travel planner for beautiful budget-aware trips",
    description: "Plan realistic single-city and multi-city trips, organize bookings, and travel with a live AI companion.",
    url: "https://roamlyhq.com",
    siteName: "Roamly",
    type: "website",
    locale: "en_CA",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  },
  twitter: {
    card: "summary_large_image",
    title: "Roamly - AI travel planner for beautiful budget-aware trips",
    description: "Plan realistic single-city and multi-city trips, organize bookings, and travel with a live AI companion.",
    images: ["https://roamlyhq.com/opengraph-image"]
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0f766e"
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getServerLocale();
  return (
    <html lang={locale}>
      <body>
        <ServiceWorkerRegistrar />
        <TravelpayoutsDriveScript />
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
