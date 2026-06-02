import { describe, expect, it, vi } from "vitest";
import { shouldIndexImage } from "./product-indexer.server";

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
