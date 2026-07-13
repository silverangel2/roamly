"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const adminLinks = [
  ["/admin", "Overview"],
  ["/admin/traffic", "Traffic"],
  ["/admin/trips", "Trips"],
  ["/admin/activities", "Activities"],
  ["/admin/live-test", "Live Test"],
  ["/admin/notifications", "Notifications"],
  ["/admin/social", "Social"],
  ["/admin/users", "Users"],
  ["/admin/settings", "Settings"],
  ["/admin/system", "System"],
  ["/admin/launch", "Launch"]
];

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="grid gap-2 rounded-[1.5rem] border border-cloud bg-white/90 p-3 shadow-soft lg:sticky lg:top-24">
      {adminLinks.map(([href, label]) => {
        const active = pathname === href || (href !== "/admin" && pathname.startsWith(`${href}/`));
        return (
          <Link
            key={href}
            href={href}
            className={`rounded-2xl px-4 py-3 text-sm font-black transition ${
              active ? "bg-ink text-white" : "text-slate-600 hover:bg-mist hover:text-ink"
            }`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
