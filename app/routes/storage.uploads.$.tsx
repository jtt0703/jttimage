import type { LoaderFunctionArgs } from "react-router";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { errorLogFields, logger } from "../lib/logger.server";
import { createUploadStorage } from "../services/upload-storage.server";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const storageKey = params["*"];
  if (!storageKey) return new Response("Not found", { status: 404 });

  const config = getImageSearchConfig();
  const uploadStorage = createUploadStorage(config);
  logger.info(
    {
      event: "storage_uploads.read_started",
      storageProvider: config.uploadStorageProvider,
      storageKey,
    },
    "reading upload object",
  );

  try {
    const object = await uploadStorage.getObject(storageKey);
    if (!object) return new Response("Not found", { status: 404 });

    return new Response(new Uint8Array(object.body), {
      headers: {
        "Cache-Control": "public, max-age=31536000, immutable",
        "Content-Type": object.contentType,
      },
    });
  } catch (error) {
    logger.warn(
      {
        event: "storage_uploads.read_failed",
        storageProvider: config.uploadStorageProvider,
        storageKey,
        ...errorLogFields(error),
      },
      "failed to read upload object",
    );
    return new Response("Not found", { status: 404 });
  }
};
