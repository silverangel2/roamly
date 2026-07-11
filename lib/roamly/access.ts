type NullableEmail = string | null | undefined;

export type RoamlyAccessRole = "admin" | "tester" | "user";

export type RoamlyAccess = {
  email: string;
  role: RoamlyAccessRole;
  isAdmin: boolean;
  isTester: boolean;
  hasQaAccess: boolean;
  testerEmailsConfigured: boolean;
};

type RoamlyEntitlements = {
  freeItineraryAvailable?: boolean | null;
  freeItineraryUsed?: boolean | null;
  itineraryPaymentStatus?: string | null;
  itineraryUnlockSource?: string | null;
  trackingUnlocked?: boolean | null;
  liveCompanionUnlocked?: boolean | null;
  completePackUnlocked?: boolean | null;
};

function normalizeEmail(email: NullableEmail) {
  return (email || "").trim().toLowerCase();
}

function readEmailList(value: string | undefined) {
  return (value || "")
    .split(",")
    .map(normalizeEmail)
    .filter(Boolean);
}

export function getRoamlyAdminEmails() {
  return readEmailList(process.env.ROAMLY_ADMIN_EMAILS);
}

export function getRoamlyTesterEmails() {
  return readEmailList(process.env.ROAMLY_TESTER_EMAILS);
}

export function isRoamlyAdmin(userEmail: NullableEmail) {
  const email = normalizeEmail(userEmail);
  return Boolean(email && getRoamlyAdminEmails().includes(email));
}

export function isRoamlyTester(userEmail: NullableEmail) {
  const email = normalizeEmail(userEmail);
  if (!email) return false;
  return isRoamlyAdmin(email) || getRoamlyTesterEmails().includes(email);
}

export function getRoamlyAccessForUser(userEmail: NullableEmail): RoamlyAccess {
  const email = normalizeEmail(userEmail);
  const isAdmin = isRoamlyAdmin(email);
  const testerEmailsConfigured = getRoamlyTesterEmails().length > 0;
  const isTester = Boolean(email && (isAdmin || getRoamlyTesterEmails().includes(email)));
  const role: RoamlyAccessRole = isAdmin ? "admin" : isTester ? "tester" : "user";

  return {
    email,
    role,
    isAdmin,
    isTester,
    hasQaAccess: isAdmin || isTester,
    testerEmailsConfigured
  };
}

export function canUsePaidItinerary(userEmail: NullableEmail, entitlements: RoamlyEntitlements = {}) {
  if (isRoamlyTester(userEmail)) return true;
  if (entitlements.completePackUnlocked) return true;
  if (entitlements.freeItineraryAvailable || entitlements.freeItineraryUsed === false) return true;
  return (
    entitlements.itineraryPaymentStatus === "paid" ||
    entitlements.itineraryPaymentStatus === "bundled" ||
    entitlements.itineraryUnlockSource === "paid" ||
    entitlements.itineraryUnlockSource === "bundle" ||
    entitlements.itineraryUnlockSource === "admin"
  );
}

export function canUseLiveCompanion(userEmail: NullableEmail, entitlements: RoamlyEntitlements = {}) {
  if (isRoamlyTester(userEmail)) return true;
  if (entitlements.completePackUnlocked) return true;
  return Boolean(
    entitlements.trackingUnlocked ||
      entitlements.liveCompanionUnlocked ||
      entitlements.itineraryUnlockSource === "bundle" ||
      entitlements.itineraryUnlockSource === "admin"
  );
}
