import { describe, expect, it, vi } from "vitest";
import { addFavorite, deleteFavorite, listFavoriteProductGids } from "./favorites.server";

function fakePrisma() {
  const rows: any[] = [];
  return {
    favoriteProduct: {
      findMany: vi.fn(async ({ where }: any) =>
        rows.filter(
          (row) =>
            row.shopDomain === where.shopDomain &&
            row.identityType === where.identityType &&
            row.identityId === where.identityId,
        ),
      ),
      upsert: vi.fn(async ({ create }: any) => {
        const existing = rows.find(
          (row) =>
            row.shopDomain === create.shopDomain &&
            row.identityType === create.identityType &&
            row.identityId === create.identityId &&
            row.shopifyProductGid === create.shopifyProductGid,
        );
        if (existing) return existing;
        rows.push(create);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
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
  } as any;
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
});
