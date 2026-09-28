"use client";

import { useLayoutEffect } from "react";

const NOTIFICATION_SHELL_STATE_EVENT = "roamly:notifications-shell-state";

export function NotificationShellStateBridge({
  activeTripId,
  unreadCount
}: {
  activeTripId: string;
  unreadCount: number;
}) {
  useLayoutEffect(() => {
    window.dispatchEvent(
      new CustomEvent(NOTIFICATION_SHELL_STATE_EVENT, {
        detail: { activeTripId, unreadCount }
      })
    );
  }, [activeTripId, unreadCount]);

  return null;
}
