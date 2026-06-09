import { describe, expect, it } from "vitest";
import { resolveProductIndexFetchInput, shouldIndexImage } from "./product-indexer.server";

describe("shouldIndexImage", () => {
  const baseImage = {
    embeddingStatus: "indexed",
    embeddingModel: "openai/clip-vit-base-patch16",
    embeddingDimension: 512,
    milvusCollection: "product_image_embeddings_512",
    milvusVectorId: "vector-id",
  };

  it("indexes when mode is force", () => {
    expect(
      shouldIndexImage({
        image: baseImage,
        mode: "force",
        model: "openai/clip-vit-base-patch16",
        dimension: 512,
        collection: "product_image_embeddings_512",
      }),
    ).toBe(true);
  });

  it("skips already indexed current images", () => {
    expect(
      shouldIndexImage({
        image: baseImage,
        mode: "incremental",
        model: "openai/clip-vit-base-patch16",
        dimension: 512,
        collection: "product_image_embeddings_512",
      }),
    ).toBe(false);
  });

  it("indexes failed or stale images", () => {
    expect(
      shouldIndexImage({
        image: { ...baseImage, embeddingStatus: "failed" },
        mode: "incremental",
        model: "openai/clip-vit-base-patch16",
        dimension: 512,
        collection: "product_image_embeddings_512",
      }),
    ).toBe(true);
    expect(
      shouldIndexImage({
        image: { ...baseImage, embeddingDimension: 1024 },
        mode: "incremental",
        model: "openai/clip-vit-base-patch16",
        dimension: 512,
        collection: "product_image_embeddings_512",
      }),
    ).toBe(true);
  });
});

describe("resolveProductIndexFetchInput", () => {
  const config = {
    shopifyProductQuery: "status:active",
    shopifyProductsPageSize: 50,
  };

  it("uses the queued job source filter instead of current env defaults", () => {
    expect(
      resolveProductIndexFetchInput(config, {
        query: "id:123456789",
        first: 1,
        mode: "webhook_product",
        productGid: "gid://shopify/Product/123456789",
      }),
    ).toEqual({
      query: "id:123456789",
      first: 1,
      productGid: "gid://shopify/Product/123456789",
    });
  });

  it("falls back to configured defaults when a job has no usable source filter", () => {
    expect(resolveProductIndexFetchInput(config, null)).toEqual({
      query: "status:active",
      first: 50,
      productGid: null,
    });
  });
});
