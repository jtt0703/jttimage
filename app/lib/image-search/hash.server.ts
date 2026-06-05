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

export function createShopMilvusCollectionName(input: {
  prefix: string;
  shopDomain: string;
  embeddingDimension: number;
  embeddingModelAlias: string;
}): string {
  const shopHash = createHash("sha256").update(input.shopDomain).digest("hex").slice(0, 16);
  const sanitizedPrefix = input.prefix.replace(/[^a-zA-Z0-9_]/g, "_").replace(/^([^a-zA-Z_])/, "_$1");
  const sanitizedAlias = input.embeddingModelAlias.replace(/[^a-zA-Z0-9_]/g, "_");
  return `${sanitizedPrefix}_${sanitizedAlias}_${input.embeddingDimension}_${shopHash}`.slice(0, 255);
}
