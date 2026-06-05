import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import type { ImageSearchConfig } from "../lib/image-search/types";
import { errorLogFields, logger } from "../lib/logger.server";

const THUMBNAIL_CONTENT_TYPE = "image/webp";

const EXTENSION_BY_CONTENT_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

export interface SaveUploadInput {
  shopDomain: string;
  uploadId: string;
  imageBytes: Buffer;
  contentType: string;
  originalFilename?: string | null;
  storeOriginal: boolean;
}

export interface SaveUploadResult {
  thumbnailStorageKey: string;
  thumbnailUrl: string;
  originalImageStorageKey: string | null;
}

export interface UploadObjectResult {
  body: Buffer;
  contentType: string;
}

export interface UploadStorage {
  saveUpload(input: SaveUploadInput): Promise<SaveUploadResult>;
  getObject(storageKey: string): Promise<UploadObjectResult | null>;
}

function normalizePublicBaseUrl(publicBaseUrl: string): string {
  return publicBaseUrl.replace(/\/$/, "");
}

function publicUrlForKey(config: ImageSearchConfig, storageKey: string): string {
  const base = normalizePublicBaseUrl(config.uploadStoragePublicBaseUrl);
  return base ? `${base}/${storageKey}` : `/storage/uploads/${storageKey}`;
}

function originalExtension(contentType: string): string {
  return EXTENSION_BY_CONTENT_TYPE[contentType] ?? "bin";
}

export async function createThumbnailWebp(imageBytes: Buffer): Promise<Buffer> {
  return sharp(imageBytes).rotate().resize({ width: 240, height: 240, fit: "inside" }).webp({ quality: 82 }).toBuffer();
}

function uploadKeys(input: Pick<SaveUploadInput, "shopDomain" | "uploadId" | "contentType">) {
  const prefix = `search/${input.shopDomain}/${input.uploadId}`;
  return {
    originalStorageKey: `${prefix}/original.${originalExtension(input.contentType)}`,
    thumbnailStorageKey: `${prefix}/thumbnail.webp`,
  };
}

