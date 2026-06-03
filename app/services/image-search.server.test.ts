import { describe, expect, it } from "vitest";
import { dedupeHitsByProduct } from "./image-search.server";

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
