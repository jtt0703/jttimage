import { describe, expect, it, vi } from "vitest";
import {
  BillingAccessError,
  buildBillingReturnUrl,
  buildSubscriptionCreateVariables,
  isBillingStateFresh,
  requireBillingAccess,
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
  type RequireBillingAccessPrisma = Parameters<typeof requireBillingAccess>[0]["prisma"];

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

  it("selects active Shopify subscriptions even when review marks them as test charges", () => {
    const subscription = selectActiveSubscription(
      [{ id: "gid://shopify/AppSubscription/2", name: "Starter", status: "ACTIVE", test: true, trialDays: 14 }],
      plan,
    );

    expect(subscription?.id).toBe("gid://shopify/AppSubscription/2");
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

  it("builds return URL from SHOPIFY_APP_URL with embedded app context", () => {
    vi.stubEnv("SHOPIFY_APP_URL", "https://search.pagelumo.com");

    const request = new Request(
      "https://ignored.example/app/billing?embedded=1&host=encoded-host&shop=demo.myshopify.com&id_token=token",
    );

    expect(buildBillingReturnUrl(request, "demo.myshopify.com")).toBe(
      "https://search.pagelumo.com/app/billing/return?shop=demo.myshopify.com&host=encoded-host&embedded=1",
    );

    vi.unstubAllEnvs();
  });

  it("has a public 402 error shape", () => {
    const error = new BillingAccessError();

    expect(error.toResponseBody()).toEqual({
      error: "Lens Search billing is not active for this store.",
      code: "billing_required",
      reason: "billing_inactive",
      plan: "Starter",
    });
  });

  it("allows storefront access for a known active subscription after the short entitlement cache expires", async () => {
    const state = {
      id: "state-1",
      shopDomain: "demo.myshopify.com",
      planName: "Starter",
      trialUsed: true,
      trialStartedAt: null,
      trialEndedAt: null,
      activeSubscriptionId: "gid://shopify/AppSubscription/1",
      subscriptionStatus: "active",
      subscriptionTest: true,
      subscriptionCreatedAt: new Date("2026-06-11T00:00:00Z"),
      currentPeriodEnd: new Date("2026-07-11T00:00:00Z"),
      lastCheckedAt: new Date("2026-06-11T00:00:00Z"),
      createdAt: new Date("2026-06-11T00:00:00Z"),
      updatedAt: new Date("2026-06-11T00:00:00Z"),
    };
    const prisma = {
      shopBillingState: {
        findUnique: vi.fn().mockResolvedValue(state),
      },
    } as unknown as RequireBillingAccessPrisma;

    await expect(
      requireBillingAccess({
        prisma,
        shopDomain: "demo.myshopify.com",
        plan,
        now: new Date("2026-06-11T00:10:01Z"),
      }),
    ).resolves.toBe(state);
  });

  it("keeps storefront access blocked for stale inactive billing state", async () => {
    const prisma = {
      shopBillingState: {
        findUnique: vi.fn().mockResolvedValue({
          id: "state-1",
          shopDomain: "demo.myshopify.com",
          planName: "Starter",
          trialUsed: false,
          trialStartedAt: null,
          trialEndedAt: null,
          activeSubscriptionId: null,
          subscriptionStatus: "inactive",
          subscriptionTest: null,
          subscriptionCreatedAt: null,
          currentPeriodEnd: null,
          lastCheckedAt: new Date("2026-06-11T00:00:00Z"),
          createdAt: new Date("2026-06-11T00:00:00Z"),
          updatedAt: new Date("2026-06-11T00:00:00Z"),
        }),
      },
    } as unknown as RequireBillingAccessPrisma;

    await expect(
      requireBillingAccess({
        prisma,
        shopDomain: "demo.myshopify.com",
        plan,
        now: new Date("2026-06-11T00:10:01Z"),
      }),
    ).rejects.toBeInstanceOf(BillingAccessError);
  });
});
