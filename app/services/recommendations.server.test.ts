import { describe, expect, it } from "vitest";
import { selectSourceIndexedImage } from "./recommendations.server";

type IndexedImageInput = Parameters<typeof selectSourceIndexedImage>[0];

describe("selectSourceIndexedImage", () => {
  it("prefers featured indexed image", () => {
    const images: IndexedImageInput = [
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first" },
      { isFeatured: true, embeddingStatus: "indexed", milvusVectorId: "featured" },
    ];
    const image = selectSourceIndexedImage(images);
    expect(image?.milvusVectorId).toBe("featured");
  });

  it("falls back to first indexed image", () => {
    const images: IndexedImageInput = [
      { isFeatured: true, embeddingStatus: "failed", milvusVectorId: null },
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first-indexed" },
    ];
    const image = selectSourceIndexedImage(images);
    expect(image?.milvusVectorId).toBe("first-indexed");
  });
});
