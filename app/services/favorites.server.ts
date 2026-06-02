import type { PrismaClient } from "@prisma/client";
import type { IdentityType, SourceSurface } from "../lib/image-search/types";

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
