/**
 * Minimal local shim for `@storehausai/shared`.
 *
 * The vendored storehaus `calculate-row` imports `formatMoney` from the shared
 * package, which pebble does not depend on. Only the calculate row (an opt-in
 * aggregation footer, unused by the influencer table) calls this. Mapped via
 * the `@storehausai/shared` tsconfig path alias.
 */

export function formatMoney(amount: number, currency = "USD"): string {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(amount);
  } catch {
    return amount.toLocaleString();
  }
}
