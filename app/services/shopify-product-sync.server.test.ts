import { describe, expect, it } from "vitest";
import { mapShopifyProductNode } from "./shopify-product-sync.server";

describe("mapShopifyProductNode", () => {
  it("maps products, variants, legacy numeric ids, and media images", () => {
    const mapped = mapShopifyProductNode({
      shopDomain: "demo.myshopify.com",
      currencyCode: "CAD",
      product: {
        id: "gid://shopify/Product/1",
        title: "Sunglasses",
        handle: "sunglasses",
        status: "ACTIVE",
        vendor: "Lens Vendor",
        productType: "Sunglasses",
        tags: ["lenscart-test"],
        featuredMedia: {
          id: "gid://shopify/MediaImage/1",
          image: {
            id: "gid://shopify/Image/1",
            url: "https://cdn.shopify.com/1.jpg",
            altText: "front",
            width: 100,
            height: 100,
          },
        },
        media: {
          nodes: [
            {
              id: "gid://shopify/MediaImage/1",
              image: {
                id: "gid://shopify/Image/1",
                url: "https://cdn.shopify.com/1.jpg",
                altText: "front",
                width: 100,
                height: 100,
              },
            },
          ],
        },
        variants: {
          nodes: [
            {
              id: "gid://shopify/ProductVariant/1",
              legacyResourceId: "1234567890",
              title: "Default Title",
              sku: "SKU",
              price: "244.00",
              compareAtPrice: null,
              availableForSale: true,
              inventoryQuantity: 5,
            },
          ],
        },
      },
    });

    expect(mapped.product.shopifyProductGid).toBe("gid://shopify/Product/1");
    expect(mapped.product.minPrice).toBe("244.00");
    expect(mapped.product.availableForSale).toBe(true);
    expect(mapped.variants[0].shopifyVariantNumericId).toBe("1234567890");
    expect(mapped.images[0].isFeatured).toBe(true);
    expect(mapped.images[0].imageUrlHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
