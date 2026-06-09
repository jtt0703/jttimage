import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { addFavorite, deleteFavorite, listFavoriteProductGids, listFavoriteProducts } from "./favorites.server";

type FavoriteRow = {
  shopDomain: string;
  identityType: string;
  identityId: string;
  shopifyProductGid: string;
  shopifyVariantGid?: string | null;
  sourceSurface?: string;
  createdAt?: number;
};

type FavoriteWhere = Pick<FavoriteRow, "shopDomain" | "identityType" | "identityId"> & {
  shopifyProductGid?: string;
};

type ProductRow = {
  shopDomain: string;
  shopifyProductGid: string;
  title: string;
  handle: string;
  featuredImageUrl: string | null;
  minPrice: string;
  currencyCode: string;
  availableForSale: boolean;
  status: string;
  variants: {
    shopifyVariantGid: string;
    shopifyVariantNumericId: string;
    title: string;
    price: string;
    compareAtPrice: string | null;
    availableForSale: boolean;
  }[];
  images: {
    imageUrl: string;
    isFeatured: boolean;
  }[];
};

function fakePrisma(products: ProductRow[] = []): PrismaClient {
  const rows: FavoriteRow[] = [];
  let createdAt = 0;
  return {
    favoriteProduct: {
      findMany: vi.fn(async ({ where }: { where: FavoriteWhere }) => {
        const matches = rows.filter(
          (row) =>
            row.shopDomain === where.shopDomain &&
            row.identityType === where.identityType &&
            row.identityId === where.identityId,
        );
        return matches.sort((left, right) => (right.createdAt ?? 0) - (left.createdAt ?? 0));
      }),
      upsert: vi.fn(async ({ create }: { create: FavoriteRow }) => {
        const existing = rows.find(
          (row) =>
            row.shopDomain === create.shopDomain &&
            row.identityType === create.identityType &&
            row.identityId === create.identityId &&
            row.shopifyProductGid === create.shopifyProductGid,
        );
        if (existing) return existing;
        rows.push({ ...create, createdAt: (createdAt += 1) });
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: { where: FavoriteWhere }) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (
            row.shopDomain === where.shopDomain &&
            row.identityType === where.identityType &&
            row.identityId === where.identityId &&
            row.shopifyProductGid === where.shopifyProductGid
          )
            rows.splice(index, 1);
        }
        return { count: before - rows.length };
      }),
    },
    shopProduct: {
      findMany: vi.fn(async ({ where }: { where: { shopDomain: string; shopifyProductGid: { in: string[] }; status: string } }) =>
        products.filter(
          (product) =>
            product.shopDomain === where.shopDomain &&
            where.shopifyProductGid.in.includes(product.shopifyProductGid) &&
            product.status === where.status,
        ),
      ),
    },
  } as unknown as PrismaClient;
}

describe("favorites service", () => {
  it("adds favorites idempotently and lists by identity", async () => {
    const prisma = fakePrisma();
    await addFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-1",
      shopifyProductGid: "p1",
      shopifyVariantGid: "v1",
      sourceSurface: "image_search",
    });
    await addFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-1",
      shopifyProductGid: "p1",
      shopifyVariantGid: "v1",
      sourceSurface: "image_search",
    });
    await addFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-2",
      shopifyProductGid: "p2",
      shopifyVariantGid: "v2",
      sourceSurface: "image_search",
    });

    await expect(
      listFavoriteProductGids({
        prisma,
        shopDomain: "demo.myshopify.com",
        identityType: "anonymous",
        identityId: "id-1",
      }),
    ).resolves.toEqual(["p1"]);
  });

  it("deletes favorites idempotently", async () => {
    const prisma = fakePrisma();
    await deleteFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-1",
      shopifyProductGid: "missing",
    });
    await expect(
      listFavoriteProductGids({
        prisma,
        shopDomain: "demo.myshopify.com",
        identityType: "anonymous",
        identityId: "id-1",
      }),
    ).resolves.toEqual([]);
  });

  it("returns favorited product card details in newest-first favorite order", async () => {
    const prisma = fakePrisma([
      {
        shopDomain: "demo.myshopify.com",
        shopifyProductGid: "gid://shopify/Product/1",
        title: "Aviator Frame",
        handle: "aviator-frame",
        featuredImageUrl: "https://cdn.shopify.com/aviator-featured.jpg",
        minPrice: "99.00",
        currencyCode: "USD",
        availableForSale: true,
        status: "ACTIVE",
        variants: [
          {
            shopifyVariantGid: "gid://shopify/ProductVariant/11",
            shopifyVariantNumericId: "11",
            title: "Gold",
            price: "99.00",
            compareAtPrice: null,
            availableForSale: true,
          },
        ],
        images: [{ imageUrl: "https://cdn.shopify.com/aviator.jpg", isFeatured: true }],
      },
      {
        shopDomain: "demo.myshopify.com",
        shopifyProductGid: "gid://shopify/Product/2",
        title: "Round Frame",
        handle: "round-frame",
        featuredImageUrl: "https://cdn.shopify.com/round-featured.jpg",
        minPrice: "119.00",
        currencyCode: "USD",
        availableForSale: true,
        status: "ACTIVE",
        variants: [
          {
            shopifyVariantGid: "gid://shopify/ProductVariant/22",
            shopifyVariantNumericId: "22",
            title: "Black",
            price: "119.00",
            compareAtPrice: "149.00",
            availableForSale: true,
          },
        ],
        images: [{ imageUrl: "https://cdn.shopify.com/round.jpg", isFeatured: true }],
      },
    ]);
    await addFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-1",
      shopifyProductGid: "gid://shopify/Product/1",
      shopifyVariantGid: "gid://shopify/ProductVariant/11",
      sourceSurface: "image_search",
    });
    await addFavorite({
      prisma,
      shopDomain: "demo.myshopify.com",
      identityType: "anonymous",
      identityId: "id-1",
      shopifyProductGid: "gid://shopify/Product/2",
      shopifyVariantGid: "gid://shopify/ProductVariant/22",
      sourceSurface: "image_search",
    });

    await expect(
      listFavoriteProducts({
        prisma,
        shopDomain: "demo.myshopify.com",
        identityType: "anonymous",
        identityId: "id-1",
      }),
    ).resolves.toEqual({
      favorites: ["gid://shopify/Product/2", "gid://shopify/Product/1"],
      products: [
        expect.objectContaining({
          productGid: "gid://shopify/Product/2",
          variantId: "22",
          title: "Round Frame",
          handle: "round-frame",
          imageUrl: "https://cdn.shopify.com/round.jpg",
          price: "119.00",
          compareAtPrice: "149.00",
          currencyCode: "USD",
          isFavorited: true,
          similarityScore: null,
        }),
        expect.objectContaining({
          productGid: "gid://shopify/Product/1",
          variantId: "11",
          title: "Aviator Frame",
          handle: "aviator-frame",
          imageUrl: "https://cdn.shopify.com/aviator.jpg",
          price: "99.00",
          compareAtPrice: null,
          currencyCode: "USD",
          isFavorited: true,
          similarityScore: null,
        }),
      ],
    });
  });
});
