import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Roamly is briefly down for maintenance",
  description:
    "We're improving the Roamly trip builder. Trips already made are safe, new itinerary building is paused, and we'll be back shortly.",
  robots: { index: false, follow: false }
};

export default function MaintenancePage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col items-center px-5 py-16 text-center sm:py-24">
      <p className="text-xs font-black uppercase tracking-[0.18em] text-ocean">
        Roamly is briefly down for maintenance
      </p>
      <h1 className="mt-4 text-4xl font-black leading-tight text-ink sm:text-5xl">
        We&rsquo;re improving the trip builder.
      </h1>
      <p className="mt-5 max-w-xl text-base font-bold leading-7 text-slate-600">
        We&rsquo;re making Roamly&rsquo;s itinerary builder faster and more reliable. Trips you&rsquo;ve
        already made are safe and sound — nothing is lost. Building new itineraries is paused
        while we work, and we&rsquo;ll be back shortly.
      </p>
      <div className="mt-8 w-full max-w-xl rounded-[1.75rem] border border-cloud bg-white p-5 text-left shadow-soft sm:p-6">
        <p className="text-sm font-black text-ink">Already have a trip?</p>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          If you&rsquo;re signed in on this device, you can still open and view the trips
          you&rsquo;ve already made. If a trip was still being built when we paused, it will
          finish and be emailed to you when it&rsquo;s ready — you don&rsquo;t need to start over.
        </p>
        <p className="mt-4 text-sm font-black text-ink">Need a hand right now?</p>
        <p className="mt-2 text-sm font-bold leading-6 text-slate-600">
          Email us at{" "}
          <a className="text-ocean underline" href="mailto:support@roamlyhq.com">
            support@roamlyhq.com
          </a>{" "}
          and we&rsquo;ll help.
        </p>
      </div>
      <p className="mt-8 text-xs font-black uppercase tracking-[0.14em] text-slate-400">
        Thanks for your patience — we&rsquo;ll be back shortly
      </p>
    </main>
  );
}
