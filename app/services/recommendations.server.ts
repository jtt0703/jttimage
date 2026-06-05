import type { PrismaClient, ShopProductImage } from "@prisma/client";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import { listFavoriteProductGids } from "./favorites.server";
import { dedupeHitsByProduct, filterHitsByDominantProductCategory } from "./image-search.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";

export function selectSourceIndexedImage<
  T extends Pick<ShopProductImage, "isFeatured" | "embeddingStatus" | "milvusVectorId">,
>(images: T[]): T | null {
  return (
    images.find((image) => image.isFeatured && image.embeddingStatus === "indexed" && image.milvusVectorId) ??
    images.find((image) => image.embeddingStatus === "indexed" && image.milvusVectorId) ??
    null
  );
}

export async function getSimilarProducts(input: {
  prisma: PrismaClient;
  shopDomain: string;
  productGid: string;
  anonymousId?: string | null;
  limit: number;
  availableOnly: boolean;
}) {
  const config = getImageSearchConfig();
  const vectorStore = createDefaultMilvusVectorStore(config, { shopDomain: input.shopDomain });
  const product = await input.prisma.shopProduct.findUnique({
    where: { shopDomain_shopifyProductGid: { shopDomain: input.shopDomain, shopifyProductGid: input.productGid } },
    include: { images: true },
  });

  if (!product) return { sourceProductGid: input.productGid, sourceMediaGid: null, results: [] };
  const sourceImage = selectSourceIndexedImage(product.images);
  if (!sourceImage?.milvusVectorId) return { sourceProductGid: input.productGid, sourceMediaGid: null, results: [] };

  const sourceEmbedding = await vectorStore.getVectorById(sourceImage.milvusVectorId);
  if (!sourceEmbedding)
    return { sourceProductGid: input.productGid, sourceMediaGid: sourceImage.shopifyMediaGid, results: [] };

  const rawHits = await vectorStore.search({
    embedding: sourceEmbedding,
    shopDomain: input.shopDomain,
    limit: Math.max(input.limit * 3, 30),
    availableOnly: input.availableOnly,
    excludeProductGid: input.productGid,
  });
  const candidateHits = dedupeHitsByProduct(rawHits);
  const favoriteGids = input.anonymousId
    ? await listFavoriteProductGids({
        prisma: input.prisma,
        shopDomain: input.shopDomain,
        identityType: "anonymous",
        identityId: input.anonymousId,
      })
    : [];
  const favoriteSet = new Set(favoriteGids);
  const products = await input.prisma.shopProduct.findMany({
    where: {
      shopDomain: input.shopDomain,
      shopifyProductGid: { in: candidateHits.map((hit) => hit.shopifyProductGid) },
      status: "ACTIVE",
      ...(input.availableOnly ? { availableForSale: true } : {}),
    },
    include: { variants: true, images: true },
  });
  const productByGid = new Map(products.map((row) => [row.shopifyProductGid, row]));
  const hits = filterHitsByDominantProductCategory(candidateHits, productByGid, product).slice(0, input.limit);
  const results = hits
    .map((hit) => {
      const row = productByGid.get(hit.shopifyProductGid);
      if (!row) return null;
      const image =
        row.images.find((item) => item.shopifyMediaGid === hit.shopifyMediaGid) ??
        row.images.find((item) => item.isFeatured) ??
        row.images[0];
      return buildProductCardDTO({
        product: row,
        variants: row.variants,
        imageUrl: image?.imageUrl ?? row.featuredImageUrl,
        similarityScore: hit.score,
        isFavorited: favoriteSet.has(row.shopifyProductGid),
      });
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  return { sourceProductGid: input.productGid, sourceMediaGid: sourceImage.shopifyMediaGid, results };
}
