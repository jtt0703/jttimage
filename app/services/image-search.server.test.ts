import { describe, expect, it } from "vitest";
import {
  buildProductSearchResults,
  createImageSearchTiming,
  dedupeHitsByProduct,
  filterHitsByDominantProductCategory,
  inferProductSearchCategory,
} from "./image-search.server";

describe("dedupeHitsByProduct", () => {
  it("keeps highest scoring hit per product", () => {
    expect(
      dedupeHitsByProduct([
        { vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "m1", score: 0.7 },
        { vectorId: "v2", shopifyProductGid: "p1", shopifyMediaGid: "m2", score: 0.9 },
        { vectorId: "v3", shopifyProductGid: "p2", shopifyMediaGid: "m3", score: 0.8 },
      ]),
    ).toEqual([
      { vectorId: "v2", shopifyProductGid: "p1", shopifyMediaGid: "m2", score: 0.9 },
      { vectorId: "v3", shopifyProductGid: "p2", shopifyMediaGid: "m3", score: 0.8 },
    ]);
  });

  it("filters hits below the configured minimum score before limiting", () => {
    expect(
      dedupeHitsByProduct(
        [
          { vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "m1", score: 0.8 },
          { vectorId: "v2", shopifyProductGid: "p2", shopifyMediaGid: "m2", score: 0.24 },
          { vectorId: "v3", shopifyProductGid: "p3", shopifyMediaGid: "m3", score: 0.26 },
        ],
        { minScore: 0.25, limit: 4 },
      ),
    ).toEqual([
      { vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "m1", score: 0.8 },
      { vectorId: "v3", shopifyProductGid: "p3", shopifyMediaGid: "m3", score: 0.26 },
    ]);
  });
});

describe("inferProductSearchCategory", () => {
  it("normalizes related apparel product names into broad search categories", () => {
    expect(inferProductSearchCategory({ title: "Olive Utility Jacket", productType: "Jackets", tags: [] })).toBe(
      "outerwear",
    );
    expect(inferProductSearchCategory({ title: "Black Wool Coat", productType: "Coats", tags: [] })).toBe(
      "outerwear",
    );
    expect(inferProductSearchCategory({ title: "White Leather Sneakers", productType: "Shoes", tags: [] })).toBe(
      "shoes",
    );
  });
});

describe("filterHitsByDominantProductCategory", () => {
  it("filters cross-category hits using the highest scoring product as the category anchor", () => {
    const hits = [
      { vectorId: "v1", shopifyProductGid: "jacket", shopifyMediaGid: "m1", score: 0.82 },
      { vectorId: "v2", shopifyProductGid: "sneakers", shopifyMediaGid: "m2", score: 0.78 },
      { vectorId: "v3", shopifyProductGid: "coat", shopifyMediaGid: "m3", score: 0.72 },
      { vectorId: "v4", shopifyProductGid: "bag", shopifyMediaGid: "m4", score: 0.68 },
    ];
    const products = new Map([
      ["jacket", { title: "Olive Utility Jacket", productType: "Jackets", tags: [] }],
      ["sneakers", { title: "White Leather Sneakers", productType: "Shoes", tags: [] }],
      ["coat", { title: "Black Wool Coat", productType: "Coats", tags: [] }],
      ["bag", { title: "Black Leather Tote Bag", productType: "Bags", tags: [] }],
    ]);

    expect(filterHitsByDominantProductCategory(hits, products)).toEqual([
      { vectorId: "v1", shopifyProductGid: "jacket", shopifyMediaGid: "m1", score: 0.82 },
      { vectorId: "v3", shopifyProductGid: "coat", shopifyMediaGid: "m3", score: 0.72 },
    ]);
  });
});

describe("buildProductSearchResults", () => {
  it("dedupes products and prefers the matched product image on the card", () => {
    const results = buildProductSearchResults({
      hits: [
        { vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "media-featured", score: 0.81 },
        { vectorId: "v2", shopifyProductGid: "p1", shopifyMediaGid: "media-second", score: 0.92 },
      ],
      products: [
        {
          shopifyProductGid: "p1",
          title: "Black Aviator Sunglasses",
          handle: "black-aviator-sunglasses",
          productType: "Sunglasses",
          tags: [],
          featuredImageUrl: "https://cdn.example.com/featured.png",
          minPrice: "29.99",
          currencyCode: "USD",
          availableForSale: true,
          variants: [
            {
              shopifyVariantGid: "variant-1",
              shopifyVariantNumericId: "1",
              title: "Default Title",
              price: "29.99",
              compareAtPrice: null,
              availableForSale: true,
            },
          ],
          images: [
            {
              shopifyMediaGid: "media-featured",
              imageUrl: "https://cdn.example.com/featured.png",
              isFeatured: true,
            },
            {
              shopifyMediaGid: "media-second",
              imageUrl: "https://cdn.example.com/second.png",
              isFeatured: false,
            },
          ],
        },
      ],
      favoriteProductGids: [],
      limit: 9,
    });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      productGid: "p1",
      imageUrl: "https://cdn.example.com/second.png",
      similarityScore: 0.92,
    });
  });
});

describe("createImageSearchTiming", () => {
  it("records stage timings and total request timing in milliseconds", async () => {
    let currentMs = 100;
    const timing = createImageSearchTiming({
      now: () => currentMs,
      requestStartedAtMs: 80,
      uploadParseMs: 12,
    });

    currentMs = 110;
    const embedding = await timing.measure("embeddingMs", async () => {
      currentMs = 136.4;
      return "embedded";
    });
    currentMs = 151.7;
    await timing.measure("milvusSearchMs", async () => {
      currentMs = 160.2;
    });
    currentMs = 166.6;

    expect(embedding).toBe("embedded");
    expect(timing.complete()).toEqual({
      totalMs: 87,
      serviceMs: 67,
      uploadParseMs: 12,
      embeddingMs: 26,
      milvusSearchMs: 9,
    });
  });
});
