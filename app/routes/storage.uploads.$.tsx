import { readFile } from "node:fs/promises";
import path from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { getImageSearchConfig } from "../lib/image-search/env.server";

const CONTENT_TYPES_BY_EXTENSION: Record<string, string> = {
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

function resolveUploadPath(storageDir: string, storageKey: string): string | null {
  const root = path.resolve(process.cwd(), storageDir);
  const absolutePath = path.resolve(root, storageKey);
  const relativePath = path.relative(root, absolutePath);

  if (!relativePath || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    return null;
  }

  return absolutePath;
}

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const storageKey = params["*"];
  if (!storageKey) return new Response("Not found", { status: 404 });

  const extension = path.extname(storageKey).toLowerCase();
  const contentType = CONTENT_TYPES_BY_EXTENSION[extension];
  if (!contentType) return new Response("Not found", { status: 404 });

  const config = getImageSearchConfig();
  const absolutePath = resolveUploadPath(config.uploadStorageLocalDir, storageKey);
  if (!absolutePath) return new Response("Not found", { status: 404 });

  try {
    const file = await readFile(absolutePath);
    return new Response(file, {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": contentType,
      },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
};
