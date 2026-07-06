export type AppRoute = {
  href: string;
  label: string;
  shortLabel?: string;
  phase?: string;
};

export const primaryRoutes: AppRoute[] = [
  { href: "/", label: "Home" },
  { href: "/plan", label: "Plan" },
  { href: "/dashboard", label: "Trips" },
  { href: "/account", label: "Account" }
];

export const allRoutes: AppRoute[] = [
  { href: "/", label: "Home", phase: "Phase 2 polish" },
  { href: "/plan", label: "Plan Trip", shortLabel: "Plan", phase: "Phase 5" },
  { href: "/preview", label: "Preview Trip", shortLabel: "Preview", phase: "Phase 7" },
  { href: "/dashboard", label: "Trip Detail", shortLabel: "Trip", phase: "Phase 9" },
  { href: "/notifications", label: "Live Trip Companion", shortLabel: "Live", phase: "Phase 10" },
  { href: "/dashboard", label: "Dashboard", shortLabel: "Trips", phase: "Phase 12" },
  { href: "/notifications", label: "Notifications", shortLabel: "Alerts", phase: "Tracking" },
  { href: "/login", label: "Login", phase: "Phase 3" },
  { href: "/signup", label: "Signup", phase: "Phase 3" },
  { href: "/account", label: "Account", phase: "Phase 3" },
  { href: "/pricing", label: "Pricing", phase: "Phase 8" },
  { href: "/terms", label: "Terms", phase: "Phase 15" },
  { href: "/privacy", label: "Privacy", phase: "Phase 15" },
  { href: "/contact", label: "Contact", phase: "Phase 15" },
  { href: "/admin", label: "Admin", phase: "Phase 13" }
];
