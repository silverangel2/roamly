export type ShellNotificationSummary = {
  status?: string | null;
};

export function shouldLoadShellState(authenticated: boolean, pathname: string) {
  return authenticated && pathname !== "/notifications";
}

export function countUnreadNotifications(notifications: readonly ShellNotificationSummary[]) {
  return notifications.filter((notification) => notification.status !== "read").length;
}
