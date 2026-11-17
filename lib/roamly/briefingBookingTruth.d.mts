export declare function briefingBookingState(booking: Record<string, unknown>): "confirmed" | "traveler_confirmed" | "other";
export declare function briefingBookingNeedsAttention(booking: Record<string, unknown>): boolean;
export declare function briefingProvenanceSuffix(booking: Record<string, unknown>): string;
