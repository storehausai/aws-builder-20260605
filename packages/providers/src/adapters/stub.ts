import type {
  CommerceSignalProvider,
  NormalizedCommerce,
  ProductRef,
  RawFetch,
} from "@pebble/core";

/**
 * Reference adapter — proves the port shape compiles end to end. Real vendors
 * (keepa, apify.apidojo, modash, …) are sibling files implementing the same
 * ports and registered by capability. NOT a working data source.
 */
export const stubCommerceProvider: CommerceSignalProvider = {
  id: "stub.commerce",
  capabilities: ["commerce.timeseries"],

  getProductHistory(ref: ProductRef): Promise<RawFetch> {
    throw new Error(`stub.commerce: getProductHistory not implemented (${ref.externalId})`);
  },

  normalizeProductHistory(_raw: RawFetch): NormalizedCommerce {
    return { products: [], points: [] };
  },
};
