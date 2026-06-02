import type { PrismaClient, ShopProductImage } from "@prisma/client";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { createMilvusVectorId } from "../lib/image-search/hash.server";
import type { ProductIndexMode } from "../lib/image-search/types";
import { createEmbeddingClient } from "./embedding-client.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import {
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

export async function runProductImageIndexJob(input: {
  prisma: PrismaClient;
  admin: { graphql(query: string, options: unknown): Promise<Response> };
  mode: ProductIndexMode;
}) {
  const config = getImageSearchConfig();
  const fetched = await fetchShopifyProductsForIndex({
    admin: input.admin,
    query: DEVELOPMENT_SOURCE_FILTER.query,
    first: 25,
  });
  const job = await input.prisma.productIndexJob.create({
    data: {
      shopDomain: fetched.shopDomain,
      status: "running",
      mode: input.mode,
      sourceFilter: DEVELOPMENT_SOURCE_FILTER,
      startedAt: new Date(),
    },
  });

  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config);
  let variantsSeen = 0;
  let imagesSeen = 0;
  let imagesIndexed = 0;
  let imagesSkipped = 0;
  let imagesFailed = 0;

  try {
    for (const productNode of fetched.products) {
      const mapped = mapShopifyProductNode({
        shopDomain: fetched.shopDomain,
        currencyCode: fetched.currencyCode,
        product: productNode,
      });
      variantsSeen += mapped.variants.length;
      imagesSeen += mapped.images.length;
      const product = await upsertMappedProduct({ prisma: input.prisma, mapped });
      const dbImages = await input.prisma.shopProductImage.findMany({
        where: { productId: product.id },
        include: { product: { include: { variants: true } } },
      });

      for (const image of dbImages) {
        if (
          !shouldIndexImage({
            image,
            mode: input.mode,
            model: config.embeddingModel,
            dimension: config.embeddingDimension,
            collection: config.milvusCollection,
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
              milvusCollection: config.milvusCollection,
              milvusVectorId: vectorId,
              lastEmbeddedAt: new Date(),
              embeddingError: null,
            },
          });
          imagesIndexed += 1;
        } catch (error) {
          imagesFailed += 1;
          await input.prisma.shopProductImage.update({
            where: { id: image.id },
            data: {
              embeddingStatus: "failed",
              embeddingError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown embedding error",
            },
          });
        }
      }
    }

    return input.prisma.productIndexJob.update({
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
  } catch (error) {
    await input.prisma.productIndexJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unknown indexing error",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