function resolveLocalUploadPath(storageDir: string, storageKey: string): string | null {
  const root = path.resolve(process.cwd(), storageDir);
  const absolutePath = path.resolve(root, storageKey);
  const relativePath = path.relative(root, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

function contentTypeForStorageKey(storageKey: string): string | null {
  const extension = path.extname(storageKey).toLowerCase();
  if (extension === ".jpeg" || extension === ".jpg") return "image/jpeg";
  if (extension === ".png") return "image/png";
  if (extension === ".webp") return "image/webp";
  return null;
}

interface S3ClientLike {
  send(command: unknown): Promise<unknown>;
}

interface S3SdkLike {
  S3Client: new (config: unknown) => S3ClientLike;
  GetObjectCommand: new (input: unknown) => unknown;
  PutObjectCommand: new (input: unknown) => unknown;
}

function createS3Client(config: ImageSearchConfig): {
  client: S3ClientLike;
  GetObjectCommand: new (input: unknown) => unknown;
  PutObjectCommand: new (input: unknown) => unknown;
} {
  if (!config.uploadStorageAccessKeyId || !config.uploadStorageSecretAccessKey) {
    throw new Error("S3 upload storage requires UPLOAD_STORAGE_ACCESS_KEY_ID and UPLOAD_STORAGE_SECRET_ACCESS_KEY");
  }

  const require = createRequire(import.meta.url);
  const { S3Client, GetObjectCommand, PutObjectCommand } = require("@aws-sdk/client-s3") as S3SdkLike;
  return {
    client: new S3Client({
      endpoint: config.uploadStorageEndpoint || undefined,
      region: config.uploadStorageRegion,
      forcePathStyle: config.uploadStorageForcePathStyle,
      credentials: {
        accessKeyId: config.uploadStorageAccessKeyId,
        secretAccessKey: config.uploadStorageSecretAccessKey,
      },
    }),
    GetObjectCommand,
    PutObjectCommand,
  };
}

async function bodyToBuffer(body: unknown): Promise<Buffer> {
  if (!body) return Buffer.alloc(0);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof (body as { transformToByteArray?: unknown }).transformToByteArray === "function") {
    const bytes = await (body as { transformToByteArray(): Promise<Uint8Array> }).transformToByteArray();
    return Buffer.from(bytes);
  }
  const chunks: Buffer[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

function assertSafeStorageKey(storageKey: string): boolean {
  if (!storageKey || storageKey.includes("\0")) return false;
  const normalized = path.posix.normalize(storageKey);
  return normalized === storageKey && !normalized.startsWith("../") && !path.posix.isAbsolute(normalized);
}

export function createUploadStorage(config: ImageSearchConfig): UploadStorage {
  if (config.uploadStorageProvider === "s3") {
    const { client, GetObjectCommand, PutObjectCommand } = createS3Client(config);

    return {
      async saveUpload(input: SaveUploadInput): Promise<SaveUploadResult> {
        const startedAtMs = performance.now();
        const { originalStorageKey, thumbnailStorageKey } = uploadKeys(input);
        logger.info(
          {
            event: "upload_storage.save_started",
            storageProvider: "s3",
            bucket: config.uploadStorageBucket,
            shopDomain: input.shopDomain,
            uploadId: input.uploadId,
            byteSize: input.imageBytes.byteLength,
            contentType: input.contentType,
            originalStored: input.storeOriginal,
          },
          "saving upload objects to s3",
        );

        try {
          const thumbnail = await createThumbnailWebp(input.imageBytes);
          const writes = [
            client.send(
              new PutObjectCommand({
                Bucket: config.uploadStorageBucket,
                Key: thumbnailStorageKey,
                Body: thumbnail,
                ContentType: THUMBNAIL_CONTENT_TYPE,
                CacheControl: "public, max-age=31536000, immutable",
              }),
            ),
          ];

          if (input.storeOriginal) {
            writes.push(
              client.send(
                new PutObjectCommand({
                  Bucket: config.uploadStorageBucket,
                  Key: originalStorageKey,
                  Body: input.imageBytes,
                  ContentType: input.contentType,
                  CacheControl: "private, max-age=86400",
                  Metadata: input.originalFilename ? { originalFilename: input.originalFilename.slice(0, 255) } : undefined,
                }),
              ),
            );
          }

          await Promise.all(writes);
          logger.info(
            {
              event: "upload_storage.save_completed",
              storageProvider: "s3",
              bucket: config.uploadStorageBucket,
              shopDomain: input.shopDomain,
              uploadId: input.uploadId,
              thumbnailStorageKey,
              originalImageStorageKey: input.storeOriginal ? originalStorageKey : null,
              durationMs: Math.round(performance.now() - startedAtMs),
            },
            "upload objects saved to s3",
          );
          return {
            thumbnailStorageKey,
            thumbnailUrl: publicUrlForKey(config, thumbnailStorageKey),
            originalImageStorageKey: input.storeOriginal ? originalStorageKey : null,
          };
        } catch (error) {
          logger.error(
            {
              event: "upload_storage.save_failed",
              storageProvider: "s3",
              bucket: config.uploadStorageBucket,
              shopDomain: input.shopDomain,
              uploadId: input.uploadId,
              durationMs: Math.round(performance.now() - startedAtMs),
              ...errorLogFields(error),
            },
            "failed to save upload objects to s3",
          );
          throw error;
        }
      },

      async getObject(storageKey: string): Promise<UploadObjectResult | null> {
        if (!assertSafeStorageKey(storageKey)) return null;
        const contentType = contentTypeForStorageKey(storageKey);
        if (!contentType) return null;
        try {
          const response = await client.send(
            new GetObjectCommand({
              Bucket: config.uploadStorageBucket,
              Key: storageKey,
            }),
          );
          const object = response as { Body?: unknown; ContentType?: string };
          return {
            body: await bodyToBuffer(object.Body),
            contentType: object.ContentType ?? contentType,
          };
        } catch (error) {
          logger.warn(
            {
              event: "storage_uploads.read_failed",
              storageProvider: "s3",
              bucket: config.uploadStorageBucket,
              storageKey,
              ...errorLogFields(error),
            },
            "failed to read upload object from s3",
          );
          return null;
        }
      },
    };
  }

  return {
    async saveUpload(input: SaveUploadInput): Promise<SaveUploadResult> {
      const startedAtMs = performance.now();
      const { originalStorageKey, thumbnailStorageKey } = uploadKeys(input);
      logger.info(
        {
          event: "upload_storage.save_started",
          storageProvider: "local",
          shopDomain: input.shopDomain,
          uploadId: input.uploadId,
          byteSize: input.imageBytes.byteLength,
          contentType: input.contentType,
          originalStored: input.storeOriginal,
        },
        "saving upload objects locally",
      );

      try {
        const thumbnail = await createThumbnailWebp(input.imageBytes);
        const thumbnailPath = resolveLocalUploadPath(config.uploadStorageLocalDir, thumbnailStorageKey);
        if (!thumbnailPath) throw new Error("Invalid thumbnail storage key");
        await mkdir(path.dirname(thumbnailPath), { recursive: true });
        await writeFile(thumbnailPath, thumbnail);

        if (input.storeOriginal) {
          const originalPath = resolveLocalUploadPath(config.uploadStorageLocalDir, originalStorageKey);
          if (!originalPath) throw new Error("Invalid original storage key");
          await mkdir(path.dirname(originalPath), { recursive: true });
          await writeFile(originalPath, input.imageBytes);
        }

        logger.info(
          {
            event: "upload_storage.save_completed",
            storageProvider: "local",
            shopDomain: input.shopDomain,
            uploadId: input.uploadId,
            thumbnailStorageKey,
            originalImageStorageKey: input.storeOriginal ? originalStorageKey : null,
            durationMs: Math.round(performance.now() - startedAtMs),
          },
          "upload objects saved locally",
        );
        return {
          thumbnailStorageKey,
          thumbnailUrl: publicUrlForKey(config, thumbnailStorageKey),
          originalImageStorageKey: input.storeOriginal ? originalStorageKey : null,
        };
      } catch (error) {
        logger.error(
          {
            event: "upload_storage.save_failed",
            storageProvider: "local",
            shopDomain: input.shopDomain,
            uploadId: input.uploadId,
            durationMs: Math.round(performance.now() - startedAtMs),
            ...errorLogFields(error),
          },
          "failed to save upload objects locally",
        );
        throw error;
      }
    },

    async getObject(storageKey: string): Promise<UploadObjectResult | null> {
      if (!assertSafeStorageKey(storageKey)) return null;
      const contentType = contentTypeForStorageKey(storageKey);
      if (!contentType) return null;
      const absolutePath = resolveLocalUploadPath(config.uploadStorageLocalDir, storageKey);
      if (!absolutePath) return null;
      try {
        return {
          body: await readFile(absolutePath),
          contentType,
        };
      } catch {
        return null;
      }
    },
  };
}

export async function saveLocalThumbnail(input: {
  storageDir: string;
  publicBaseUrl: string;
  shopDomain: string;
  uploadId: string;
  imageBytes: Buffer;
}): Promise<{ thumbnailStorageKey: string; thumbnailUrl: string }> {
  const thumbnailStorageKey = `${input.shopDomain}/${input.uploadId}/thumbnail.webp`;
  const absolutePath = path.join(process.cwd(), input.storageDir, thumbnailStorageKey);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  const thumbnail = await createThumbnailWebp(input.imageBytes);
  await writeFile(absolutePath, thumbnail);

  const base = input.publicBaseUrl.replace(/\/$/, "");
  return {
    thumbnailStorageKey,
    thumbnailUrl: base ? `${base}/${thumbnailStorageKey}` : `/storage/uploads/${thumbnailStorageKey}`,
  };
}
