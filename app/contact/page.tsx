import type { Metadata } from "next";
import { ContactForm } from "@/components/contact/ContactForm";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiButtonLink } from "@/components/boardui/Button";
import { BuiCard } from "@/components/boardui/Card";
import { getRoamlySupportEmail } from "@/lib/roamly/email";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Contact Roamly — Trip & Account Support",
  description: "Need help with a trip or your Roamly account? Contact support with your destination, account email, and a short description of what happened.",
  openGraph: {
    title: "Contact Roamly — trip & account support",
    description: "Need help with a trip or your Roamly account? Reach Roamly support.",
    url: "https://roamlyhq.com/contact",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function ContactPage() {
  const supportEmail = getRoamlySupportEmail();
  const current = await getCurrentUser();
  const accountEmail = current.user?.email || "";
  const accountName = typeof current.user?.user_metadata?.full_name === "string"
    ? current.user.user_metadata.full_name
    : typeof current.user?.user_metadata?.name === "string"
      ? current.user.user_metadata.name
      : "";

  return (
    <div className="safe-bottom mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
      <div className="grid gap-5 lg:grid-cols-[0.78fr_1.22fr]">
        <BuiCard className="self-start overflow-hidden p-5">
          <BuiBadge>Contact</BuiBadge>
          <h1 className="mt-4 text-4xl font-black tracking-tight text-chead sm:text-6xl">Need help with a trip?</h1>
          <p className="mt-3 max-w-2xl text-base font-semibold leading-7 text-cink">
            Send the trip destination, account email, and a short description of what happened. Keep booking confirmations and urgent travel changes with the provider too.
          </p>
          <div className="mt-6 grid gap-3">
            <BuiButtonLink href={`mailto:${supportEmail}`}>Email support</BuiButtonLink>
            <BuiButtonLink href="/plan" variant="secondary">Plan another trip</BuiButtonLink>
          </div>
          <p className="mt-5 break-words text-sm font-black text-cgray">{supportEmail}</p>
        </BuiCard>

        <ContactForm supportEmail={supportEmail} initialName={accountName} initialEmail={accountEmail} />
      </div>
    </div>
  );
}
