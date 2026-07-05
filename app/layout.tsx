import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AppShell } from "@/components/AppShell";

export const metadata: Metadata = {
  title: {
    default: "Roamly - Budget-aware AI travel companion",
    template: "%s | Roamly"
  },
  description:
    "Plan trips that fit your budget, import booking screenshots, and unlock a Live Trip Companion for reminders, check-ins, and up-next travel guidance.",
  applicationName: "Roamly",
  metadataBase: new URL("https://getroamly.com"),
  icons: {
    icon: "/icon.svg",
    apple: "/icon.svg"
  }
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  themeColor: "#54D6C6"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
