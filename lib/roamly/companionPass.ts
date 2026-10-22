/*
 * Build 2 Live Companion — wallet pass generation (DESIGN-PRODUCTION
 * .md Phase 7: "wallet pass as a new page under the trip").
 *
 * The deliverable here is the PASS PAYLOAD + UPDATE MECHANICS, built
 * from the same WalletPassView the pass page renders:
 *  - Apple Wallet: a pass.json in the platform shape + the .pkpass
 *    bundle file set with a sha1 manifest over every file. The icon
 *    and logo are the app's verified Roamly icon (/icon-512.png —
 *    the same asset the Phase 6 gates carry, byte-identical to the
 *    owner's saved logo).
 *  - Google Wallet: the GenericObject descriptor for the same day.
 *  - Update mechanics: the serial is stable per (trip, day); the
 *    pass VERSION is a content hash of the day details — when the
 *    day changes, the version changes, which is exactly the signal
 *    the platform update flow keys on. webServiceURL /
 *    authenticationToken are emitted only when a pass web service
 *    is configured.
 *
 * SIGNING IS OWNER-GATED, and this module is honest about it: a
 * .pkpass must be signed with the owner's Pass Type ID certificate
 * (+ Apple WWDR), and a Google save link with the owner's service
 * account. No certificates exist in this workspace, so signing goes
 * through an INJECTED signer; with none injected (the production
 * default today), signing refuses with WALLET_SIGNER_UNAVAILABLE —
 * it never fabricates a signature. The on-screen day pass (the pass
 * page) works without any certificate.
 */

import { createHash } from "node:crypto";
import { contentId } from "./engine/ids";
import type { WalletPassView } from "./companionPanel";

export const WALLET_SIGNER_UNAVAILABLE = "WALLET_SIGNER_UNAVAILABLE";

export class WalletSignerUnavailableError extends Error {
  readonly code = WALLET_SIGNER_UNAVAILABLE;
  constructor(message = "No wallet signer is configured (owner certificate required).") {
    super(message);
    this.name = "WalletSignerUnavailableError";
  }
}

/** Injected at deployment time, once the owner provides the Pass
 *  Type ID certificate. signManifest receives the manifest.json
 *  bytes and returns a PKCS#7 detached signature. */
export interface WalletPassSigner {
  passTypeIdentifier: string;
  teamIdentifier: string;
  signManifest(manifest: Buffer): Promise<Buffer>;
}

/** Injected Google Wallet service-account signer (JWT). */
export interface GoogleWalletSigner {
  issuerId: string;
  signJwt(claims: Record<string, unknown>): Promise<string>;
}

/**
 * The production signer lookup. Returns null today: no Pass Type ID
 * certificate / service account exists in the deployment (owner
 * action, like the Phase 4 Places key). The reserved env names are
 * ROAMLY_WALLET_PASS_TYPE_ID + ROAMLY_WALLET_TEAM_ID +
 * ROAMLY_WALLET_CERT_PATH — all three present is necessary but NOT
 * sufficient; certificate loading lands with the owner's cert.
 */
export function getWalletPassSignerFromEnv(
  env: Record<string, string | undefined> = process.env
): WalletPassSigner | null {
  void env;
  return null;
}

export function passSerialFor(tripId: string, date: string): string {
  return contentId("pass", [tripId, date]);
}

/** Content version of the day the pass describes. Stable while the
 *  day is stable; changes the moment any pass detail changes. */
export function passVersionFor(view: WalletPassView, tripId: string): string {
  return contentId("passver", [
    tripId,
    view.date,
    view.headline,
    view.nextActivity?.id || "",
    view.nextActivity?.startLabel || "",
    view.nextActivity?.bookingRef || "",
    view.essentials.hotelName || "",
    view.essentials.flightLabel || "",
    view.essentials.flightBookingRef || ""
  ]);
}

/** Update mechanics: given the version a device already holds, say
 *  whether the pass content moved and what the current version is. */
export function describePassUpdate(
  view: WalletPassView,
  tripId: string,
  heldVersion: string | null
): { changed: boolean; version: string; serial: string } {
  const version = passVersionFor(view, tripId);
  return { changed: heldVersion !== version, version, serial: passSerialFor(tripId, view.date) };
}

