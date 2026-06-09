import type { PrismaClient, ShopProductImage } from "@prisma/client";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { createMilvusVectorId } from "../lib/image-search/hash.server";
import type { ProductIndexMode } from "../lib/image-search/types";
import { errorLogFields, logger } from "../lib/logger.server";
import { createEmbeddingClient } from "./embedding-client.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import {
  fetchShopifyProductForIndex,
  fetchShopifyProductsForIndex,
  mapShopifyProductNode,
  upsertMappedProduct,
} from "./shopify-product-sync.server";

export const DEVELOPMENT_SOURCE_FILTER = {
  query: "tag:lenscart-test status:active",
  mode: "development_test_products",
};

export function shouldIndexImage(input: {
  image: Pick<
    ShopProductImage,
    "embeddingStatus" | "embeddingModel" | "embeddingDimension" | "milvusCollection" | "milvusVectorId"
  >;
  mode: ProductIndexMode;
  model: string;
  dimension: number;
  collection: string;
}): boolean {
  if (input.mode === "force") return true;
  if (input.image.embeddingStatus !== "indexed") return true;
  if (input.image.embeddingModel !== input.model) return true;
  if (input.image.embeddingDimension !== input.dimension) return true;
  if (input.image.milvusCollection !== input.collection) return true;
  if (!input.image.milvusVectorId) return true;
  return false;
}

export function resolveProductIndexFetchInput(
  config: { shopifyProductQuery: string; shopifyProductsPageSize: number },
  sourceFilter: unknown,
): { query: string; first: number; productGid: string | null } {
  const filter =
    sourceFilter && typeof sourceFilter === "object" && !Array.isArray(sourceFilter)
      ? (sourceFilter as Record<string, unknown>)
      : {};
  const query = typeof filter.query === "string" && filter.query.trim() ? filter.query.trim() : config.shopifyProductQuery;
  const first =
    typeof filter.first === "number" && Number.isFinite(filter.first) && filter.first > 0
      ? Math.floor(filter.first)
      : config.shopifyProductsPageSize;
  const productGid =
    typeof filter.productGid === "string" && filter.productGid.startsWith("gid://shopify/Product/")
      ? filter.productGid
      : null;

  return { query, first, productGid };
}

