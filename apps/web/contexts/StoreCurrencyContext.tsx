"use client";

/**
 * Minimal local shim for storehaus's StoreCurrencyContext.
 *
 * The vendored `calculate-row` reads the active store currency to format
 * currency-typed aggregations. pebble has no multi-currency store concept, so
 * this resolves to a single default. Imported by calculate-row via
 * `@/contexts/StoreCurrencyContext`.
 */

export function useStoreCurrency(): string {
  return "USD";
}
