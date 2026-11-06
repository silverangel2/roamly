import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ForgotPasswordForm } from "@/components/auth/ForgotPasswordForm";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiCard } from "@/components/boardui/Card";
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
    <div className="bg-cbg">
      <div className="bui-safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] min-w-0 w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
        {/* Apply-All Sweep (2026-11-03): same auth treatment as
            login — token ground + the Round 1 pricing hero panel;
            the three assurance chips become check rows inside the
            panel. Copy unchanged. */}
        <section className="bui-enter min-w-0 overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-6 shadow-bui-hero sm:p-10">
          <BuiBadge tone="primary">Account help</BuiBadge>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-tight text-chead sm:text-6xl">
            Reset your Roamly password.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-cink">
            Enter the email for your Roamly account and we will send you a secure reset link.
          </p>
          <ul className="mt-6 grid gap-2">
            {["Secure link", "Expires in 60 minutes", "Works on any device"].map((item) => (
              <li
                key={item}
                className="flex items-center gap-3 rounded-2xl bg-white/85 px-4 py-3 text-sm font-black text-chead shadow-[inset_0_0_0_1px_rgba(220,229,240,0.85)]"
              >
                <span aria-hidden="true" className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cblue text-white">
                  <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M5 12.5l4.2 4.2L19 7" />
                  </svg>
                </span>
                {item}
              </li>
            ))}
          </ul>
        </section>

        <BuiCard className="bui-enter mx-auto min-w-0 w-full max-w-md rounded-bui-panel p-6">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-cblue">Roamly account</p>
          <h2 className="mt-2 text-2xl font-black text-chead">Forgot password</h2>
          <div className="mt-5">
            <ForgotPasswordForm />
          </div>
        </BuiCard>
      </div>
    </div>
  );
}
