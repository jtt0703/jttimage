import { describe, expect, it } from "vitest";
import { createImageUrlHash, createMilvusVectorId } from "./hash.server";

describe("image search hash utilities", () => {
  it("creates a stable image url hash", () => {
    expect(createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1")).toBe(
      createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1"),
    );
    expect(createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1")).not.toBe(
      createImageUrlHash("https://cdn.shopify.com/image.jpg?v=2"),
    );
  });

  it("uses canonical model and dimension for vector ids", () => {
    const vectorId = createMilvusVectorId({
      shopDomain: "demo.myshopify.com",
      shopifyMediaGid: "gid://shopify/MediaImage/123",
      embeddingModel: "openai/clip-vit-base-patch16",
      embeddingDimension: 512,
    });

    expect(vectorId).toMatch(/^[a-f0-9]{64}$/);
    expect(vectorId).toBe(
      createMilvusVectorId({
        shopDomain: "demo.myshopify.com",
        shopifyMediaGid: "gid://shopify/MediaImage/123",
        embeddingModel: "openai/clip-vit-base-patch16",
        embeddingDimension: 512,
      }),
    );
  });
});
