self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Roamly reminder";
  const options = {
    body: data.body || "Open Roamly to see what is next.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    data: {
      actionUrl: data.actionUrl || "/notifications"
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const actionUrl = event.notification.data?.actionUrl || "/notifications";
  event.waitUntil(clients.openWindow(actionUrl));
});
