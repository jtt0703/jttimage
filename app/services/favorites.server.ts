import type { PrismaClient } from "@prisma/client";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import type { IdentityType, ProductCardDTO, SourceSurface } from "../lib/image-search/types";

export async function listFavoriteProductGids(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
}): Promise<string[]> {
  const rows = await input.prisma.favoriteProduct.findMany({
    where: { shopDomain: input.shopDomain, identityType: input.identityType, identityId: input.identityId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => row.shopifyProductGid);
}

export async function listFavoriteProducts(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
}): Promise<{ favorites: string[]; products: ProductCardDTO[] }> {
  const favorites = await listFavoriteProductGids(input);
  if (!favorites.length) return { favorites, products: [] };

  const products = await input.prisma.shopProduct.findMany({
    where: {
      shopDomain: input.shopDomain,
      shopifyProductGid: { in: favorites },
      status: "ACTIVE",
    },
    include: { variants: true, images: true },
  });
  const productByGid = new Map(products.map((product) => [product.shopifyProductGid, product]));
  const cards = favorites
    .map((productGid) => {
      const product = productByGid.get(productGid);
      if (!product) return null;
      const image = product.images.find((item) => item.isFeatured) ?? product.images[0];
      return buildProductCardDTO({
        product,
        variants: product.variants,
        imageUrl: image?.imageUrl ?? product.featuredImageUrl,
        similarityScore: null,
        isFavorited: true,
      });
    })
    .filter((value): value is ProductCardDTO => Boolean(value));

  return { favorites, products: cards };
}

export async function addFavorite(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
  shopifyProductGid: string;
  shopifyVariantGid: string | null;
  sourceSurface: SourceSurface;
}) {
  await input.prisma.favoriteProduct.upsert({
    where: {
      shopDomain_identityType_identityId_shopifyProductGid: {
        shopDomain: input.shopDomain,
        identityType: input.identityType,
        identityId: input.identityId,
        shopifyProductGid: input.shopifyProductGid,
      },
    },
    update: { shopifyVariantGid: input.shopifyVariantGid, sourceSurface: input.sourceSurface },
    create: {
      shopDomain: input.shopDomain,
      identityType: input.identityType,
      identityId: input.identityId,
      shopifyProductGid: input.shopifyProductGid,
      shopifyVariantGid: input.shopifyVariantGid,
      sourceSurface: input.sourceSurface,
    },
  });
  return { favorited: true };
}

export async function deleteFavorite(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
  shopifyProductGid: string;
}) {
  await input.prisma.favoriteProduct.deleteMany({
    where: {
      shopDomain: input.shopDomain,
      identityType: input.identityType,
      identityId: input.identityId,
      shopifyProductGid: input.shopifyProductGid,
    },
  });
  return { favorited: false };
}
