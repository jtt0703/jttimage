import type { ActionFunctionArgs } from "react-router";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  unauthenticatedAdmin: vi.fn(),
  refreshBillingStatus: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
  unauthenticated: { admin: mocks.unauthenticatedAdmin },
}));

vi.mock("./db.server", () => ({ default: { shopBillingState: {} } }));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    refreshBillingStatus: mocks.refreshBillingStatus,
  };
});

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: "/webhooks/app/subscriptions_update",
    params: {},
    context: {},
  };
}

describe("app/subscriptions_update webhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      topic: "APP_SUBSCRIPTIONS_UPDATE",
      payload: { admin_graphql_api_id: "gid://shopify/AppSubscription/1", status: "CANCELLED" },
    });
    mocks.unauthenticatedAdmin.mockResolvedValue({ admin: { graphql: vi.fn() } });
    mocks.refreshBillingStatus.mockResolvedValue({
      entitled: false,
      state: { shopDomain: "demo.myshopify.com", subscriptionStatus: "inactive" },
      subscription: null,
    });
  });

  it("refreshes local billing state from Shopify when app subscriptions change", async () => {
    const { action } = await import("./routes/webhooks.app.subscriptions_update");

    const response = await action(
      actionArgs(new Request("http://localhost/webhooks/app/subscriptions_update", { method: "POST" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.unauthenticatedAdmin).toHaveBeenCalledWith("demo.myshopify.com");
    expect(mocks.refreshBillingStatus).toHaveBeenCalledWith({
      prisma: { shopBillingState: {} },
      admin: expect.objectContaining({ graphql: expect.any(Function) }),
      shopDomain: "demo.myshopify.com",
    });
  });

  it("does not hide billing refresh failures", async () => {
    const { action } = await import("./routes/webhooks.app.subscriptions_update");
    mocks.refreshBillingStatus.mockRejectedValueOnce(new Error("Shopify billing lookup failed"));

    await expect(
      action(actionArgs(new Request("http://localhost/webhooks/app/subscriptions_update", { method: "POST" }))),
    ).rejects.toThrow("Shopify billing lookup failed");
  });

  it("registers the Shopify app subscriptions update topic in app configs", () => {
    const lensSearchConfig = readFileSync(join(process.cwd(), "shopify.app.lens-search.toml"), "utf8");
    const defaultConfig = readFileSync(join(process.cwd(), "shopify.app.toml"), "utf8");

    for (const config of [lensSearchConfig, defaultConfig]) {
      expect(config).toContain('topics = [ "app_subscriptions/update" ]');
      expect(config).toContain('uri = "/webhooks/app/subscriptions_update"');
    }
  });
});
