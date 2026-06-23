import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "./routes/api.favorites.delete";

const mocks = vi.hoisted(() => ({
  deleteFavorite: vi.fn(),
  findSession: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {
    session: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("./services/favorites.server", () => ({
  deleteFavorite: mocks.deleteFavorite,
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: "/api/favorites/delete",
    params: {},
    context: {},
  };
}

describe("favorite delete route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.requireBillingAccess.mockResolvedValue({});
    mocks.deleteFavorite.mockResolvedValue({ favorites: [] });
  });

  it("returns 402 when deleting a favorite for an unsubscribed installed shop", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/favorites/delete", {
          method: "POST",
          body: JSON.stringify({
            shop: "demo-shop.myshopify.com",
            identityType: "anonymous",
            identityId: "4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
            shopifyProductGid: "gid://shopify/Product/1",
          }),
        }),
      ),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
    expect(mocks.deleteFavorite).not.toHaveBeenCalled();
  });
});
