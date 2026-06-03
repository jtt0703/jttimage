import type { ImageSearchConfig } from "./types";

function stringEnv(name: string, fallback: string): string {
  return process.env[name] && process.env[name]!.trim().length > 0 ? process.env[name]!.trim() : fallback;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function floatEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return raw === "true";
}

export function getImageSearchConfig(): ImageSearchConfig {
  const uploadStorageProvider = stringEnv("UPLOAD_STORAGE_PROVIDER", "local");
  if (uploadStorageProvider !== "local" && uploadStorageProvider !== "s3") {
    throw new Error(`Invalid UPLOAD_STORAGE_PROVIDER: ${uploadStorageProvider}`);
  }

  return {
    milvusAddress: stringEnv("MILVUS_ADDRESS", "127.0.0.1:29530"),
    milvusUsername: stringEnv("MILVUS_USERNAME", "root"),
    milvusPassword: stringEnv("MILVUS_PASSWORD", ""),
    milvusCollection: stringEnv("MILVUS_COLLECTION", "product_image_embeddings_512"),
    milvusMetricType: "IP",
    embeddingServiceUrl: stringEnv("IMAGE_EMBEDDING_SERVICE_URL", "http://127.0.0.1:8001"),
    embeddingModel: stringEnv("IMAGE_EMBEDDING_MODEL", "openai/clip-vit-base-patch16"),
    embeddingModelAlias: stringEnv("IMAGE_EMBEDDING_MODEL_ALIAS", "clip-vit-b-16"),
    embeddingDimension: intEnv("IMAGE_EMBEDDING_DIMENSION", 512),
    imageSearchMinSimilarityScore: floatEnv("IMAGE_SEARCH_MIN_SIMILARITY_SCORE", 0.25),
    uploadStorageProvider,
    uploadStorageLocalDir: stringEnv("UPLOAD_STORAGE_LOCAL_DIR", "storage/uploads"),
    uploadStoragePublicBaseUrl: stringEnv("UPLOAD_STORAGE_PUBLIC_BASE_URL", ""),
    uploadStoreOriginals: boolEnv("UPLOAD_STORE_ORIGINALS", false),
    shopifyAppProxyPrefix: stringEnv("SHOPIFY_APP_PROXY_PREFIX", "/apps/lens-cart-ai"),
    storefrontCorsOrigins: stringEnv("STOREFRONT_CORS_ORIGINS", "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  };
}
