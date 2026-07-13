"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminLinks = [
  ["/admin", "Overview"],
  ["/admin/social", "Facebook Autopost"],
  ["/admin/social/library", "Content Library"],
  ["/admin/seo", "SEO Pages"],
  ["/admin/email", "Email Center"],
  ["/admin/affiliates", "Affiliates"],
  ["/admin/users", "Users"],
  ["/admin/trips", "Trips"],
  ["/admin/traffic", "Traffic"],
  ["/admin/notifications", "Notifications"],
  ["/admin/launch", "Launch Readiness"],
  ["/admin/settings", "Settings"]
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="rounded-2xl border border-cloud bg-white/90 p-3 shadow-soft lg:sticky lg:top-24">
      <details className="lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between rounded-xl bg-ink px-4 py-3 text-sm font-black text-white">
          Admin menu
          <span aria-hidden="true">v</span>
        </summary>
        <div className="mt-2 grid gap-2">
          {adminLinks.map(([href, label]) => {
            const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
            return (
              <Link
                key={href}
                href={href}
                className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                  active ? "bg-ocean text-white" : "text-slate-600 hover:bg-mist hover:text-ink"
                }`}
              >
                {label}
              </Link>
            );
          })}
        </div>
      </details>
      <div className="hidden gap-2 lg:grid">
        {adminLinks.map(([href, label]) => {
          const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
          return (
            <Link
              key={href}
              href={href}
              className={`rounded-xl px-4 py-3 text-sm font-black transition ${
                active ? "bg-ink text-white" : "text-slate-600 hover:bg-mist hover:text-ink"
              }`}
            >
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
