import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import type { ImageSearchTimingMeta, MilvusSearchHit } from "../lib/image-search/types";
import { assertAllowedImageUpload } from "../lib/image-search/validation.server";
import { createEmbeddingClient } from "./embedding-client.server";
import { listFavoriteProductGids } from "./favorites.server";
import { errorLogFields, hashLogValue, logger } from "../lib/logger.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import { createUploadStorage } from "./upload-storage.server";
import { createUploadHistory, listRecentUploads } from "./upload-history.server";

type ImageSearchTimingStage = Exclude<keyof ImageSearchTimingMeta, "totalMs" | "serviceMs" | "uploadParseMs">;
type DecimalLike = { toString(): string } | string | number | null | undefined;

interface ProductCategoryInput {
  title: string;
  productType?: string | null;
  tags?: string[] | null;
}

interface ProductSearchProductInput extends ProductCategoryInput {
  shopifyProductGid: string;
  handle: string;
  featuredImageUrl: string | null;
  minPrice: DecimalLike;
  currencyCode: string | null;
  availableForSale: boolean;
  variants: Array<{
    shopifyVariantGid: string;
    shopifyVariantNumericId: string;
    title: string;
    price: DecimalLike;
    compareAtPrice: DecimalLike;
    availableForSale: boolean;
  }>;
  images: Array<{
    shopifyMediaGid: string;
    imageUrl: string;
    isFeatured: boolean;
  }>;
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

function roundDurationMs(value: number): number {
  return Math.max(0, Math.round(value));
}

export function createImageSearchTiming(input: {
  now?: () => number;
  requestStartedAtMs?: number;
  uploadParseMs?: number;
} = {}) {
  const now = input.now ?? (() => performance.now());
  const serviceStartedAtMs = now();
  const stages: Partial<ImageSearchTimingMeta> = {};
  if (input.uploadParseMs !== undefined) {
    stages.uploadParseMs = roundDurationMs(input.uploadParseMs);
  }

  return {
    async measure<T>(stage: ImageSearchTimingStage, operation: () => Promise<T>): Promise<T> {
      const startedAtMs = now();
      try {
        return await operation();
      } finally {
        stages[stage] = roundDurationMs(now() - startedAtMs);
      }
    },

    complete(): ImageSearchTimingMeta {
      const endedAtMs = now();
      const serviceMs = roundDurationMs(endedAtMs - serviceStartedAtMs);
      const totalMs =
        input.requestStartedAtMs === undefined ? serviceMs : roundDurationMs(endedAtMs - input.requestStartedAtMs);

      return {
        totalMs,
        serviceMs,
        ...stages,
      };
    },
  };
}

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
  const topHitProduct = hits[0] ? productsByGid.get(hits[0].shopifyProductGid) : null;
  const categoryAnchor = anchorProduct ?? topHitProduct;
  const anchorCategory = categoryAnchor ? inferProductSearchCategory(categoryAnchor) : null;

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

export function buildProductSearchResults(input: {
  hits: MilvusSearchHit[];
  products: ProductSearchProductInput[];
  favoriteProductGids: string[];
  limit: number;
}) {
  const productByGid = new Map(input.products.map((product) => [product.shopifyProductGid, product]));
  const dedupedHits = dedupeHitsByProduct(input.hits);
  const hits = filterHitsByDominantProductCategory(dedupedHits, productByGid).slice(0, input.limit);
  const mediaGidsByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.shopifyMediaGid]));
  const scoreByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.score]));
  const favoriteSet = new Set(input.favoriteProductGids);

  return hits
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
}

