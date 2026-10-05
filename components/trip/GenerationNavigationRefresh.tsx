"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/** Refetch server generation state after navigation. Does not invent progress. */
export function GenerationNavigationRefresh({ active }: { active: boolean }) {
  const router = useRouter();
  const attempts = useRef(0);

  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      attempts.current += 1;
      router.refresh();
      if (attempts.current >= 6) window.clearInterval(timer);
    }, 2000);
    return () => window.clearInterval(timer);
  }, [active, router]);

  return null;
}
