"use client";

import { useEffect } from "react";

/**
 * AccountSetupHashRedirect — Picture 8 companion to /account.
 *
 * Trip and live screens link to /account#setup and /account#setup-step-N,
 * but the picture's default account screen renders no setup section (it
 * lives behind ?view=setup instead). A server page cannot see the URL
 * hash, so this client shim maps those legacy hashes to the setup detail
 * view with the step anchor preserved, e.g. /account?view=setup#setup-step-2.
 * Any other hash is left alone. It renders nothing.
 */
export function AccountSetupHashRedirect() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    const hash = window.location.hash;
    if (!/^#setup(-step-[123])?$/.test(hash)) return;
    window.location.replace(`/account?view=setup${hash}`);
  }, []);
  return null;
}
