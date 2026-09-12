export function refreshedHotelTruthChanged(input: {
  oldPrice: number | null;
  newPrice: number | null;
  oldCurrency: string;
  newCurrency: string;
  oldTaxesFees?: unknown;
  newTaxesFees?: unknown;
  oldTaxesIncluded?: unknown;
  newTaxesIncluded?: unknown;
  oldFeesIncluded?: unknown;
  newFeesIncluded?: unknown;
}) {
  const oldCurrency = input.oldCurrency.trim().toUpperCase();
  const newCurrency = input.newCurrency.trim().toUpperCase();
  const comparable = input.oldPrice !== null && input.newPrice !== null && Boolean(oldCurrency) && oldCurrency === newCurrency;
  const serialized = (value: unknown) => {
    try {
      return JSON.stringify(value ?? null);
    } catch {
      return "null";
    }
  };
  const chargesChanged = serialized(input.oldTaxesFees) !== serialized(input.newTaxesFees) ||
    serialized(input.oldTaxesIncluded) !== serialized(input.newTaxesIncluded) ||
    serialized(input.oldFeesIncluded) !== serialized(input.newFeesIncluded);
  return !comparable || input.oldPrice !== input.newPrice || chargesChanged;
}
