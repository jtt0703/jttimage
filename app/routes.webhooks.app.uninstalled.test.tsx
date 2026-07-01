import type { ActionFunctionArgs } from "react-router";
import { describe, expect, it, vi } from "vitest";
import { action } from "./routes/webhooks.app.uninstalled";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  deleteBillingStates: vi.fn(),
  deleteSessions: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
}));

vi.mock("./db.server", () => ({
  default: {
    session: { deleteMany: mocks.deleteSessions },
    shopBillingState: { deleteMany: mocks.deleteBillingStates },
  },
}));

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: "/webhooks/app/uninstalled",
    params: {},
    context: {},
  };
}

describe("app/uninstalled webhook", () => {
  it("deletes sessions without deleting billing state", async () => {
    mocks.authenticateWebhook.mockResolvedValue({
      shop: "demo.myshopify.com",
      session: { id: "offline_demo" },
      topic: "APP_UNINSTALLED",
    });

    const response = await action(
      actionArgs(new Request("http://localhost/webhooks/app/uninstalled", { method: "POST" })),
    );

    expect(response.status).toBe(200);
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
    expect(mocks.deleteBillingStates).not.toHaveBeenCalled();
  });
});