export async function runProductImageIndexJob(input: {
  prisma: PrismaClient;
  admin: { graphql(query: string, options: unknown): Promise<Response> };
  mode?: ProductIndexMode;
  jobId?: string;
}) {
  const config = getImageSearchConfig();
  const existingJob = input.jobId
    ? await input.prisma.productIndexJob.findUnique({ where: { id: input.jobId } })
    : null;
  if (input.jobId && !existingJob) {
    throw new Error(`ProductIndexJob not found: ${input.jobId}`);
  }
  const mode: ProductIndexMode = existingJob?.mode === "force" || input.mode === "force" ? "force" : "incremental";
  const sourceFilter =
    existingJob?.sourceFilter ??
    ({
      query: config.shopifyProductQuery,
      mode: "configured_product_query",
      first: config.shopifyProductsPageSize,
    } as const);
  const fetchInput = resolveProductIndexFetchInput(config, sourceFilter);
  const fetched = fetchInput.productGid
    ? await fetchShopifyProductForIndex({
        admin: input.admin,
        productGid: fetchInput.productGid,
        mediaFirst: config.shopifyMediaPageSize,
        variantsFirst: config.shopifyVariantsPageSize,
      })
    : await fetchShopifyProductsForIndex({
        admin: input.admin,
        query: fetchInput.query,
        first: fetchInput.first,
        mediaFirst: config.shopifyMediaPageSize,
        variantsFirst: config.shopifyVariantsPageSize,
      });
  const job = input.jobId
    ? await input.prisma.productIndexJob.update({
        where: { id: input.jobId },
        data: {
          shopDomain: fetched.shopDomain,
          status: "running",
          mode,
          sourceFilter,
          startedAt: new Date(),
          completedAt: null,
          errorMessage: null,
        },
      })
    : await input.prisma.productIndexJob.create({
        data: {
          shopDomain: fetched.shopDomain,
          status: "running",
          mode,
          sourceFilter,
          startedAt: new Date(),
        },
      });

  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config, { shopDomain: fetched.shopDomain });
  let variantsSeen = 0;
  let imagesSeen = 0;
  let imagesIndexed = 0;
  let imagesSkipped = 0;
  let imagesFailed = 0;

  logger.info(
    {
      event: "product_index.started",
      jobId: job.id,
      shopDomain: fetched.shopDomain,
      mode,
      collectionName: vectorStore.collectionName,
      sourceFilter,
    },
    "product image index job started",
  );

  try {
    for (const productNode of fetched.products) {
      const mapped = mapShopifyProductNode({
        shopDomain: fetched.shopDomain,
        currencyCode: fetched.currencyCode,
        product: productNode,
      });
      variantsSeen += mapped.variants.length;
      imagesSeen += mapped.images.length;
      const product = await upsertMappedProduct({
        prisma: input.prisma,
        mapped,
        onStaleIndexedImage: async (image) => {
          if (image.milvusVectorId) {
            await vectorStore.deleteVectorById(image.milvusVectorId);
          }
        },
      });

      if (mapped.product.status !== "ACTIVE") {
        await vectorStore.deleteProductVectors({
          shopDomain: mapped.product.shopDomain,
          shopifyProductGid: mapped.product.shopifyProductGid,
        });
        await input.prisma.shopProductImage.updateMany({
          where: { productId: product.id },
          data: {
            embeddingStatus: "pending",
            milvusCollection: null,
            milvusVectorId: null,
            embeddingError: null,
          },
        });
        imagesSkipped += mapped.images.length;
        logger.info(
          {
            event: "product_index.inactive_product_vectors_deleted",
            jobId: job.id,
            shopDomain: mapped.product.shopDomain,
            shopifyProductGid: mapped.product.shopifyProductGid,
            status: mapped.product.status,
            collectionName: vectorStore.collectionName,
          },
          "inactive product vectors deleted",
        );
        continue;
      }

      const dbImages = await input.prisma.shopProductImage.findMany({
        where: { productId: product.id },
        include: { product: { include: { variants: true } } },
      });

      for (const image of dbImages) {
        if (
          !shouldIndexImage({
            image,
            mode,
            model: config.embeddingModel,
            dimension: config.embeddingDimension,
            collection: vectorStore.collectionName,
          })
        ) {
          imagesSkipped += 1;
          continue;
        }

        await input.prisma.shopProductImage.update({
          where: { id: image.id },
          data: { embeddingStatus: "processing", embeddingError: null },
        });

        try {
          const embedding = await embeddingClient.embedImageUrl(image.imageUrl);
          const vectorId = createMilvusVectorId({
            shopDomain: image.shopDomain,
            shopifyMediaGid: image.shopifyMediaGid,
            embeddingModel: embedding.model,
            embeddingDimension: embedding.dimension,
          });
          const defaultVariant =
            image.product.variants.find((variant) => variant.availableForSale) ?? image.product.variants[0] ?? null;
          await vectorStore.upsertProductImageVector({
            vectorId,
            embedding: embedding.embedding,
            shopDomain: image.shopDomain,
            shopifyProductGid: image.shopifyProductGid,
            shopifyMediaGid: image.shopifyMediaGid,
            shopifyVariantGid: defaultVariant?.shopifyVariantGid ?? null,
            availableForSale: image.product.availableForSale,
            productType: image.product.productType,
            status: image.product.status,
          });
          await input.prisma.shopProductImage.update({
            where: { id: image.id },
            data: {
              embeddingStatus: "indexed",
              embeddingProvider: "clip_http",
              embeddingModel: embedding.model,
              embeddingModelAlias: embedding.modelAlias ?? config.embeddingModelAlias,
              embeddingDimension: embedding.dimension,
              milvusCollection: vectorStore.collectionName,
              milvusVectorId: vectorId,
              lastEmbeddedAt: new Date(),
              embeddingError: null,
            },
          });
          imagesIndexed += 1;
          logger.info(
            {
              event: "product_index.image_indexed",
              jobId: job.id,
              shopDomain: image.shopDomain,
              shopifyProductGid: image.shopifyProductGid,
              shopifyMediaGid: image.shopifyMediaGid,
              vectorId,
              collectionName: vectorStore.collectionName,
            },
            "product image indexed",
          );
        } catch (error) {
          imagesFailed += 1;
          await input.prisma.shopProductImage.update({
            where: { id: image.id },
            data: {
              embeddingStatus: "failed",
              embeddingError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown embedding error",
            },
          });
          logger.warn(
            {
              event: "product_index.image_failed",
              jobId: job.id,
              shopDomain: image.shopDomain,
              shopifyProductGid: image.shopifyProductGid,
              shopifyMediaGid: image.shopifyMediaGid,
              collectionName: vectorStore.collectionName,
              ...errorLogFields(error),
            },
            "product image indexing failed",
          );
        }
      }
    }

    const completedJob = await input.prisma.productIndexJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        productsSeen: fetched.products.length,
        variantsSeen,
        imagesSeen,
        imagesIndexed,
        imagesSkipped,
        imagesFailed,
        completedAt: new Date(),
      },
    });
    logger.info(
      {
        event: "product_index.completed",
        jobId: job.id,
        shopDomain: fetched.shopDomain,
        productsSeen: fetched.products.length,
        variantsSeen,
        imagesSeen,
        imagesIndexed,
        imagesSkipped,
        imagesFailed,
        collectionName: vectorStore.collectionName,
      },
      "product image index job completed",
    );
    return completedJob;
  } catch (error) {
    await input.prisma.productIndexJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unknown indexing error",
        completedAt: new Date(),
      },
    });
    logger.error(
      {
        event: "product_index.failed",
        jobId: job.id,
        shopDomain: fetched.shopDomain,
        collectionName: vectorStore.collectionName,
        ...errorLogFields(error),
      },
      "product image index job failed",
    );
    throw error;
  }
}
