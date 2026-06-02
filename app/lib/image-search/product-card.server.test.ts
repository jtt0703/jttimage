import { describe, expect, it } from "vitest";
import { buildProductCardDTO } from "./product-card.server";

describe("buildProductCardDTO", () => {
  it("chooses first available variant and exposes numeric variant id", () => {
    const dto = buildProductCardDTO({
      product: {
        shopifyProductGid: "gid://shopify/Product/1",
        title: "Sunglasses",
        handle: "sunglasses",
        featuredImageUrl: "https://cdn.shopify.com/p.jpg",
        minPrice: { toString: () => "99.00" },
        currencyCode: "CAD",
        availableForSale: true,
      },
      variants: [
        {
          shopifyVariantGid: "gid://shopify/ProductVariant/1",
          shopifyVariantNumericId: "111",
          title: "Black",
          price: { toString: () => "99.00" },
          compareAtPrice: null,
          availableForSale: false,
        },
        {
          shopifyVariantGid: "gid://shopify/ProductVariant/2",
          shopifyVariantNumericId: "222",
          title: "Brown",
          price: { toString: () => "109.00" },
          compareAtPrice: { toString: () => "129.00" },
          availableForSale: true,
        },
      ],
      imageUrl: "https://cdn.shopify.com/result.jpg",
      similarityScore: 0.91,
      isFavorited: true,
    });

    expect(dto).toEqual({
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/2",
      variantId: "222",
      title: "Sunglasses",
      handle: "sunglasses",
      imageUrl: "https://cdn.shopify.com/result.jpg",
      price: "109.00",
      compareAtPrice: "129.00",
      currencyCode: "CAD",
      availableForSale: true,
      variantTitle: "Brown",
      similarityScore: 0.91,
      isFavorited: true,
    });
  });
});
