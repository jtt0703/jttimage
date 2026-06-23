import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action, loader } from "./routes/api.favorites";

const mocks = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  findSession: vi.fn(),
  listFavoriteProducts: vi.fn(),
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
  addFavorite: mocks.addFavorite,
  listFavoriteProducts: mocks.listFavoriteProducts,
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

function loaderArgs(requestUrl: string): LoaderFunctionArgs {
  const url = new URL(requestUrl);
  return {
    request: new Request(url),
    url,
    pattern: "/api/favorites",
    params: {},
    context: {},
  };
}

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: "/api/favorites",
    params: {},
    context: {},
  };
}

describe("favorites route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.requireBillingAccess.mockResolvedValue({});
    mocks.addFavorite.mockResolvedValue({ favorites: ["gid://shopify/Product/1"] });
  });

  it("returns favorite product details for wishlist pages", async () => {
    mocks.listFavoriteProducts.mockResolvedValue({
      favorites: ["gid://shopify/Product/1"],
      products: [
        {
          productGid: "gid://shopify/Product/1",
          variantGid: "gid://shopify/ProductVariant/11",
          variantId: "11",
          title: "Aviator Frame",
          handle: "aviator-frame",
          imageUrl: "https://cdn.shopify.com/aviator.jpg",
          price: "99.00",
          compareAtPrice: null,
          currencyCode: "USD",
          availableForSale: true,
          variantTitle: "Gold",
          similarityScore: null,
          isFavorited: true,
        },
      ],
    });

    const response = await loader(
      loaderArgs(
        "http://localhost/api/favorites?shop=demo-shop.myshopify.com&identityType=anonymous&identityId=4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
      ),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      favorites: ["gid://shopify/Product/1"],
      products: [
        expect.objectContaining({
          productGid: "gid://shopify/Product/1",
          handle: "aviator-frame",
          isFavorited: true,
        }),
      ],
    });
    expect(mocks.listFavoriteProducts).toHaveBeenCalledWith({
      prisma: expect.objectContaining({ session: expect.any(Object) }),
      shopDomain: "demo-shop.myshopify.com",
      identityType: "anonymous",
      identityId: "4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
    });
  });

  it("returns 402 when listing favorites for an unsubscribed installed shop", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await loader(
      loaderArgs(
        "http://localhost/api/favorites?shop=demo-shop.myshopify.com&identityType=anonymous&identityId=4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
      ),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
    expect(mocks.listFavoriteProducts).not.toHaveBeenCalled();
  });

  it("returns 402 when adding a favorite for an unsubscribed installed shop", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/favorites", {
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
    expect(mocks.addFavorite).not.toHaveBeenCalled();
  });
});
