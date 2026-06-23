import { describe, expect, it, vi } from "vitest";
import {
  BillingAccessError,
  buildBillingReturnUrl,
  buildSubscriptionCreateVariables,
  isBillingStateFresh,
  selectActiveSubscription,
  subscriptionDataFromShopify,
} from "./billing.server";

const plan = {
  planName: "Starter",
  monthlyPrice: 7.99,
  currencyCode: "USD",
  trialDays: 14,
  entitlementCacheSeconds: 300,
  isTest: true,
};

describe("billing service", () => {
  it("selects the configured active test subscription", () => {
    const subscription = selectActiveSubscription(
      [
        { id: "gid://shopify/AppSubscription/1", name: "Other", status: "ACTIVE", test: true, trialDays: 14 },
        { id: "gid://shopify/AppSubscription/2", name: "Starter", status: "ACTIVE", test: true, trialDays: 14 },
      ],
      plan,
    );

    expect(subscription?.id).toBe("gid://shopify/AppSubscription/2");
  });

  it("does not select test subscriptions in live mode", () => {
    const subscription = selectActiveSubscription(
      [{ id: "gid://shopify/AppSubscription/2", name: "Starter", status: "ACTIVE", test: true, trialDays: 14 }],
      { ...plan, isTest: false },
    );

    expect(subscription).toBeNull();
  });

  it("marks trial used only for active subscription with trialDays greater than zero", () => {
    const data = subscriptionDataFromShopify({
      shopDomain: "demo.myshopify.com",
      planName: "Starter",
      previousTrialUsed: false,
      subscription: {
        id: "sub-1",
        name: "Starter",
        status: "ACTIVE",
        test: true,
        trialDays: 14,
        createdAt: "2026-06-11T00:00:00Z",
        currentPeriodEnd: "2026-07-11T00:00:00Z",
      },
      now: new Date("2026-06-11T00:10:00Z"),
    });

    expect(data.trialUsed).toBe(true);
    expect(data.subscriptionStatus).toBe("active");
    expect(data.activeSubscriptionId).toBe("sub-1");
  });

  it("clears active subscription without clearing trial history", () => {
    const data = subscriptionDataFromShopify({
      shopDomain: "demo.myshopify.com",
      planName: "Starter",
      previousTrialUsed: true,
      subscription: null,
      now: new Date("2026-06-11T00:10:00Z"),
    });

    expect(data.trialUsed).toBe(true);
    expect(data.subscriptionStatus).toBe("inactive");
    expect(data.activeSubscriptionId).toBeNull();
  });

  it("omits trialDays once trial was used", () => {
    const variables = buildSubscriptionCreateVariables({
      plan,
      returnUrl: "https://search.pagelumo.com/app/billing/return",
      trialUsed: true,
    });

    expect(variables.trialDays).toBeUndefined();
  });

  it("includes trialDays before trial was used", () => {
    const variables = buildSubscriptionCreateVariables({
      plan,
      returnUrl: "https://search.pagelumo.com/app/billing/return",
      trialUsed: false,
    });

    expect(variables.trialDays).toBe(14);
  });

  it("detects fresh local billing state", () => {
    expect(
      isBillingStateFresh({
        lastCheckedAt: new Date("2026-06-11T00:00:00Z"),
        now: new Date("2026-06-11T00:04:59Z"),
        cacheSeconds: 300,
      }),
    ).toBe(true);
  });

  it("builds return URL from SHOPIFY_APP_URL", () => {
    vi.stubEnv("SHOPIFY_APP_URL", "https://search.pagelumo.com");

    expect(buildBillingReturnUrl(new Request("https://ignored.example/app/billing"))).toBe(
      "https://search.pagelumo.com/app/billing/return",
    );

    vi.unstubAllEnvs();
  });

  it("has a public 402 error shape", () => {
    const error = new BillingAccessError();

    expect(error.toResponseBody()).toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
  });
});
