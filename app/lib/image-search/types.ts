export type IdentityType = "anonymous" | "customer";
export type SourceSurface = "image_search" | "pdp_similar_products" | "wishlist" | "text_search" | "cart" | "chat";
export type EmbeddingStatus = "pending" | "processing" | "indexed" | "failed";
export type ProductIndexJobStatus = "queued" | "running" | "completed" | "failed";
export type ProductIndexMode = "incremental" | "force";

export interface ProductCardDTO {
  productGid: string;
  variantGid: string | null;
  variantId: string | null;
  title: string;
  handle: string;
  imageUrl: string | null;
  price: string | null;
  compareAtPrice: string | null;
  currencyCode: string | null;
  availableForSale: boolean;
  variantTitle: string | null;
  similarityScore: number | null;
  isFavorited: boolean;
}

export interface RecentUploadDTO {
  id: string;
  thumbnailUrl: string;
  createdAt: string;
}

export interface EmbeddingResponse {
  model: string;
  modelAlias?: string | null;
  dimension: number;
  embedding: number[];
}

export interface MilvusSearchHit {
  vectorId: string;
  shopifyProductGid: string;
  shopifyMediaGid: string;
  score: number;
}

export interface ImageSearchTimingMeta {
  totalMs: number;
  serviceMs: number;
  uploadParseMs?: number;
  thumbnailMs?: number;
  embeddingMs?: number;
  milvusSearchMs?: number;
  hitProcessingMs?: number;
  favoriteLookupMs?: number;
  productLookupMs?: number;
  resultBuildMs?: number;
  uploadHistoryMs?: number;
  recentUploadsMs?: number;
}

export interface ImageSearchConfig {
  milvusAddress: string;
  milvusUsername: string;
  milvusPassword: string;
  milvusCollection: string;
  milvusCollectionPrefix: string;
  milvusMetricType: "IP";
  embeddingServiceUrl: string;
  embeddingModel: string;
  embeddingModelAlias: string;
  embeddingDimension: number;
  embeddingRequestTimeoutMs: number;
  embeddingRequestRetries: number;
  embeddingCircuitFailureThreshold: number;
  embeddingCircuitResetMs: number;
  imageSearchMinSimilarityScore: number;
  imageSearchSyncTimeoutMs: number;
  uploadStorageProvider: "local" | "s3";
  uploadStorageLocalDir: string;
  uploadStoragePublicBaseUrl: string;
  uploadStoreOriginals: boolean;
  uploadStorageBucket: string;
  uploadStorageEndpoint: string;
  uploadStorageRegion: string;
  uploadStorageAccessKeyId: string;
  uploadStorageSecretAccessKey: string;
  uploadStorageForcePathStyle: boolean;
  productIndexQueueConcurrency: number;
  redisUrl: string;
  shopifyProductQuery: string;
  shopifyProductsPageSize: number;
  shopifyMediaPageSize: number;
  shopifyVariantsPageSize: number;
  shopifyAppProxyPrefix: string;
  storefrontCorsOrigins: string[];
}
