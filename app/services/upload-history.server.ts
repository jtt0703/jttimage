import type { PrismaClient } from "@prisma/client";
import type { RecentUploadDTO } from "../lib/image-search/types";

export async function createUploadHistory(input: {
  prisma: PrismaClient;
  shopDomain: string;
  anonymousId: string;
  customerGid?: string | null;
  thumbnailStorageKey: string;
  thumbnailUrl: string;
  originalImageStorageKey?: string | null;
  originalFilename?: string | null;
  contentType: string;
  byteSize: number;
  searchStatus: "completed" | "failed";
}) {
  return input.prisma.imageSearchUpload.create({
    data: {
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid ?? null,
      thumbnailStorageKey: input.thumbnailStorageKey,
      thumbnailUrl: input.thumbnailUrl,
      originalImageStorageKey: input.originalImageStorageKey ?? null,
      originalFilename: input.originalFilename ?? null,
      contentType: input.contentType,
      byteSize: input.byteSize,
      searchStatus: input.searchStatus,
    },
  });
}

export async function listRecentUploads(input: {
  prisma: PrismaClient;
  shopDomain: string;
  anonymousId: string;
  customerGid?: string | null;
  limit: number;
}): Promise<RecentUploadDTO[]> {
  const rows = await input.prisma.imageSearchUpload.findMany({
    where: {
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      searchStatus: "completed",
    },
    orderBy: { createdAt: "desc" },
    take: input.limit,
  });

  return rows.map((row) => ({
    id: row.id,
    thumbnailUrl: row.thumbnailUrl,
    createdAt: row.createdAt.toISOString(),
  }));
}
