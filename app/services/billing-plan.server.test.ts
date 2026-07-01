import { afterEach, describe, expect, it, vi } from "vitest";
import { getBillingPlanConfig, resolveShopifyBillingTestMode } from "./billing-plan.server";

describe("billing plan config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Starter launch defaults", () => {
    const config = getBillingPlanConfig({});

    expect(config).toEqual({
      planName: "Starter",
      monthlyPrice: 7.99,
      currencyCode: "USD",
      trialDays: 14,
      entitlementCacheSeconds: 300,
      isTest: true,
    });
  });

  it("reads production test mode from SHOPIFY_BILLING_TEST=false", () => {
    vi.stubEnv("SHOPIFY_BILLING_TEST", "false");

    expect(resolveShopifyBillingTestMode(process.env)).toBe(false);
  });
});