export async function runImageSearch(input: {
  prisma: PrismaClient;
  shopDomain: string;
  anonymousId: string;
  customerGid?: string | null;
  file: File;
  limit: number;
  availableOnly: boolean;
  requestTiming?: {
    requestStartedAtMs?: number;
    uploadParseMs?: number;
  };
}) {
  assertAllowedImageUpload({ contentType: input.file.type, byteSize: input.file.size });

  const timing = createImageSearchTiming(input.requestTiming);
  const config = getImageSearchConfig();
  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config, { shopDomain: input.shopDomain });
  const uploadStorage = createUploadStorage(config);
  const uploadId = randomUUID();
  const imageBytes = Buffer.from(await input.file.arrayBuffer());

  logger.info(
    {
      event: "image_search.request_started",
      shopDomain: input.shopDomain,
      uploadId,
      anonymousIdHash: hashLogValue(input.anonymousId),
      customerGidPresent: Boolean(input.customerGid),
      byteSize: input.file.size,
      contentType: input.file.type,
      limit: input.limit,
      availableOnly: input.availableOnly,
    },
    "image search request started",
  );

  const upload = await timing.measure("thumbnailMs", () =>
    uploadStorage.saveUpload({
      shopDomain: input.shopDomain,
      uploadId,
      imageBytes,
      contentType: input.file.type,
      originalFilename: input.file.name,
      storeOriginal: config.uploadStoreOriginals,
    }),
  );

  try {
    const embedding = await timing.measure("embeddingMs", () =>
      embeddingClient.embedImageBytes({
        imageBytes,
        filename: input.file.name || "upload",
        contentType: input.file.type,
      }),
    );
    const rawHits = await timing.measure("milvusSearchMs", () =>
      vectorStore.search({
        embedding: embedding.embedding,
        shopDomain: input.shopDomain,
        limit: Math.max(input.limit * 3, 36),
        availableOnly: input.availableOnly,
      }),
    );
    const { candidateHits, candidateProductGids } = await timing.measure("hitProcessingMs", async () => {
      const candidateHits = dedupeHitsByProduct(rawHits, {
        minScore: config.imageSearchMinSimilarityScore,
      });
      return {
        candidateHits,
        candidateProductGids: candidateHits.map((hit) => hit.shopifyProductGid),
      };
    });
    const favoriteGids = await timing.measure("favoriteLookupMs", () =>
      listFavoriteProductGids({
        prisma: input.prisma,
        shopDomain: input.shopDomain,
        identityType: input.customerGid ? "customer" : "anonymous",
        identityId: input.customerGid ?? input.anonymousId,
      }),
    );

    const products = await timing.measure("productLookupMs", () =>
      input.prisma.shopProduct.findMany({
        where: {
          shopDomain: input.shopDomain,
          shopifyProductGid: { in: candidateProductGids },
          status: "ACTIVE",
          ...(input.availableOnly ? { availableForSale: true } : {}),
        },
        include: { variants: true, images: true },
      }),
    );

    const results = await timing.measure("resultBuildMs", async () => {
      return buildProductSearchResults({
        hits: candidateHits,
        products,
        favoriteProductGids: favoriteGids,
        limit: input.limit,
      });
    });

    const searchUpload = await timing.measure("uploadHistoryMs", () =>
      createUploadHistory({
        prisma: input.prisma,
        shopDomain: input.shopDomain,
        anonymousId: input.anonymousId,
        customerGid: input.customerGid,
        thumbnailStorageKey: upload.thumbnailStorageKey,
        thumbnailUrl: upload.thumbnailUrl,
        originalImageStorageKey: upload.originalImageStorageKey,
        originalFilename: input.file.name,
        contentType: input.file.type,
        byteSize: input.file.size,
        searchStatus: "completed",
      }),
    );
    const recentUploads = await timing.measure("recentUploadsMs", () =>
      listRecentUploads({
        prisma: input.prisma,
        shopDomain: input.shopDomain,
        anonymousId: input.anonymousId,
        customerGid: input.customerGid,
        limit: 8,
      }),
    );

    const timingMeta = timing.complete();
    logger.info(
      {
        event: "image_search.completed",
        shopDomain: input.shopDomain,
        uploadId,
        searchUploadId: searchUpload.id,
        resultsCount: results.length,
        rawHitsCount: rawHits.length,
        candidateHitsCount: candidateHits.length,
        timing: timingMeta,
      },
      "image search request completed",
    );

    return {
      uploadId: searchUpload.id,
      results,
      favorites: favoriteGids,
      recentUploads,
      queryMeta: {
        embeddingModel: embedding.model,
        embeddingModelAlias: embedding.modelAlias ?? config.embeddingModelAlias,
        dimension: embedding.dimension,
        limit: input.limit,
        availableOnly: input.availableOnly,
        timing: timingMeta,
      },
    };
  } catch (error) {
    await createUploadHistory({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      thumbnailStorageKey: upload.thumbnailStorageKey,
      thumbnailUrl: upload.thumbnailUrl,
      originalImageStorageKey: upload.originalImageStorageKey,
      originalFilename: input.file.name,
      contentType: input.file.type,
      byteSize: input.file.size,
      searchStatus: "failed",
    });
    logger.error(
      {
        event: "image_search.failed",
        shopDomain: input.shopDomain,
        uploadId,
        ...errorLogFields(error),
      },
      "image search request failed",
    );
    throw error;
  }
}
