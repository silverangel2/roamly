self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }

  const title = data.title || "Roamly reminder";

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
    actions,
    requireInteraction: true,
    data: {
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

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};

  let url = data.actionUrl || "/notifications";

  if (event.action === "google_maps" && data.googleMapsUrl) {
    url = data.googleMapsUrl;
  } else if (event.action === "apple_maps" && data.appleMapsUrl) {
    url = data.appleMapsUrl;
  } else if (event.action === "citymapper" && data.citymapperUrl) {
    url = data.citymapperUrl;
  } else if (event.action === "check_in" && data.checkInUrl) {
    url = data.checkInUrl;
  } else if (event.action === "skip" && data.skipUrl) {
    url = data.skipUrl;
  }

  event.notification.close();
  event.waitUntil(clients.openWindow(url));
});
