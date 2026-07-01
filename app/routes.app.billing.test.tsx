import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  shopifyRedirect: vi.fn(),
  refreshBillingStatus: vi.fn(),
  createSubscription: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./db.server", () => ({ default: { shopBillingState: {} } }));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    refreshBillingStatus: mocks.refreshBillingStatus,
    createSubscription: mocks.createSubscription,
  };
});

function args(request: Request): ActionFunctionArgs & LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    url,
    pattern: url.pathname,
    params: {},
    context: {},
  };
}

describe("billing page route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "demo.myshopify.com" },
      admin: {},
      redirect: mocks.shopifyRedirect,
    });
    mocks.shopifyRedirect.mockImplementation(
      (url: string) => new Response(null, { status: 302, headers: { Location: url } }),
    );
    mocks.refreshBillingStatus.mockResolvedValue({
      entitled: false,
      state: {
        shopDomain: "demo.myshopify.com",
        trialUsed: false,
        subscriptionStatus: "inactive",
        activeSubscriptionId: null,
        currentPeriodEnd: null,
      },
      subscription: null,
    });
  });

  it("loads billing page without active subscription", async () => {
    const { loader } = await import("./routes/app.billing");
    const result = await loader(args(new Request("https://search.pagelumo.com/app/billing")));

    expect(result.billing.entitled).toBe(false);
    expect(result.billing.trialUsed).toBe(false);
  });

  it("uses Shopify embedded redirect helper when starting subscription", async () => {
    const { action } = await import("./routes/app.billing");
    mocks.createSubscription.mockResolvedValue({ confirmationUrl: "https://shopify.test/confirm" });
    const body = new FormData();
    body.set("intent", "start_subscription");

    const response = await action(
      args(new Request("https://search.pagelumo.com/app/billing", { method: "POST", body })),
    );

    expect(response.status).toBe(302);
    expect(mocks.shopifyRedirect).toHaveBeenCalledWith("https://shopify.test/confirm", { target: "_top" });
  });

  it("submits subscription start with an App Bridge session token", async () => {
    const source = readFileSync(join(process.cwd(), "app/routes/app.billing.tsx"), "utf8");

    expect(source).toContain('import { useAppBridge } from "@shopify/app-bridge-react";');
    expect(source).toContain("await shopify.idToken()");
    expect(source).toContain("window.location.search");
    expect(source).toContain('Authorization: `Bearer ${idToken}`');
    expect(source).toContain('window.open(redirectUrl, "_top")');
    expect(source).not.toContain("reloadDocument");
  });

  it("redirects to app after an active billing return", async () => {
    const { loader } = await import("./routes/app.billing.return");
    mocks.refreshBillingStatus.mockResolvedValueOnce({
      entitled: true,
      state: {
        shopDomain: "demo.myshopify.com",
        trialUsed: true,
        subscriptionStatus: "active",
        activeSubscriptionId: "gid://shopify/AppSubscription/1",
        currentPeriodEnd: new Date("2026-07-11T00:00:00Z"),
      },
      subscription: { id: "gid://shopify/AppSubscription/1" },
    });

    const response = await loader(
      args(
        new Request(
          "https://search.pagelumo.com/app/billing/return?shop=demo.myshopify.com&host=encoded-host&embedded=1",
        ),
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("/app?shop=demo.myshopify.com&host=encoded-host&embedded=1");
  });
});
