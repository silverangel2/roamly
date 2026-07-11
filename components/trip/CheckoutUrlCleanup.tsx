"use client";

import { useEffect } from "react";

export function CheckoutUrlCleanup() {
  useEffect(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("checkout") && !url.searchParams.has("session_id")) return;

    url.searchParams.delete("checkout");
    url.searchParams.delete("session_id");
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  return null;
}
