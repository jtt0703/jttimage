import { createHash } from "node:crypto";

export function createImageUrlHash(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("hex");
}

export function createMilvusVectorId(input: {
  shopDomain: string;
  shopifyMediaGid: string;
  embeddingModel: string;
  embeddingDimension: number;
}): string {
  return createHash("sha256")
    .update(`${input.shopDomain}::${input.shopifyMediaGid}::${input.embeddingModel}::${input.embeddingDimension}`)
    .digest("hex");
}
