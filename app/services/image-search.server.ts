import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import type { MilvusSearchHit } from "../lib/image-search/types";
import { assertAllowedImageUpload } from "../lib/image-search/validation.server";
import { createEmbeddingClient } from "./embedding-client.server";
import { listFavoriteProductGids } from "./favorites.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import { saveLocalThumbnail } from "./upload-storage.server";
import { createUploadHistory, listRecentUploads } from "./upload-history.server";

export function dedupeHitsByProduct(hits: MilvusSearchHit[]): MilvusSearchHit[] {
  const bestByProduct = new Map<string, MilvusSearchHit>();
  for (const hit of hits) {
    const existing = bestByProduct.get(hit.shopifyProductGid);
    if (!existing || hit.score > existing.score) {
      bestByProduct.set(hit.shopifyProductGid, hit);
    }
  }
  return [...bestByProduct.values()].sort((a, b) => b.score - a.score);
}

export async function runImageSearch(input: {
  prisma: PrismaClient;
  shopDomain: string;
  anonymousId: string;
  customerGid?: string | null;
  file: File;
  limit: number;
  availableOnly: boolean;
}) {
  assertAllowedImageUpload({ contentType: input.file.type, byteSize: input.file.size });

  const config = getImageSearchConfig();
  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config);
  const uploadId = randomUUID();
  const imageBytes = Buffer.from(await input.file.arrayBuffer());
  const thumbnail = await saveLocalThumbnail({
    storageDir: config.uploadStorageLocalDir,
    publicBaseUrl: config.uploadStoragePublicBaseUrl,
    shopDomain: input.shopDomain,
    uploadId,
    imageBytes,
  });

  try {
    const embedding = await embeddingClient.embedImageFile(input.file);
    const rawHits = await vectorStore.search({
      embedding: embedding.embedding,
      shopDomain: input.shopDomain,
      limit: Math.max(input.limit * 3, 36),
      availableOnly: input.availableOnly,
    });
    const hits = dedupeHitsByProduct(rawHits).slice(0, input.limit);
    const productGids = hits.map((hit) => hit.shopifyProductGid);
    const mediaGidsByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.shopifyMediaGid]));
    const scoreByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.score]));
    const favoriteGids = await listFavoriteProductGids({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      identityType: input.customerGid ? "customer" : "anonymous",
      identityId: input.customerGid ?? input.anonymousId,
    });
    const favoriteSet = new Set(favoriteGids);

    const products = await input.prisma.shopProduct.findMany({
      where: {
        shopDomain: input.shopDomain,
        shopifyProductGid: { in: productGids },
        status: "ACTIVE",
        ...(input.availableOnly ? { availableForSale: true } : {}),
      },
      include: { variants: true, images: true },
    });

    const productByGid = new Map(products.map((product) => [product.shopifyProductGid, product]));
    const results = hits
      .map((hit) => {
        const product = productByGid.get(hit.shopifyProductGid);
        if (!product) return null;
        const mediaGid = mediaGidsByProduct.get(product.shopifyProductGid);
        const image =
          product.images.find((item) => item.shopifyMediaGid === mediaGid) ??
          product.images.find((item) => item.isFeatured) ??
          product.images[0];
        return buildProductCardDTO({
          product,
          variants: product.variants,
          imageUrl: image?.imageUrl ?? product.featuredImageUrl,
          similarityScore: scoreByProduct.get(product.shopifyProductGid) ?? null,
          isFavorited: favoriteSet.has(product.shopifyProductGid),
        });
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    const upload = await createUploadHistory({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      thumbnailStorageKey: thumbnail.thumbnailStorageKey,
      thumbnailUrl: thumbnail.thumbnailUrl,
      originalImageStorageKey: null,
      originalFilename: input.file.name,
      contentType: input.file.type,
      byteSize: input.file.size,
      searchStatus: "completed",
    });
    const recentUploads = await listRecentUploads({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      limit: 8,
    });

    return {
      uploadId: upload.id,
      results,
      favorites: favoriteGids,
      recentUploads,
      queryMeta: {
        embeddingModel: embedding.model,
        embeddingModelAlias: embedding.modelAlias ?? config.embeddingModelAlias,
        dimension: embedding.dimension,
        limit: input.limit,
        availableOnly: input.availableOnly,
      },
    };
  } catch (error) {
    await createUploadHistory({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      thumbnailStorageKey: thumbnail.thumbnailStorageKey,
      thumbnailUrl: thumbnail.thumbnailUrl,
      originalImageStorageKey: null,
      originalFilename: input.file.name,
      contentType: input.file.type,
      byteSize: input.file.size,
      searchStatus: "failed",
    });
    throw error;
  }
}
