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

interface ProductCategoryInput {
  title: string;
  productType?: string | null;
  tags?: string[] | null;
}

const SEARCH_CATEGORY_KEYWORDS: Array<{ category: string; keywords: string[] }> = [
  {
    category: "outerwear",
    keywords: ["coat", "jacket", "blazer", "parka", "trench", "overcoat", "cardigan", "vest"],
  },
  {
    category: "shoes",
    keywords: ["shoe", "shoes", "sneaker", "sneakers", "boot", "boots", "sandal", "heel", "loafer"],
  },
  {
    category: "bags",
    keywords: ["bag", "bags", "tote", "handbag", "purse", "backpack", "clutch", "satchel"],
  },
  {
    category: "eyewear",
    keywords: ["sunglasses", "glasses", "eyewear", "aviator", "frames"],
  },
  {
    category: "dresses",
    keywords: ["dress", "dresses", "skirt", "gown"],
  },
  {
    category: "tops",
    keywords: ["shirt", "blouse", "top", "tee", "t-shirt", "sweater", "hoodie", "pullover"],
  },
  {
    category: "bottoms",
    keywords: ["pants", "jeans", "trouser", "trousers", "shorts", "leggings"],
  },
];

function productSearchText(product: ProductCategoryInput): string {
  return [product.productType, product.title, ...(product.tags ?? [])].filter(Boolean).join(" ").toLowerCase();
}

export function inferProductSearchCategory(product: ProductCategoryInput): string | null {
  const text = productSearchText(product);
  for (const group of SEARCH_CATEGORY_KEYWORDS) {
    if (group.keywords.some((keyword) => text.includes(keyword))) return group.category;
  }
  return null;
}

export function filterHitsByDominantProductCategory(
  hits: MilvusSearchHit[],
  productsByGid: Map<string, ProductCategoryInput>,
  anchorProduct?: ProductCategoryInput | null,
): MilvusSearchHit[] {
  const anchorCategory =
    (anchorProduct ? inferProductSearchCategory(anchorProduct) : null) ??
    hits
      .map((hit) => productsByGid.get(hit.shopifyProductGid))
      .filter((product): product is ProductCategoryInput => Boolean(product))
      .map(inferProductSearchCategory)
      .find((category): category is string => Boolean(category));

  if (!anchorCategory) return hits;

  return hits.filter((hit) => {
    const product = productsByGid.get(hit.shopifyProductGid);
    return product ? inferProductSearchCategory(product) === anchorCategory : false;
  });
}

export function dedupeHitsByProduct(
  hits: MilvusSearchHit[],
  options: { minScore?: number; limit?: number } = {},
): MilvusSearchHit[] {
  const bestByProduct = new Map<string, MilvusSearchHit>();
  for (const hit of hits) {
    if (options.minScore !== undefined && hit.score < options.minScore) continue;
    const existing = bestByProduct.get(hit.shopifyProductGid);
    if (!existing || hit.score > existing.score) {
      bestByProduct.set(hit.shopifyProductGid, hit);
    }
  }
  const deduped = [...bestByProduct.values()].sort((a, b) => b.score - a.score);
  return options.limit === undefined ? deduped : deduped.slice(0, options.limit);
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
    const candidateHits = dedupeHitsByProduct(rawHits, {
      minScore: config.imageSearchMinSimilarityScore,
    });
    const candidateProductGids = candidateHits.map((hit) => hit.shopifyProductGid);
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
        shopifyProductGid: { in: candidateProductGids },
        status: "ACTIVE",
        ...(input.availableOnly ? { availableForSale: true } : {}),
      },
      include: { variants: true, images: true },
    });

    const productByGid = new Map(products.map((product) => [product.shopifyProductGid, product]));
    const hits = filterHitsByDominantProductCategory(candidateHits, productByGid).slice(0, input.limit);
    const mediaGidsByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.shopifyMediaGid]));
    const scoreByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.score]));
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
