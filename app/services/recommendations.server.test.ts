import { describe, expect, it } from "vitest";
import { selectSourceIndexedImage } from "./recommendations.server";

describe("selectSourceIndexedImage", () => {
  it("prefers featured indexed image", () => {
    const image = selectSourceIndexedImage([
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first" },
      { isFeatured: true, embeddingStatus: "indexed", milvusVectorId: "featured" },
    ] as any);
    expect(image?.milvusVectorId).toBe("featured");
  });

  it("falls back to first indexed image", () => {
    const image = selectSourceIndexedImage([
      { isFeatured: true, embeddingStatus: "failed", milvusVectorId: null },
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first-indexed" },
    ] as any);
    expect(image?.milvusVectorId).toBe("first-indexed");
  });
});
