"use client";

import { useEffect } from "react";

// Bug 11: a client-side navigation to /#the-journey (e.g. the "How it
// works" nav link from Deals) landed at the top of home — the home
// page is a server component with no hash-scroll handling, and the
// only scrollToHash in the codebase lives on trip pages. This tiny
// component scrolls to the element named by location.hash on mount
// (via requestAnimationFrame, so layout has settled) and on every
// hashchange (clicking the link while already on home). Instant
// scroll, the same as the browser's own anchor jump. If the target
// does not exist, it does nothing.
export function HomeHashScroll() {
  useEffect(() => {
    function scrollToHash() {
      const hash = window.location.hash;
      if (!hash) return;
      const id = decodeURIComponent(hash.slice(1));
      if (!id) return;
      const target = document.getElementById(id);
      if (target) target.scrollIntoView();
    }
    const frame = requestAnimationFrame(scrollToHash);
    window.addEventListener("hashchange", scrollToHash);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("hashchange", scrollToHash);
    };
  }, []);

  return null;
}
