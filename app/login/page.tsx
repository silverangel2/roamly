import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { AuthForm } from "@/components/auth/AuthForm";
import { BuiBadge } from "@/components/boardui/Badge";
import { BuiCard } from "@/components/boardui/Card";
import { getCurrentUser } from "@/lib/supabase/server";
import { safeAuthNextPath } from "@/lib/navigation";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

const AUTH_NEXT_COOKIE = "roamly_auth_next";

function readCookieNext(value?: string) {
  if (!value) return undefined;
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function pathnameFromPath(path: string) {
  return path.split(/[?#]/, 1)[0];
}

function selectAuthNextPath(queryNext: string | string[] | undefined, cookieNext: string | undefined) {
  const nextPath = safeAuthNextPath(queryNext);
  const pendingPlannerNext = safeAuthNextPath(cookieNext, "");

  if (pathnameFromPath(pendingPlannerNext) === "/plan") {
    const nextPathname = pathnameFromPath(nextPath);
    if (nextPathname === "/plan" || nextPathname === "/dashboard") return pendingPlannerNext;
  }

  return nextPath;
}

export const metadata: Metadata = {
  title: "Log In to Roamly",
  description: "Log in to Roamly to access your saved trips, day-by-day itineraries, and Live Trip Companion.",
  openGraph: {
    title: "Log in to Roamly",
    description: "Log in to access your saved trips, itineraries, and Live Trip Companion.",
    url: "https://roamlyhq.com/login",
    type: "website",
    images: [{ url: "https://roamlyhq.com/opengraph-image", width: 1200, height: 630, alt: "Roamly — AI travel planner" }]
  }
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = searchParams ? await searchParams : {};
  const cookieStore = await cookies();
  const cookieNext = readCookieNext(cookieStore.get(AUTH_NEXT_COOKIE)?.value);
  const nextPath = selectAuthNextPath(params.next, cookieNext);
  const authError = typeof params.error === "string" ? params.error : "";
  const current = await getCurrentUser();
  const authErrorMessage = authError
    ? authError === "supabase_not_configured"
      ? "Supabase is not configured yet."
      : authError === "session_expired"
        ? "Your session expired. Please log in again to continue."
      : "We could not sign you in. Please try again."
    : "";

  if (current.configured && current.user) {
    redirect(nextPath);
  }

  return (
    <div className="bg-cbg">
      <div className="bui-safe-bottom mx-auto grid min-h-[calc(100dvh-7rem)] min-w-0 w-full max-w-6xl gap-6 px-4 py-8 sm:px-6 lg:grid-cols-[0.95fr_1fr] lg:items-center">
        {/* Apply-All Sweep (2026-11-03): the auth hero takes the
            Round 1 pricing panel — soft white→blue→warm wash, 2rem
            radius, hero shadow — instead of floating on the legacy
            cream page ground; the page itself now paints the token
            ground (bg-cbg, the Finds precedent). */}
        <section className="bui-enter min-w-0 overflow-hidden rounded-[2rem] border border-white bg-[linear-gradient(135deg,#ffffff,#E6EFFA_52%,#FFF0E6)] p-6 shadow-bui-hero sm:p-10">
          <BuiBadge tone="primary">Welcome back</BuiBadge>
          <h1 className="mt-5 max-w-2xl text-4xl font-black leading-tight tracking-tight text-chead sm:text-6xl">
            Log in and keep your trips together.
          </h1>
          <p className="mt-4 max-w-xl text-base font-semibold leading-7 text-cink">
            Sign in to keep your trips, plans, and travel details together.
          </p>
          <ul className="mt-6 grid gap-2">
            {["Saved trips", "1 free itinerary", "One-time trip packs"].map((item) => (
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
          <h2 className="mt-2 text-2xl font-black text-chead">Log in</h2>
          <div className="mt-5">
            <AuthForm mode="login" nextPath={nextPath} initialError={authErrorMessage} />
          </div>
        </BuiCard>
      </div>
    </div>
  );
}
