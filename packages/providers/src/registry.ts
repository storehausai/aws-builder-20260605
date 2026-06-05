import type { Capability, DataProvider } from "@pebble/core";

/**
 * Capability → provider resolution. Code asks for a CAPABILITY, never a vendor.
 * Skeleton: first-registered wins. Fallback chains + cost/rate-aware selection
 * are added here later without touching callers.
 */
export class ProviderRegistry {
  private readonly byCapability = new Map<Capability, DataProvider[]>();

  register(provider: DataProvider): this {
    for (const capability of provider.capabilities) {
      const list = this.byCapability.get(capability) ?? [];
      list.push(provider);
      this.byCapability.set(capability, list);
    }
    return this;
  }

  resolve<T extends DataProvider = DataProvider>(capability: Capability): T {
    const list = this.byCapability.get(capability);
    if (!list || list.length === 0) {
      throw new Error(`No provider registered for capability: ${capability}`);
    }
    return list[0] as T;
  }

  all(capability: Capability): readonly DataProvider[] {
    return this.byCapability.get(capability) ?? [];
  }
}
