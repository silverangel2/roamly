export type BudgetBalance = {
  remainingAmount: number;
  status: "remaining" | "over";
  label: "Remaining budget" | "Over budget by";
  value: string;
  text: string;
};

function cleanCurrency(currency?: string | null) {
  return (currency || "CAD").trim().toUpperCase() || "CAD";
}

export function formatBudgetMoney(amount: number, currency = "CAD") {
  const rounded = Math.round(Math.abs(amount));
  return `${cleanCurrency(currency)} ${rounded.toLocaleString("en-CA")}`;
}

export function formatBudgetMoneyCents(cents: number | null | undefined, currency = "CAD") {
  if (typeof cents !== "number" || !Number.isFinite(cents)) return "Not set";
  return formatBudgetMoney(cents / 100, currency);
}

export function centsToAmount(cents: number | null | undefined) {
  return typeof cents === "number" && Number.isFinite(cents) ? Math.round(cents) / 100 : null;
}

export function calculateRemainingBudget(userBudget: number | null | undefined, totalEstimate: number | null | undefined) {
  if (typeof userBudget !== "number" || !Number.isFinite(userBudget)) return null;
  if (typeof totalEstimate !== "number" || !Number.isFinite(totalEstimate)) return null;
  return Math.round(userBudget - totalEstimate);
}

export function describeBudgetBalance(remainingAmount: number | null | undefined, currency = "CAD"): BudgetBalance | null {
  if (typeof remainingAmount !== "number" || !Number.isFinite(remainingAmount)) return null;
  const over = remainingAmount < 0;
  const label = over ? "Over budget by" : "Remaining budget";
  const value = formatBudgetMoney(Math.abs(remainingAmount), currency);
  return {
    remainingAmount,
    status: over ? "over" : "remaining",
    label,
    value,
    text: `${label}: ${value}`
  };
}

export function describeBudgetBalanceFromAmounts(
  userBudget: number | null | undefined,
  totalEstimate: number | null | undefined,
  currency = "CAD"
) {
  return describeBudgetBalance(calculateRemainingBudget(userBudget, totalEstimate), currency);
}

export function describeBudgetBalanceCents(remainingBudgetCents: number | null | undefined, currency = "CAD") {
  return describeBudgetBalance(centsToAmount(remainingBudgetCents), currency);
}

export function parseBudgetAmount(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const match = value.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!match) return null;
  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}
