import { describe, expect, it, vi } from "vitest";
import { fetchShopifyProductForIndex, mapShopifyProductNode, upsertMappedProduct } from "./shopify-product-sync.server";

function productFixture(overrides: Partial<Parameters<typeof mapShopifyProductNode>[0]["product"]> = {}) {
  return {
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
    ...overrides,
  };
}

describe("mapShopifyProductNode", () => {
  it("maps products, variants, legacy numeric ids, and media images", () => {
    const mapped = mapShopifyProductNode({
      shopDomain: "demo.myshopify.com",
      currencyCode: "CAD",
      product: productFixture(),
    });

    expect(mapped.product.shopifyProductGid).toBe("gid://shopify/Product/1");
    expect(mapped.product.minPrice).toBe("244.00");
    expect(mapped.product.availableForSale).toBe(true);
    expect(mapped.variants[0].shopifyVariantNumericId).toBe("1234567890");
    expect(mapped.images[0].isFeatured).toBe(true);
    expect(mapped.images[0].imageUrlHash).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("fetchShopifyProductForIndex", () => {
  it("fetches a single product by gid for webhook-driven sync", async () => {
    const admin = {
      graphql: vi.fn(async () =>
        new Response(
          JSON.stringify({
            data: {
              shop: { myshopifyDomain: "demo.myshopify.com", currencyCode: "CAD" },
              product: productFixture({ id: "gid://shopify/Product/9" }),
            },
          }),
        ),
      ),
    };

    const fetched = await fetchShopifyProductForIndex({
      admin,
      productGid: "gid://shopify/Product/9",
      mediaFirst: 25,
      variantsFirst: 50,
    });

    expect(fetched.shopDomain).toBe("demo.myshopify.com");
    expect(fetched.products).toHaveLength(1);
    expect(fetched.products[0].id).toBe("gid://shopify/Product/9");
    expect(admin.graphql).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        variables: expect.objectContaining({ id: "gid://shopify/Product/9" }),
      }),
    );
  });
});

describe("upsertMappedProduct", () => {
  it("removes stale variants and images that no longer exist in Shopify", async () => {
    const mapped = mapShopifyProductNode({
      shopDomain: "demo.myshopify.com",
      currencyCode: "CAD",
      product: productFixture(),
    });
    const staleImages: Array<{ id: string; milvusVectorId: string | null }> = [];
    const prisma = {
      shopProduct: {
        upsert: vi.fn(async () => ({ id: "product-row-id" })),
      },
      shopProductVariant: {
        upsert: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
      shopProductImage: {
        findUnique: vi.fn(async () => null),
        findMany: vi.fn(async () => [{ id: "stale-image-row", milvusVectorId: "stale-vector-id" }]),
        upsert: vi.fn(async () => ({})),
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    };

    await upsertMappedProduct({
      prisma: prisma as never,
      mapped,
      onStaleIndexedImage: async (image: { id: string; milvusVectorId: string | null }) => {
        staleImages.push({ id: image.id, milvusVectorId: image.milvusVectorId });
      },
    } as never);

    expect(prisma.shopProductVariant.deleteMany).toHaveBeenCalledWith({
      where: {
        productId: "product-row-id",
        shopifyVariantGid: { notIn: ["gid://shopify/ProductVariant/1"] },
      },
    });
    expect(staleImages).toEqual([{ id: "stale-image-row", milvusVectorId: "stale-vector-id" }]);
    expect(prisma.shopProductImage.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale-image-row"] } },
    });
  });
});
