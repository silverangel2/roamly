export type PurchaseActivationContentInput = {
  destination: string;
  startDate?: string | null;
  endDate?: string | null;
  features: string[];
  liveCompanion: "Included and activated" | "Not included";
  gmailStatus: "Connected" | "Not connected" | null;
  tripId: string;
  appUrl?: string | null;
};

export function purchaseActivationLogicalKey(userId: string, tripId: string, checkoutSessionId: string) {
  return `${userId.trim() || "unknown-user"}:${tripId.trim() || "account"}:purchase_confirmation:${checkoutSessionId.trim() || "default"}`.slice(0, 512);
}

export function buildPurchaseActivationEmailModel(input: PurchaseActivationContentInput) {
  const destination = input.destination.trim() || "your trip";
  const summaryItems = [
    { label: "Destination", value: destination },
    { label: "Travel dates", value: input.startDate && input.endDate ? `${input.startDate} – ${input.endDate}` : null },
    { label: "Roamly features", value: input.features.join(", ") },
    { label: "Live Companion", value: input.liveCompanion },
    ...(input.gmailStatus ? [{ label: "Booking email connection", value: input.gmailStatus }] : [])
  ];
  const message = [
    "Your Roamly trip is activated.",
    "Your purchased trip features are now available, and your trip is ready for the next steps.",
    "Roamly will organize the travel details you provide and help keep your plan clear as your trip approaches.",
    ...(input.gmailStatus === "Not connected"
      ? ["When you are ready, connect your booking email from your trip so Roamly can organize confirmed travel details."]
      : [])
  ].join("\n\n");

  return {
    subject: "Your Roamly trip is activated",
    preheader: `Your ${destination} trip is ready in Roamly.`,
    eyebrow: "Trip activated",
    title: "Your Roamly trip is activated",
    intro: message,
    bodyText: "Open your trip any time to review what is ready and add confirmed travel details.",
    summaryItems,
    ctaLabel: "View my trip",
    tripPath: `/trip/${encodeURIComponent(input.tripId)}`,
    appUrl: input.appUrl || null
  };
}
