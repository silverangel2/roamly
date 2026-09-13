// Server-only factual continuity for a future Booking.com preview request.
export type BookingPreviewAllocation = {
  numberOfAdults: number;
  children: number[];
};

export type BookingPreviewRequestBinding = {
  checkIn: string;
  checkOut: string;
  rooms: number;
  travelers: number;
  children: number;
  childAges: number[];
  currency: string;
  bookerCountry: string;
};

export type BookingPreviewProductIdentity = {
  provider: "booking_demand";
  providerPropertyId: string;
  providerProductId: string;
  allocation: BookingPreviewAllocation | null;
  roomId: string | null;
  rateId: string | null;
  requestBinding: BookingPreviewRequestBinding;
  providerRetrievedAt: string;
  state: "COMPLETE" | "INCOMPLETE" | "INVALID";
};

export type BookingPreviewIdentityEvaluation =
  | { status: "COMPLETE_FOR_PREVIEW_REQUEST"; identity: BookingPreviewProductIdentity }
  | { status: "INCOMPLETE_FOR_PREVIEW_REQUEST"; identity: BookingPreviewProductIdentity }
  | { status: "INVALID"; identity: BookingPreviewProductIdentity | null };

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : "";
}

function positiveInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) > 0;
}

function nonNegativeInteger(value: unknown) {
  return Number.isInteger(value) && (value as number) >= 0;
}

function validDate(value: unknown) {
  return text(value) && Number.isFinite(Date.parse(text(value)));
}

function validBinding(value: unknown): value is BookingPreviewRequestBinding {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(validDate(row.checkIn) && validDate(row.checkOut) && Date.parse(text(row.checkOut)) > Date.parse(text(row.checkIn)) &&
    positiveInteger(row.rooms) && positiveInteger(row.travelers) && nonNegativeInteger(row.children) &&
    Array.isArray(row.childAges) && row.childAges.every((age) => nonNegativeInteger(age) && (age as number) <= 17) &&
    (row.children === row.childAges.length) && text(row.currency).toUpperCase() === row.currency && text(row.bookerCountry).toLowerCase() === row.bookerCountry);
}

function validAllocation(value: unknown): value is BookingPreviewAllocation {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return positiveInteger(row.numberOfAdults) && Array.isArray(row.children) && row.children.every((age) => nonNegativeInteger(age) && (age as number) <= 17);
}

function validIdentity(value: unknown): value is BookingPreviewProductIdentity {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return Boolean(row.provider === "booking_demand" && text(row.providerPropertyId) === row.providerPropertyId && text(row.providerProductId) === row.providerProductId &&
    (row.roomId === null || typeof row.roomId === "string") && (row.rateId === null || typeof row.rateId === "string") &&
    validBinding(row.requestBinding) && validDate(row.providerRetrievedAt));
}

export function evaluateBookingPreviewIdentity(identity: unknown): BookingPreviewIdentityEvaluation {
  if (!validIdentity(identity)) return { status: "INVALID", identity: null };
  const typed = identity as BookingPreviewProductIdentity;
  if (!typed.allocation) return { status: "INCOMPLETE_FOR_PREVIEW_REQUEST", identity: { ...typed, state: "INCOMPLETE" } };
  if (!validAllocation(typed.allocation)) return { status: "INVALID", identity: { ...typed, state: "INVALID" } };
  if (typed.allocation.children.length > typed.requestBinding.children) return { status: "INVALID", identity: { ...typed, state: "INVALID" } };
  return { status: "COMPLETE_FOR_PREVIEW_REQUEST", identity: { ...typed, state: "COMPLETE" } };
}

export function buildBookingPreviewProductIdentity(input: {
  providerPropertyId: unknown;
  product: unknown;
  requestBinding: BookingPreviewRequestBinding;
  providerRetrievedAt: unknown;
}): BookingPreviewProductIdentity {
  const product = input.product && typeof input.product === "object" && !Array.isArray(input.product) ? input.product as Record<string, unknown> : {};
  const providerPropertyId = text(input.providerPropertyId);
  const providerProductId = text(product.id);
  const providerRetrievedAt = text(input.providerRetrievedAt);
  const roomId = typeof product.room === "string" && product.room.trim() ? product.room.trim() : null;
  const rawAllocation = product.allocation && typeof product.allocation === "object" ? product.allocation as Record<string, unknown> : null;
  const adultValue = rawAllocation?.number_of_adults ?? product.number_of_adults;
  const childrenValue = rawAllocation?.children ?? product.children;
  const allocationProvided = rawAllocation !== null || Object.hasOwn(product, "number_of_adults") || Object.hasOwn(product, "children");
  const allocation = !allocationProvided
    ? null
    : positiveInteger(adultValue) && Array.isArray(childrenValue) && childrenValue.every((age) => nonNegativeInteger(age) && (age as number) <= 17)
      ? { numberOfAdults: adultValue as number, children: [...childrenValue as number[]] }
      : null;
  const state = !providerPropertyId || !providerProductId || !validBinding(input.requestBinding) || !validDate(providerRetrievedAt)
    ? "INVALID" as const
    : allocationProvided
      ? (allocation ? "COMPLETE" as const : "INVALID" as const)
      : "INCOMPLETE" as const;
  return { provider: "booking_demand", providerPropertyId, providerProductId, allocation, roomId, rateId: null, requestBinding: input.requestBinding, providerRetrievedAt, state };
}

export function previewIdentityEquivalent(a: unknown, b: unknown) {
  const left = evaluateBookingPreviewIdentity(a);
  const right = evaluateBookingPreviewIdentity(b);
  return left.status === right.status && JSON.stringify(left.identity) === JSON.stringify(right.identity);
}

export function bookingPreviewIdentityMatchesRequest(identity: unknown, requestBinding: unknown) {
  const evaluated = evaluateBookingPreviewIdentity(identity);
  if (evaluated.status !== "COMPLETE_FOR_PREVIEW_REQUEST" || !validBinding(requestBinding)) return false;
  const left = evaluated.identity.requestBinding;
  const right = requestBinding;
  return left.checkIn === right.checkIn && left.checkOut === right.checkOut && left.rooms === right.rooms &&
    left.travelers === right.travelers && left.children === right.children &&
    JSON.stringify(left.childAges) === JSON.stringify(right.childAges) && left.currency === right.currency &&
    left.bookerCountry === right.bookerCountry;
}
