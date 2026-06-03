import { describe, expect, it } from "vitest";
import { dedupeHitsByProduct, filterHitsByDominantProductCategory, inferProductSearchCategory } from "./image-search.server";

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
