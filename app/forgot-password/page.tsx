import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { Badge } from "@/components/ui/Badge";
import { Card } from "@/components/ui/Card";
import { getCurrentUser } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Reset Your Roamly Password",
  description: "Request a password reset link for your Roamly account.",
  openGraph: {
    title: "Reset your Roamly password",
    description: "Get a secure reset link by email to set a new password.",
    url: "https://roamlyhq.com/forgot-password",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function ForgotPasswordPage() {
  const current = await getCurrentUser();

  if (current.configured && current.user) {
    redirect("/plan");
  }

  return (
    <div className="safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] min-w-0 w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
      <section className="min-w-0 space-y-5">
        <Badge>Account help</Badge>
        <h1 className="max-w-2xl text-4xl font-black leading-tight tracking-tight text-ink sm:text-6xl">
          Reset your Roamly password.
        </h1>
        <p className="max-w-xl text-base font-semibold leading-7 text-slate-600">
          Enter the email for your Roamly account and we will send you a secure reset link.
        </p>
        <div className="grid gap-3 sm:grid-cols-3">
          {["Secure link", "Expires in 60 minutes", "Works on any device"].map((item) => (
            <div key={item} className="rounded-2xl bg-white/80 p-4 text-sm font-black text-ink shadow-soft">
              {item}
            </div>
          ))}
        </div>
      </section>

      <Card className="mx-auto min-w-0 w-full max-w-md">
        <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">Roamly account</p>
        <h2 className="mt-2 text-2xl font-black text-ink">Forgot password</h2>
        <div className="mt-5">
          <ForgotPasswordForm />
        </div>
      </Card>
    </div>
  );
}
