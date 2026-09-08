self.addEventListener("push", (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : {};
    data = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    data = {};
  }

  const title = data.title || "Roamly reminder";
  const activityTag = data.tripId && data.activityId
    ? `roamly-activity-${data.tripId}-${data.activityId}`
    : null;

  const actions = [];

  if (data.googleMapsUrl) {
    actions.push({ action: "google_maps", title: "Google Maps" });
  }

  if (data.appleMapsUrl) {
    actions.push({ action: "apple_maps", title: "Maps" });
  }

  if (data.citymapperUrl) {
    actions.push({ action: "citymapper", title: "Citymapper" });
  }

  // Browser notification platforms may limit how many actions are
  // displayed. Check-in and Skip remain supported even when the OS
  // chooses not to render every action button.
  if (data.checkInUrl) {
    actions.push({ action: "check_in", title: "Check in" });
  }

  if (data.skipUrl) {
    actions.push({ action: "skip", title: "Skip" });
  }

  const options = {
    body: data.body || "Open Roamly to see what is next.",
    icon: "/icon.svg",
    badge: "/icon.svg",
    tag: data.tag || activityTag || undefined,
    actions,
    requireInteraction: true,
    data: {
      tripId: data.tripId || null,
      activityId: data.activityId || null,
      eventId: data.eventId || null,
      eventType: data.eventType || null,
      actionUrl: data.actionUrl || "/notifications",
      googleMapsUrl: data.googleMapsUrl || null,
      appleMapsUrl: data.appleMapsUrl || null,
      citymapperUrl: data.citymapperUrl || null,
      checkInUrl: data.checkInUrl || null,
      skipUrl: data.skipUrl || null
    }
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("message", (event) => {
  const message = event.data || {};
  if (message.type !== "clear_activity_notification" || !message.tripId || !message.activityId) return;
  const tag = `roamly-activity-${message.tripId}-${message.activityId}`;
  event.waitUntil(
    self.registration.getNotifications({ tag }).then((notifications) => {
      notifications.forEach((notification) => notification.close());
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};

  let url = data.actionUrl || "/notifications";
  const openExternal = (target) => {
    event.waitUntil(clients.openWindow(target));
    event.notification.close();
  };

  if (event.action === "google_maps" && data.googleMapsUrl) {
    openExternal(data.googleMapsUrl);
    return;
  } else if (event.action === "apple_maps" && data.appleMapsUrl) {
    openExternal(data.appleMapsUrl);
    return;
  } else if (event.action === "citymapper" && data.citymapperUrl) {
    openExternal(data.citymapperUrl);
    return;
  } else if (event.action === "check_in" && data.checkInUrl) {
    url = data.checkInUrl;
  } else if (event.action === "skip" && data.skipUrl) {
    url = data.skipUrl;
  }

  event.notification.close();
  event.waitUntil((async () => {
    const destination = new URL(url, self.location.origin);
    if (destination.origin !== self.location.origin) {
      await clients.openWindow("/notifications");
      return;
    }
    const windows = await clients.matchAll({ type: "window", includeUncontrolled: true });
    const roamlyWindow = windows.find((client) => client.url.startsWith(self.location.origin));
    if (roamlyWindow) {
      await roamlyWindow.navigate(destination.href);
      await roamlyWindow.focus();
      return;
    }
    await clients.openWindow(destination.href);
  })());
});
