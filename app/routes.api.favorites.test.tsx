import { describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.favorites";

const mocks = vi.hoisted(() => ({
  addFavorite: vi.fn(),
  listFavoriteProducts: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {},
}));

vi.mock("./services/favorites.server", () => ({
  addFavorite: mocks.addFavorite,
  listFavoriteProducts: mocks.listFavoriteProducts,
}));

function loaderArgs(requestUrl: string) {
  const url = new URL(requestUrl);
  return {
    request: new Request(url),
    url,
    pattern: "/api/favorites",
    params: {},
    context: {},
  };
}

describe("favorites route", () => {
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
      prisma: {},
      shopDomain: "demo-shop.myshopify.com",
      identityType: "anonymous",
      identityId: "4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
    });
  });
});
