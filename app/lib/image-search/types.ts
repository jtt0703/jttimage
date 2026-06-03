export type IdentityType = "anonymous" | "customer";
export type SourceSurface = "image_search" | "pdp_similar_products" | "text_search" | "cart" | "chat";
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

export interface ImageSearchConfig {
  milvusAddress: string;
  milvusUsername: string;
  milvusPassword: string;
  milvusCollection: string;
  milvusMetricType: "IP";
  embeddingServiceUrl: string;
  embeddingModel: string;
  embeddingModelAlias: string;
  embeddingDimension: number;
  imageSearchMinSimilarityScore: number;
  uploadStorageProvider: "local" | "s3";
  uploadStorageLocalDir: string;
  uploadStoragePublicBaseUrl: string;
  uploadStoreOriginals: boolean;
  shopifyAppProxyPrefix: string;
  storefrontCorsOrigins: string[];
}