/* ------------------------------------------------------------------ */
/* Apple Wallet payload                                                */
/* ------------------------------------------------------------------ */

export interface ApplePassField {
  key: string;
  label: string;
  value: string;
}

export interface ApplePassPayload {
  formatVersion: 1;
  passTypeIdentifier: string;
  serialNumber: string;
  teamIdentifier?: string;
  organizationName: "Roamly";
  description: string;
  logoText: "Roamly";
  foregroundColor: string;
  backgroundColor: string;
  labelColor: string;
  generic: {
    primaryFields: ApplePassField[];
    secondaryFields: ApplePassField[];
    auxiliaryFields: ApplePassField[];
    backFields: ApplePassField[];
  };
  barcodes: { format: "PKBarcodeFormatQR"; message: string; messageEncoding: "iso-8859-1" }[];
  relevantDate: string;
  webServiceURL?: string;
  authenticationToken?: string;
}

export function buildApplePassPayload(
  view: WalletPassView,
  opts: {
    tripId: string;
    liveUrl: string;
    dayStartInstant: string;
    passTypeIdentifier?: string;
    teamIdentifier?: string;
    webServiceURL?: string;
    authenticationToken?: string;
  }
): ApplePassPayload {
  const next = view.nextActivity;
  const payload: ApplePassPayload = {
    formatVersion: 1,
    // Placeholder identifier until the owner's Pass Type ID exists;
    // labeled as such — a payload carrying it is inspectable but not
    // installable, and signing refuses without the real signer.
    passTypeIdentifier: opts.passTypeIdentifier || "pass.com.roamlyhq.daypass.UNCONFIGURED",
    serialNumber: passSerialFor(opts.tripId, view.date),
    organizationName: "Roamly",
    description: `Roamly Day Pass — ${view.destination}, ${view.dateLabel}`,
    logoText: "Roamly",
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(11, 61, 43)",
    labelColor: "rgb(207, 227, 216)",
    generic: {
      primaryFields: [
        {
          key: "next",
          label: "Next up",
          value: next ? `${next.name} · ${next.startLabel}` : "Your day is all set"
        }
      ],
      secondaryFields: [
        { key: "destination", label: "Destination", value: view.destination },
        { key: "date", label: "Day", value: view.dateLabel }
      ],
      auxiliaryFields: [
        ...(view.travelerName
          ? [{ key: "traveler", label: "Traveler", value: view.travelerName }]
          : []),
        ...(view.essentials.hotelName
          ? [{ key: "hotel", label: "Staying at", value: view.essentials.hotelName }]
          : [])
      ],
      backFields: [
        ...(next?.bookingRef
          ? [{ key: "nextRef", label: `${next.name} — booking reference`, value: next.bookingRef }]
          : []),
        ...(view.essentials.flightLabel
          ? [
              {
                key: "flight",
                label: "Flight",
                value: view.essentials.flightBookingRef
                  ? `${view.essentials.flightLabel} · ${view.essentials.flightBookingRef}`
                  : view.essentials.flightLabel
              }
            ]
          : []),
        { key: "offline", label: "Offline", value: view.offline.rule },
        {
          key: "provenance",
          label: "About this pass",
          value:
            "Built from your reconciled Roamly itinerary. Booking facts carry their email provenance in the app."
        }
      ]
    },
    barcodes: [
      { format: "PKBarcodeFormatQR", message: opts.liveUrl, messageEncoding: "iso-8859-1" }
    ],
    relevantDate: opts.dayStartInstant
  };
  if (opts.teamIdentifier) payload.teamIdentifier = opts.teamIdentifier;
  if (opts.webServiceURL && opts.authenticationToken) {
    payload.webServiceURL = opts.webServiceURL;
    payload.authenticationToken = opts.authenticationToken;
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* .pkpass bundle (files + manifest) and signing                       */
/* ------------------------------------------------------------------ */

export interface PassBundleFile {
  name: string;
  content: Buffer;
  /** Where the bytes come from in the app (for asset files). */
  sourceAsset?: string;
}

export interface PassBundle {
  files: PassBundleFile[];
  manifest: Record<string, string>;
  version: string;
  serial: string;
}

export function buildPassBundle(
  view: WalletPassView,
  opts: {
    tripId: string;
    liveUrl: string;
    dayStartInstant: string;
    /** The verified Roamly icon bytes (public/icon-512.png). */
    iconPng: Buffer;
    passTypeIdentifier?: string;
    teamIdentifier?: string;
    webServiceURL?: string;
    authenticationToken?: string;
  }
): PassBundle {
  const payload = buildApplePassPayload(view, opts);
  const files: PassBundleFile[] = [
    { name: "pass.json", content: Buffer.from(JSON.stringify(payload, null, 2), "utf8") },
    { name: "icon.png", content: opts.iconPng, sourceAsset: "/icon-512.png" },
    { name: "logo.png", content: opts.iconPng, sourceAsset: "/icon-512.png" }
  ];
  const manifest: Record<string, string> = {};
  for (const file of files) {
    manifest[file.name] = createHash("sha1").update(file.content).digest("hex");
  }
  return {
    files,
    manifest,
    version: passVersionFor(view, opts.tripId),
    serial: payload.serialNumber
  };
}

export async function signPassBundle(
  bundle: PassBundle,
  signer: WalletPassSigner | null
): Promise<{ files: PassBundleFile[]; manifest: Record<string, string> }> {
  if (!signer) throw new WalletSignerUnavailableError();
  const manifestBytes = Buffer.from(JSON.stringify(bundle.manifest), "utf8");
  const signature = await signer.signManifest(manifestBytes);
  return {
    files: [...bundle.files, { name: "manifest.json", content: manifestBytes }, { name: "signature", content: signature }],
    manifest: bundle.manifest
  };
}

/* ------------------------------------------------------------------ */
/* Google Wallet descriptor                                            */
/* ------------------------------------------------------------------ */

export interface GoogleWalletObject {
  id: string;
  classId: string;
  genericType: "GENERIC_TYPE_UNSPECIFIED";
  state: "ACTIVE";
  cardTitle: { defaultValue: { language: "en"; value: string } };
  header: { defaultValue: { language: "en"; value: string } };
  subheader: { defaultValue: { language: "en"; value: string } };
  logo: { sourceUri: { uri: string } };
  textModulesData: { id: string; header: string; body: string }[];
  barcode: { type: "QR_CODE"; value: string };
}

export function buildGoogleWalletObject(
  view: WalletPassView,
  opts: { tripId: string; liveUrl: string; iconUrl: string; issuerId?: string; classSuffix?: string }
): GoogleWalletObject {
  const issuer = opts.issuerId || "UNCONFIGURED";
  const classSuffix = opts.classSuffix || "roamly_day_pass";
  const next = view.nextActivity;
  return {
    id: `${issuer}.${passSerialFor(opts.tripId, view.date)}`,
    classId: `${issuer}.${classSuffix}`,
    genericType: "GENERIC_TYPE_UNSPECIFIED",
    state: "ACTIVE",
    cardTitle: { defaultValue: { language: "en", value: "Roamly Day Pass" } },
    header: {
      defaultValue: {
        language: "en",
        value: next ? `${next.name} · ${next.startLabel}` : "Your day is all set"
      }
    },
    subheader: { defaultValue: { language: "en", value: `${view.destination} · ${view.dateLabel}` } },
    logo: { sourceUri: { uri: opts.iconUrl } },
    textModulesData: [
      ...(view.essentials.hotelName
        ? [{ id: "hotel", header: "Staying at", body: view.essentials.hotelName }]
        : []),
      { id: "offline", header: "Offline", body: view.offline.rule }
    ],
    barcode: { type: "QR_CODE", value: opts.liveUrl }
  };
}

export async function issueGoogleWalletSaveLink(
  object: GoogleWalletObject,
  signer: GoogleWalletSigner | null
): Promise<string> {
  if (!signer) {
    throw new WalletSignerUnavailableError(
      "No Google Wallet signer is configured (owner service account required)."
    );
  }
  const jwt = await signer.signJwt({
    iss: signer.issuerId,
    aud: "google",
    typ: "savetowallet",
    payload: { genericObjects: [object] }
  });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
