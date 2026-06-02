import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

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
  const thumbnail = await sharp(input.imageBytes)
    .rotate()
    .resize({ width: 240, height: 240, fit: "inside" })
    .webp({ quality: 82 })
    .toBuffer();
  await writeFile(absolutePath, thumbnail);

  const base = input.publicBaseUrl.replace(/\/$/, "");
  return {
    thumbnailStorageKey,
    thumbnailUrl: base ? `${base}/${thumbnailStorageKey}` : `/storage/uploads/${thumbnailStorageKey}`,
  };
}
