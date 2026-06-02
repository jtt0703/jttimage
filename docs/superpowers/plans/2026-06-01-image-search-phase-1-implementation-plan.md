# Image Search Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first real Shopify storefront Image Search loop: merchant indexes Shopify product images, shoppers upload an image from the storefront, search results come from CLIP embeddings + Milvus + PostgreSQL, Add to Cart uses Shopify Ajax Cart, and PDPs show Similar Products.

**Architecture:** Keep Shopify business truth in PostgreSQL through Prisma, keep vector retrieval in Milvus only, and keep CLIP inference in a separate FastAPI service under `services/embedding`. The React Router app owns admin authentication, indexing orchestration, storefront API validation, database reads/writes, upload metadata, favorites, and DTO shaping; the Theme App Extension owns storefront UI, localStorage state, and `/cart/add.js` calls.

**Tech Stack:** Shopify React Router app, Prisma, PostgreSQL, TypeScript, Vitest, Python FastAPI, PyTorch, Hugging Face Transformers, Milvus, Theme App Extension Liquid/vanilla JavaScript/CSS.

---

## Source Design

Implement against `docs/superpowers/specs/2026-06-01-image-search-unified-design.md`. Do not use `2026-06-01-image-search-phase-1-merged-design.md` as implementation authority.

## Existing State

- Project root: `/Users/apple/Desktop/jttapp/lens-cart-ai`
- Current app is the Shopify React Router template.
- Prisma currently uses SQLite in `prisma/schema.prisma:11-14` and only has `Session`.
- Admin home template lives in `app/routes/app._index.tsx:1-364` and still creates demo products/metaobjects.
- There is no test runner script, no Milvus client, no embedding service, and no Theme App Extension beyond `extensions/.gitkeep`.
- React Router file routes are enabled by `app/routes.ts:1-3` with `flatRoutes()`.

## File Structure

### App dependencies and config

- Modify: `package.json`
  - Add test scripts.
  - Add runtime dependencies for Milvus, upload thumbnailing, and test-time HTTP mocking.
  - Add dev dependencies for Vitest.
- Modify: `.gitignore`
  - Ignore local upload storage and Python caches.
- Create: `.env.example`
  - Document non-secret development variables.

### Prisma and database

- Modify: `prisma/schema.prisma`
  - Switch datasource to PostgreSQL.
  - Preserve Shopify `Session` model used by `PrismaSessionStorage`.
  - Add `ShopProduct`, `ShopProductVariant`, `ShopProductImage`, `ProductIndexJob`, `ImageSearchUpload`, `FavoriteProduct`.
- Create via command: `prisma/migrations/<generated_timestamp>_image_search_phase_1/migration.sql`
  - Let Prisma generate the exact migration from the schema.

### Shared app contracts and utilities

- Create: `app/lib/image-search/env.server.ts`
  - Parse and validate server env values used by image search.
- Create: `app/lib/image-search/types.ts`
  - Define DTOs and service contracts shared across routes/services/tests.
- Create: `app/lib/image-search/validation.server.ts`
  - Validate shop domains, limits, identity, file type/size, and App Proxy signatures.
- Create: `app/lib/image-search/hash.server.ts`
  - Stable SHA-256 `vector_id` generation and image URL hashing.
- Create: `app/lib/image-search/product-card.server.ts`
  - Convert PostgreSQL product/variant/image rows into `ProductCardDTO`.
- Test: `app/lib/image-search/*.test.ts`

### Embedding client and service

- Create: `app/services/embedding-client.server.ts`
  - Node HTTP client for FastAPI `/health` and `/embed/image`.
  - Validates model, dimension, vector length, and vector norm.
- Test: `app/services/embedding-client.server.test.ts`
- Create: `services/embedding/pyproject.toml`
- Create: `services/embedding/README.md`
- Create: `services/embedding/app/main.py`
- Create: `services/embedding/tests/test_main.py`

### Milvus integration

- Create: `app/services/milvus-client.server.ts`
  - Collection initialization, upsert by delete+insert, search, vector lookup.
- Test: `app/services/milvus-client.server.test.ts`

### Shopify indexing

- Create: `app/services/shopify-product-sync.server.ts`
  - Admin GraphQL query and PostgreSQL upsert helpers.
- Create: `app/services/product-indexer.server.ts`
  - Job orchestration, embedding calls, Milvus writes, image status updates.
- Create: `app/routes/api.image-search.index-products.tsx`
  - Admin authenticated POST endpoint.
- Modify: `app/routes/app._index.tsx`
  - Replace demo template with Image Search Indexing page.
- Test: `app/services/shopify-product-sync.server.test.ts`
- Test: `app/services/product-indexer.server.test.ts`

### Storefront APIs

- Create: `app/services/upload-storage.server.ts`
  - Local thumbnail storage now; S3-compatible env contract prepared.
- Create: `app/services/favorites.server.ts`
  - Idempotent favorites list/add/delete.
- Create: `app/services/upload-history.server.ts`
  - Recent successful upload metadata.
- Create: `app/services/image-search.server.ts`
  - Search orchestration: file validation, thumbnail metadata, embedding, Milvus search, PostgreSQL filtering, favorites/recent uploads.
- Create: `app/services/recommendations.server.ts`
  - PDP Similar Products orchestration.
- Create: `app/routes/api.image-search.search.tsx`
- Create: `app/routes/api.recommendations.similar-products.tsx`
- Create: `app/routes/api.favorites.tsx`
- Create: `app/routes/api.favorites.delete.tsx`
- Create: `app/routes/api.upload-history.tsx`
- Test: `app/services/image-search.server.test.ts`
- Test: `app/services/recommendations.server.test.ts`
- Test: `app/services/favorites.server.test.ts`
- Test: `app/services/upload-history.server.test.ts`

### Theme App Extension

- Create: `extensions/lens-cart-ai-theme/shopify.extension.toml`
- Create: `extensions/lens-cart-ai-theme/blocks/image-search-app-embed.liquid`
- Create: `extensions/lens-cart-ai-theme/blocks/similar-products.liquid`
- Create: `extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js`
- Create: `extensions/lens-cart-ai-theme/assets/lens-cart-ai.css`

### Documentation

- Modify: `README.md`
  - Replace template-only local instructions with Image Search local run order.
- Create: `docs/image-search-phase-1-local-verification.md`
  - Manual end-to-end verification checklist.

---

## Task 1: Add test tooling and Image Search dependencies

**Files:**
- Modify: `package.json`
- Modify: `.gitignore`
- Create: `.env.example`

- [ ] **Step 1: Update `package.json` scripts and dependencies**

Edit `package.json` so the scripts and dependency blocks include these entries while preserving existing Shopify scripts:

```json
{
  "scripts": {
    "build": "react-router build",
    "dev": "shopify app dev",
    "config:link": "shopify app config link",
    "generate": "shopify app generate",
    "deploy": "shopify app deploy",
    "config:use": "shopify app config use",
    "env": "shopify app env",
    "start": "react-router-serve ./build/server/index.js",
    "docker-start": "npm run setup && npm run start",
    "setup": "prisma generate && prisma migrate deploy",
    "lint": "eslint --ignore-path .gitignore --cache --cache-location ./node_modules/.cache/eslint .",
    "shopify": "shopify",
    "prisma": "prisma",
    "graphql-codegen": "graphql-codegen",
    "vite": "vite",
    "typecheck": "react-router typegen && tsc --noEmit",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@zilliz/milvus2-sdk-node": "^2.6.0",
    "sharp": "^0.34.5"
  },
  "devDependencies": {
    "vitest": "^4.0.0"
  }
}
```

Expected final package still contains the existing dependencies such as `@shopify/shopify-app-react-router`, `@prisma/client`, `react`, and `vite`.

- [ ] **Step 2: Install Node dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` updates and `npm` exits with code 0.

- [ ] **Step 3: Extend `.gitignore`**

Append exactly these lines to `.gitignore`:

```gitignore

# Image Search local storage
/storage/uploads

# Python embedding service
services/embedding/.venv
services/embedding/__pycache__
services/embedding/.pytest_cache
services/embedding/app/__pycache__
services/embedding/tests/__pycache__
```

- [ ] **Step 4: Create `.env.example`**

Create `.env.example` with this content:

```env
DATABASE_URL=postgresql://app_user:app_password@127.0.0.1:25433/appdb

MILVUS_ADDRESS=127.0.0.1:29530
MILVUS_USERNAME=root
MILVUS_PASSWORD=milvus_password
MILVUS_COLLECTION=product_image_embeddings_512
MILVUS_METRIC_TYPE=IP

IMAGE_EMBEDDING_SERVICE_URL=http://127.0.0.1:8001
IMAGE_EMBEDDING_MODEL=openai/clip-vit-base-patch16
IMAGE_EMBEDDING_MODEL_ALIAS=clip-vit-b-16
IMAGE_EMBEDDING_DIMENSION=512

UPLOAD_STORAGE_PROVIDER=local
UPLOAD_STORAGE_LOCAL_DIR=storage/uploads
UPLOAD_STORAGE_PUBLIC_BASE_URL=
UPLOAD_STORE_ORIGINALS=false

UPLOAD_STORAGE_BUCKET=
UPLOAD_STORAGE_ENDPOINT=
UPLOAD_STORAGE_ACCESS_KEY_ID=
UPLOAD_STORAGE_SECRET_ACCESS_KEY=

SHOPIFY_APP_PROXY_PREFIX=/apps/lens-cart-ai
STOREFRONT_CORS_ORIGINS=http://127.0.0.1:9292,http://localhost:9292
```

- [ ] **Step 5: Run baseline checks**

Run:

```bash
npm run typecheck
npm run test
```

Expected after this task:

```txt
npm run typecheck: PASS
npm run test: PASS with 0 test files or no failing tests
```

- [ ] **Step 6: Commit**

Run:

```bash
git add package.json package-lock.json .gitignore .env.example
git commit -m "chore: add image search tooling"
```

Expected: commit succeeds. If the repository has no initial commit, make the initial commit with the same message.

---

## Task 2: Define PostgreSQL Prisma schema

**Files:**
- Modify: `prisma/schema.prisma`
- Generated by command: `prisma/migrations/*_image_search_phase_1/migration.sql`
- Test through: `npx prisma validate`, `npx prisma migrate dev --name image_search_phase_1`

- [ ] **Step 1: Replace datasource and add Image Search models**

Replace the entire content of `prisma/schema.prisma` with:

```prisma
generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model Session {
  id                  String    @id
  shop                String
  state               String
  isOnline            Boolean   @default(false)
  scope               String?
  expires             DateTime?
  accessToken         String
  userId              BigInt?
  firstName           String?
  lastName            String?
  email               String?
  accountOwner        Boolean   @default(false)
  locale              String?
  collaborator        Boolean?  @default(false)
  emailVerified       Boolean?  @default(false)
  refreshToken        String?
  refreshTokenExpires DateTime?
}

model ShopProduct {
  id                String               @id @default(uuid())
  shopDomain        String               @map("shop_domain")
  shopifyProductGid String               @map("shopify_product_gid")
  title             String
  handle            String
  status            String
  vendor            String?
  productType       String?              @map("product_type")
  tags              String[]             @default([])
  featuredImageUrl  String?              @map("featured_image_url")
  minPrice          Decimal?             @map("min_price") @db.Decimal(18, 2)
  currencyCode      String?              @map("currency_code")
  totalInventory    Int?                 @map("total_inventory")
  availableForSale  Boolean              @default(false) @map("available_for_sale")
  rawShopifyPayload Json                 @map("raw_shopify_payload")
  lastSyncedAt      DateTime             @map("last_synced_at")
  createdAt         DateTime             @default(now()) @map("created_at")
  updatedAt         DateTime             @updatedAt @map("updated_at")
  variants          ShopProductVariant[]
  images            ShopProductImage[]

  @@unique([shopDomain, shopifyProductGid])
  @@index([shopDomain, handle])
  @@map("shop_products")
}

model ShopProductVariant {
  id                      String      @id @default(uuid())
  productId               String      @map("product_id")
  shopDomain              String      @map("shop_domain")
  shopifyProductGid       String      @map("shopify_product_gid")
  shopifyVariantGid       String      @map("shopify_variant_gid")
  shopifyVariantNumericId String      @map("shopify_variant_numeric_id")
  title                   String
  sku                     String?
  price                   Decimal?    @db.Decimal(18, 2)
  compareAtPrice          Decimal?    @map("compare_at_price") @db.Decimal(18, 2)
  availableForSale        Boolean     @default(false) @map("available_for_sale")
  inventoryQuantity       Int?        @map("inventory_quantity")
  rawShopifyPayload       Json        @map("raw_shopify_payload")
  createdAt               DateTime    @default(now()) @map("created_at")
  updatedAt               DateTime    @updatedAt @map("updated_at")
  product                 ShopProduct @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([shopDomain, shopifyVariantGid])
  @@index([shopDomain, shopifyProductGid])
  @@map("shop_product_variants")
}

model ShopProductImage {
  id                  String      @id @default(uuid())
  productId           String      @map("product_id")
  shopDomain          String      @map("shop_domain")
  shopifyProductGid   String      @map("shopify_product_gid")
  shopifyMediaGid     String      @map("shopify_media_gid")
  shopifyImageGid     String?     @map("shopify_image_gid")
  imageUrl            String      @map("image_url")
  altText             String?     @map("alt_text")
  position            Int
  width               Int?
  height              Int?
  isFeatured          Boolean     @default(false) @map("is_featured")
  imageUrlHash        String      @map("image_url_hash")
  embeddingStatus     String      @default("pending") @map("embedding_status")
  embeddingProvider   String?     @map("embedding_provider")
  embeddingModel      String?     @map("embedding_model")
  embeddingModelAlias String?     @map("embedding_model_alias")
  embeddingDimension  Int?        @map("embedding_dimension")
  milvusCollection    String?     @map("milvus_collection")
  milvusVectorId      String?     @map("milvus_vector_id")
  lastEmbeddedAt      DateTime?   @map("last_embedded_at")
  embeddingError      String?     @map("embedding_error")
  createdAt           DateTime    @default(now()) @map("created_at")
  updatedAt           DateTime    @updatedAt @map("updated_at")
  product             ShopProduct @relation(fields: [productId], references: [id], onDelete: Cascade)

  @@unique([shopDomain, shopifyMediaGid])
  @@index([shopDomain, shopifyProductGid])
  @@index([shopDomain, embeddingStatus])
  @@index([milvusVectorId])
  @@map("shop_product_images")
}

model ProductIndexJob {
  id             String    @id @default(uuid())
  shopDomain     String    @map("shop_domain")
  status         String
  mode           String
  sourceFilter   Json      @map("source_filter")
  productsSeen   Int       @default(0) @map("products_seen")
  variantsSeen   Int       @default(0) @map("variants_seen")
  imagesSeen     Int       @default(0) @map("images_seen")
  imagesIndexed  Int       @default(0) @map("images_indexed")
  imagesSkipped  Int       @default(0) @map("images_skipped")
  imagesFailed   Int       @default(0) @map("images_failed")
  errorMessage   String?   @map("error_message")
  startedAt      DateTime? @map("started_at")
  completedAt    DateTime? @map("completed_at")
  createdAt      DateTime  @default(now()) @map("created_at")
  updatedAt      DateTime  @updatedAt @map("updated_at")

  @@index([shopDomain, createdAt])
  @@map("product_index_jobs")
}

model ImageSearchUpload {
  id                      String   @id @default(uuid())
  shopDomain              String   @map("shop_domain")
  anonymousId             String   @map("anonymous_id")
  customerGid             String?  @map("customer_gid")
  thumbnailStorageKey     String   @map("thumbnail_storage_key")
  thumbnailUrl            String   @map("thumbnail_url")
  originalImageStorageKey String?  @map("original_image_storage_key")
  originalFilename        String?  @map("original_filename")
  contentType             String   @map("content_type")
  byteSize                Int      @map("byte_size")
  searchStatus            String   @map("search_status")
  createdAt               DateTime @default(now()) @map("created_at")

  @@index([shopDomain, anonymousId, createdAt])
  @@index([shopDomain, customerGid, createdAt])
  @@map("image_search_uploads")
}

model FavoriteProduct {
  id                String   @id @default(uuid())
  shopDomain        String   @map("shop_domain")
  identityType      String   @map("identity_type")
  identityId        String   @map("identity_id")
  shopifyProductGid String   @map("shopify_product_gid")
  shopifyVariantGid String?  @map("shopify_variant_gid")
  sourceSurface     String   @map("source_surface")
  createdAt         DateTime @default(now()) @map("created_at")
  updatedAt         DateTime @updatedAt @map("updated_at")

  @@unique([shopDomain, identityType, identityId, shopifyProductGid])
  @@index([shopDomain, identityType, identityId])
  @@map("favorite_products")
}
```

- [ ] **Step 2: Validate schema**

Run:

```bash
npx prisma validate
```

Expected:

```txt
The Prisma schema is valid
```

- [ ] **Step 3: Generate migration against local PostgreSQL**

Ensure `.env` contains a reachable PostgreSQL `DATABASE_URL`, then run:

```bash
npx prisma migrate dev --name image_search_phase_1
```

Expected:

```txt
Applying migration `*_image_search_phase_1`
Generated Prisma Client
```

- [ ] **Step 4: Confirm generated SQL includes required tables and constraints**

Run:

```bash
npx prisma db execute --stdin <<'SQL'
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_name IN (
    'shop_products',
    'shop_product_variants',
    'shop_product_images',
    'product_index_jobs',
    'image_search_uploads',
    'favorite_products'
  )
ORDER BY table_name;
SQL
```

Expected output includes all six table names:

```txt
favorite_products
image_search_uploads
product_index_jobs
shop_product_images
shop_product_variants
shop_products
```

- [ ] **Step 5: Run checks**

Run:

```bash
npm run typecheck
npm run test
```

Expected: both commands pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add prisma/schema.prisma prisma/migrations package-lock.json package.json
git commit -m "feat: add image search database schema"
```

---

## Task 3: Add shared Image Search contracts and validation utilities

**Files:**
- Create: `app/lib/image-search/env.server.ts`
- Create: `app/lib/image-search/types.ts`
- Create: `app/lib/image-search/hash.server.ts`
- Create: `app/lib/image-search/validation.server.ts`
- Test: `app/lib/image-search/hash.server.test.ts`
- Test: `app/lib/image-search/validation.server.test.ts`

- [ ] **Step 1: Write hash utility tests**

Create `app/lib/image-search/hash.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createImageUrlHash, createMilvusVectorId } from "./hash.server";

describe("image search hash utilities", () => {
  it("creates a stable image url hash", () => {
    expect(createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1")).toBe(
      createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1"),
    );
    expect(createImageUrlHash("https://cdn.shopify.com/image.jpg?v=1")).not.toBe(
      createImageUrlHash("https://cdn.shopify.com/image.jpg?v=2"),
    );
  });

  it("uses canonical model and dimension for vector ids", () => {
    const vectorId = createMilvusVectorId({
      shopDomain: "demo.myshopify.com",
      shopifyMediaGid: "gid://shopify/MediaImage/123",
      embeddingModel: "openai/clip-vit-base-patch16",
      embeddingDimension: 512,
    });

    expect(vectorId).toMatch(/^[a-f0-9]{64}$/);
    expect(vectorId).toBe(
      createMilvusVectorId({
        shopDomain: "demo.myshopify.com",
        shopifyMediaGid: "gid://shopify/MediaImage/123",
        embeddingModel: "openai/clip-vit-base-patch16",
        embeddingDimension: 512,
      }),
    );
  });
});
```

- [ ] **Step 2: Write validation tests**

Create `app/lib/image-search/validation.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  assertAllowedImageUpload,
  normalizeLimit,
  parseBooleanParam,
  validateIdentity,
  validateShopDomain,
} from "./validation.server";

describe("image search validation", () => {
  it("accepts valid myshopify domains", () => {
    expect(validateShopDomain("demo-shop.myshopify.com")).toBe("demo-shop.myshopify.com");
  });

  it("rejects invalid shop domains", () => {
    expect(() => validateShopDomain("https://demo-shop.myshopify.com")).toThrow("Invalid shop domain");
    expect(() => validateShopDomain("demo.example.com")).toThrow("Invalid shop domain");
  });

  it("normalizes limit with defaults and max", () => {
    expect(normalizeLimit(null, 12, 48)).toBe(12);
    expect(normalizeLimit("9", 12, 48)).toBe(9);
    expect(normalizeLimit("999", 12, 48)).toBe(48);
    expect(normalizeLimit("abc", 12, 48)).toBe(12);
  });

  it("parses boolean params", () => {
    expect(parseBooleanParam(null, true)).toBe(true);
    expect(parseBooleanParam("true", false)).toBe(true);
    expect(parseBooleanParam("false", true)).toBe(false);
  });

  it("validates anonymous identity", () => {
    expect(
      validateIdentity({ identityType: "anonymous", identityId: "9f4030f7-8528-4e44-badf-6a8fd59ca7c9" }),
    ).toEqual({ identityType: "anonymous", identityId: "9f4030f7-8528-4e44-badf-6a8fd59ca7c9" });
  });

  it("rejects unsupported image uploads", () => {
    expect(() => assertAllowedImageUpload({ contentType: "image/gif", byteSize: 100 })).toThrow(
      "Please upload a JPG, PNG, or WebP image.",
    );
    expect(() => assertAllowedImageUpload({ contentType: "image/jpeg", byteSize: 5 * 1024 * 1024 + 1 })).toThrow(
      "Image is too large. Please upload a smaller image.",
    );
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
npx vitest run app/lib/image-search/hash.server.test.ts app/lib/image-search/validation.server.test.ts
```

Expected: FAIL because `hash.server.ts` and `validation.server.ts` do not exist.

- [ ] **Step 4: Create shared types**

Create `app/lib/image-search/types.ts`:

```ts
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
  uploadStorageProvider: "local" | "s3";
  uploadStorageLocalDir: string;
  uploadStoragePublicBaseUrl: string;
  uploadStoreOriginals: boolean;
  shopifyAppProxyPrefix: string;
  storefrontCorsOrigins: string[];
}
```

- [ ] **Step 5: Create env parser**

Create `app/lib/image-search/env.server.ts`:

```ts
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
```

- [ ] **Step 6: Create hash utility**

Create `app/lib/image-search/hash.server.ts`:

```ts
import { createHash } from "node:crypto";

export function createImageUrlHash(imageUrl: string): string {
  return createHash("sha256").update(imageUrl).digest("hex");
}

export function createMilvusVectorId(input: {
  shopDomain: string;
  shopifyMediaGid: string;
  embeddingModel: string;
  embeddingDimension: number;
}): string {
  return createHash("sha256")
    .update(`${input.shopDomain}::${input.shopifyMediaGid}::${input.embeddingModel}::${input.embeddingDimension}`)
    .digest("hex");
}
```

- [ ] **Step 7: Create validation utility**

Create `app/lib/image-search/validation.server.ts`:

```ts
import { createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityType } from "./types";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_GID_RE = /^gid:\/\/shopify\/Customer\/\d+$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function validateShopDomain(shop: string | null | undefined): string {
  if (!shop || !SHOP_DOMAIN_RE.test(shop)) {
    throw new Error("Invalid shop domain");
  }
  return shop;
}

export function normalizeLimit(raw: string | null, defaultLimit: number, maxLimit: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : defaultLimit;
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

export function parseBooleanParam(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function validateIdentity(input: { identityType?: string | null; identityId?: string | null }): {
  identityType: IdentityType;
  identityId: string;
} {
  const identityType = input.identityType ?? "anonymous";
  const identityId = input.identityId ?? "";

  if (identityType === "anonymous" && UUID_RE.test(identityId)) {
    return { identityType, identityId };
  }

  if (identityType === "customer" && CUSTOMER_GID_RE.test(identityId)) {
    return { identityType, identityId };
  }

  throw new Error("Invalid identity");
}

export function assertAllowedImageUpload(input: { contentType: string; byteSize: number }): void {
  if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }
  if (input.byteSize > MAX_UPLOAD_BYTES) {
    throw new Error("Image is too large. Please upload a smaller image.");
  }
}

export function verifyShopifyProxySignature(url: URL, secret: string): boolean {
  const signature = url.searchParams.get("signature");
  if (!signature || !secret) return false;

  const pairs: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const digest = createHmac("sha256", secret).update(pairs.join("")).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(signature, "utf8");

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
```

- [ ] **Step 8: Run tests**

Run:

```bash
npx vitest run app/lib/image-search/hash.server.test.ts app/lib/image-search/validation.server.test.ts
npm run typecheck
```

Expected: both Vitest tests and typecheck pass.

- [ ] **Step 9: Commit**

Run:

```bash
git add app/lib/image-search
 git commit -m "feat: add image search shared contracts"
```

If the shell rejects the command because of the leading space before `git`, rerun as:

```bash
git commit -m "feat: add image search shared contracts"
```

---

## Task 4: Build the Python FastAPI embedding service

**Files:**
- Create: `services/embedding/pyproject.toml`
- Create: `services/embedding/README.md`
- Create: `services/embedding/app/main.py`
- Create: `services/embedding/tests/test_main.py`

- [ ] **Step 1: Create Python package config**

Create `services/embedding/pyproject.toml`:

```toml
[project]
name = "lens-cart-ai-embedding"
version = "0.1.0"
description = "CLIP image embedding service for LensCart AI"
requires-python = ">=3.11"
dependencies = [
  "fastapi>=0.115.0",
  "uvicorn[standard]>=0.32.0",
  "python-multipart>=0.0.12",
  "pillow>=11.0.0",
  "requests>=2.32.0",
  "numpy<2",
  "torch==2.2.2",
  "transformers==4.46.3",
]

[project.optional-dependencies]
test = [
  "pytest>=8.3.0",
  "httpx>=0.28.0",
]

download = [
  "modelscope>=1.20.0",
]

[tool.pytest.ini_options]
pythonpath = ["."]
testpaths = ["tests"]
```

Note for this Intel macOS local environment: use `torch==2.2.2`, `numpy<2`, and `transformers==4.46.3` because PyTorch 2.5+ wheels are not available for the current `x86_64` macOS environment, and newer Transformers releases require newer Torch to load `.bin` weights. Restore `torch>=2.5.0` on Linux or Apple Silicon deployment and rerun embedding verification.

- [ ] **Step 2: Create FastAPI app tests**

Create `services/embedding/tests/test_main.py`:

```py
from io import BytesIO

from fastapi.testclient import TestClient
from PIL import Image

from app.main import MODEL_NAME, app, resolve_model_source


def make_png_bytes() -> bytes:
    image = Image.new("RGB", (8, 8), color=(255, 0, 0))
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return buffer.getvalue()


def test_health_returns_model_metadata():
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "ok": True,
        "model": "openai/clip-vit-base-patch16",
        "modelAlias": "clip-vit-b-16",
        "dimension": 512,
    }


def test_resolve_model_source_prefers_existing_local_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", str(tmp_path))

    assert resolve_model_source() == str(tmp_path)


def test_resolve_model_source_falls_back_to_model_name_for_missing_directory(monkeypatch, tmp_path):
    monkeypatch.setenv("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", str(tmp_path / "missing"))

    assert resolve_model_source() == MODEL_NAME


def test_embed_image_file_returns_normalized_512_vector(monkeypatch):
    def fake_embed_image(image):
        return [1.0] + [0.0] * 511

    monkeypatch.setattr("app.main.embed_image", fake_embed_image)
    client = TestClient(app)
    response = client.post(
        "/embed/image",
        files={"image": ("sample.png", make_png_bytes(), "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "openai/clip-vit-base-patch16"
    assert body["modelAlias"] == "clip-vit-b-16"
    assert body["dimension"] == 512
    assert len(body["embedding"]) == 512
    assert sum(value * value for value in body["embedding"]) == 1.0


def test_embed_image_rejects_empty_request():
    client = TestClient(app)
    response = client.post("/embed/image", json={})
    assert response.status_code == 400
    assert response.json()["detail"] == "Provide imageUrl or multipart image file"
```

- [ ] **Step 3: Run tests to verify they fail**

Run:

```bash
cd services/embedding
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest
```

Expected: FAIL because `services/embedding/app/main.py` does not exist.

- [ ] **Step 3A: Pre-download CLIP model from ModelScope**

Run:

```bash
cd services/embedding
. .venv/bin/activate
pip install -e '.[download]'
python -c "from modelscope import snapshot_download; print(snapshot_download('openai-mirror/clip-vit-base-patch16', cache_dir='/Users/apple/Desktop/test'))"
```

Expected: model files are available under:

```txt
/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch16
```

The embedding service should load this local directory before falling back to Hugging Face.

- [ ] **Step 4: Create FastAPI service**

Create `services/embedding/app/main.py`:

```py
from functools import lru_cache
from io import BytesIO
import math
import os
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import BaseModel
from PIL import Image
import requests
import torch
from transformers import CLIPModel, CLIPProcessor

MODEL_NAME = "openai/clip-vit-base-patch16"
MODEL_ALIAS = "clip-vit-b-16"
DIMENSION = 512
DEFAULT_LOCAL_MODEL_DIR = "/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch16"

app = FastAPI(title="LensCart AI Embedding Service")


class ImageUrlRequest(BaseModel):
    imageUrl: Optional[str] = None


class EmbeddingResponse(BaseModel):
    model: str
    modelAlias: str
    dimension: int
    embedding: list[float]


@lru_cache(maxsize=1)
def get_model_and_processor():
    model_source = resolve_model_source()
    model = CLIPModel.from_pretrained(model_source)
    processor = CLIPProcessor.from_pretrained(model_source)
    model.eval()
    return model, processor


def resolve_model_source() -> str:
    local_model_dir = os.environ.get("IMAGE_EMBEDDING_MODEL_LOCAL_DIR", DEFAULT_LOCAL_MODEL_DIR).strip()
    if local_model_dir and Path(local_model_dir).exists():
      return local_model_dir
    return MODEL_NAME


def load_image_from_bytes(data: bytes) -> Image.Image:
    try:
      image = Image.open(BytesIO(data)).convert("RGB")
      return image
    except Exception as exc:
      raise HTTPException(status_code=400, detail="Invalid image") from exc


def load_image_from_url(image_url: str) -> Image.Image:
    try:
      response = requests.get(image_url, timeout=20)
      response.raise_for_status()
      return load_image_from_bytes(response.content)
    except HTTPException:
      raise
    except Exception as exc:
      raise HTTPException(status_code=400, detail="Unable to fetch imageUrl") from exc


def l2_normalize(values: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in values))
    if norm == 0:
      raise HTTPException(status_code=500, detail="Embedding norm is zero")
    return [value / norm for value in values]


def embed_image(image: Image.Image) -> list[float]:
    model, processor = get_model_and_processor()
    inputs = processor(images=image, return_tensors="pt")
    with torch.no_grad():
      image_features = model.get_image_features(**inputs)
    vector = image_features[0].detach().cpu().float().tolist()
    if len(vector) != DIMENSION:
      raise HTTPException(status_code=500, detail="Unexpected embedding dimension")
    return l2_normalize(vector)


@app.get("/health")
def health():
    return {
      "ok": True,
      "model": MODEL_NAME,
      "modelAlias": MODEL_ALIAS,
      "dimension": DIMENSION,
    }


@app.post("/embed/image", response_model=EmbeddingResponse)
async def embed_image_endpoint(payload: Optional[ImageUrlRequest] = None, image: UploadFile | None = File(default=None)):
    if image is not None:
      image_bytes = await image.read()
      pil_image = load_image_from_bytes(image_bytes)
    elif payload is not None and payload.imageUrl:
      pil_image = load_image_from_url(payload.imageUrl)
    else:
      raise HTTPException(status_code=400, detail="Provide imageUrl or multipart image file")

    return EmbeddingResponse(
      model=MODEL_NAME,
      modelAlias=MODEL_ALIAS,
      dimension=DIMENSION,
      embedding=embed_image(pil_image),
    )
```

- [ ] **Step 5: Create service README**

Create `services/embedding/README.md`:

```md
# LensCart AI Embedding Service

Runs CLIP ViT-B/16 image embedding for the Shopify app backend.

## Local setup

```bash
cd services/embedding
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pip install modelscope
python -c "from modelscope import snapshot_download; print(snapshot_download('openai-mirror/clip-vit-base-patch16', cache_dir='/Users/apple/Desktop/test'))"
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

The service loads this local model directory first:

```txt
/Users/apple/Desktop/test/openai-mirror/clip-vit-base-patch16
```

Override it with `IMAGE_EMBEDDING_MODEL_LOCAL_DIR`.

## Verify

```bash
curl http://127.0.0.1:8001/health
pytest
```

Expected `/health` response:

```json
{"ok":true,"model":"openai/clip-vit-base-patch16","modelAlias":"clip-vit-b-16","dimension":512}
```
```

- [ ] **Step 6: Run Python tests**

Run:

```bash
cd services/embedding
. .venv/bin/activate
pytest
python -c "from app.main import get_model_and_processor, resolve_model_source; print(resolve_model_source()); get_model_and_processor(); print('model loaded')"
```

Expected:

```txt
3 passed
model loaded
```

- [ ] **Step 7: Smoke test service manually**

Run:

```bash
cd services/embedding
. .venv/bin/activate
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

In another terminal run:

```bash
curl -s http://127.0.0.1:8001/health
```

Expected JSON includes:

```json
{"ok":true,"model":"openai/clip-vit-base-patch16","modelAlias":"clip-vit-b-16","dimension":512}
```

Stop `uvicorn` with `Ctrl-C`.

- [ ] **Step 8: Commit**

Run:

```bash
git add services/embedding .gitignore
git commit -m "feat: add image embedding service"
```

---

## Task 5: Add Node embedding client

**Files:**
- Create: `app/services/embedding-client.server.ts`
- Test: `app/services/embedding-client.server.test.ts`

- [ ] **Step 1: Write embedding client tests**

Create `app/services/embedding-client.server.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingClient, validateEmbeddingResponse } from "./embedding-client.server";

const config = {
  embeddingServiceUrl: "http://embedding.test",
  embeddingModel: "openai/clip-vit-base-patch16",
  embeddingModelAlias: "clip-vit-b-16",
  embeddingDimension: 512,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("validateEmbeddingResponse", () => {
  it("accepts normalized 512 dimensional response", () => {
    const embedding = [1, ...Array(511).fill(0)];
    expect(
      validateEmbeddingResponse(
        { model: "openai/clip-vit-base-patch16", modelAlias: "other-alias", dimension: 512, embedding },
        config,
      ),
    ).toEqual({ model: "openai/clip-vit-base-patch16", modelAlias: "other-alias", dimension: 512, embedding });
  });

  it("rejects wrong canonical model", () => {
    expect(() =>
      validateEmbeddingResponse(
        { model: "wrong", modelAlias: "clip-vit-b-16", dimension: 512, embedding: [1, ...Array(511).fill(0)] },
        config,
      ),
    ).toThrow("Embedding model mismatch");
  });

  it("rejects non-normalized vector", () => {
    expect(() =>
      validateEmbeddingResponse(
        { model: "openai/clip-vit-base-patch16", modelAlias: "clip-vit-b-16", dimension: 512, embedding: [2, ...Array(511).fill(0)] },
        config,
      ),
    ).toThrow("Embedding norm mismatch");
  });
});

describe("createEmbeddingClient", () => {
  it("calls health endpoint", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    const client = createEmbeddingClient(config);
    await expect(client.health()).resolves.toEqual({ ok: true });
    expect(fetch).toHaveBeenCalledWith("http://embedding.test/health");
  });

  it("posts image urls as json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: "openai/clip-vit-base-patch16",
            modelAlias: "clip-vit-b-16",
            dimension: 512,
            embedding: [1, ...Array(511).fill(0)],
          }),
          { status: 200 },
        ),
      ),
    );
    const client = createEmbeddingClient(config);
    const result = await client.embedImageUrl("https://cdn.shopify.com/product.jpg");
    expect(result.dimension).toBe(512);
    expect(fetch).toHaveBeenCalledWith(
      "http://embedding.test/embed/image",
      expect.objectContaining({ method: "POST", headers: { "Content-Type": "application/json" } }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run app/services/embedding-client.server.test.ts
```

Expected: FAIL because `embedding-client.server.ts` does not exist.

- [ ] **Step 3: Create embedding client**

Create `app/services/embedding-client.server.ts`:

```ts
import type { EmbeddingResponse } from "../lib/image-search/types";

export interface EmbeddingClientConfig {
  embeddingServiceUrl: string;
  embeddingModel: string;
  embeddingModelAlias: string;
  embeddingDimension: number;
}

export function validateEmbeddingResponse(
  response: EmbeddingResponse,
  config: EmbeddingClientConfig,
): EmbeddingResponse {
  if (response.model !== config.embeddingModel) {
    throw new Error(`Embedding model mismatch: expected ${config.embeddingModel}, got ${response.model}`);
  }
  if (response.dimension !== config.embeddingDimension) {
    throw new Error(`Embedding dimension mismatch: expected ${config.embeddingDimension}, got ${response.dimension}`);
  }
  if (!Array.isArray(response.embedding) || response.embedding.length !== config.embeddingDimension) {
    throw new Error(`Embedding length mismatch: expected ${config.embeddingDimension}`);
  }

  const norm = Math.sqrt(response.embedding.reduce((sum, value) => sum + value * value, 0));
  if (Math.abs(norm - 1) > 0.01) {
    throw new Error(`Embedding norm mismatch: expected near 1, got ${norm}`);
  }

  if (response.modelAlias && response.modelAlias !== config.embeddingModelAlias) {
    console.warn(`Embedding alias mismatch: expected ${config.embeddingModelAlias}, got ${response.modelAlias}`);
  }

  return response;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Embedding service request failed: ${response.status} ${text}`);
  }
  return response.json();
}

export function createEmbeddingClient(config: EmbeddingClientConfig) {
  const baseUrl = config.embeddingServiceUrl.replace(/\/$/, "");

  return {
    async health(): Promise<unknown> {
      return parseJsonResponse(await fetch(`${baseUrl}/health`));
    },

    async embedImageUrl(imageUrl: string): Promise<EmbeddingResponse> {
      const body = await parseJsonResponse(
        await fetch(`${baseUrl}/embed/image`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        }),
      );
      return validateEmbeddingResponse(body as EmbeddingResponse, config);
    },

    async embedImageFile(file: File): Promise<EmbeddingResponse> {
      const formData = new FormData();
      formData.append("image", file, file.name || "upload");
      const body = await parseJsonResponse(
        await fetch(`${baseUrl}/embed/image`, {
          method: "POST",
          body: formData,
        }),
      );
      return validateEmbeddingResponse(body as EmbeddingResponse, config);
    },
  };
}
```

- [ ] **Step 4: Run tests**

Run:

```bash
npx vitest run app/services/embedding-client.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/services/embedding-client.server.ts app/services/embedding-client.server.test.ts
git commit -m "feat: add embedding service client"
```

---

## Task 6: Add Milvus client wrapper

**Files:**
- Create: `app/services/milvus-client.server.ts`
- Test: `app/services/milvus-client.server.test.ts`

- [ ] **Step 1: Write Milvus wrapper tests with a fake SDK client**

Create `app/services/milvus-client.server.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { createMilvusVectorStore } from "./milvus-client.server";

function createFakeClient() {
  return {
    hasCollection: vi.fn(async () => ({ value: false })),
    createCollection: vi.fn(async () => ({})),
    createIndex: vi.fn(async () => ({})),
    loadCollectionSync: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    insert: vi.fn(async () => ({})),
    flushSync: vi.fn(async () => ({})),
    search: vi.fn(async () => ({ results: [{ vector_id: "v1", shopify_product_gid: "p1", shopify_media_gid: "m1", score: 0.91 }] })),
    query: vi.fn(async () => ({ data: [{ vector_id: "v1", embedding: [1, ...Array(511).fill(0)] }] })),
  };
}

describe("createMilvusVectorStore", () => {
  it("creates collection if missing", async () => {
    const client = createFakeClient();
    const store = createMilvusVectorStore({ client, collectionName: "product_image_embeddings_512", dimension: 512 });
    await store.ensureCollection();
    expect(client.createCollection).toHaveBeenCalled();
    expect(client.createIndex).toHaveBeenCalled();
  });

  it("upserts by deleting vector id then inserting", async () => {
    const client = createFakeClient();
    client.hasCollection.mockResolvedValue({ value: true });
    const store = createMilvusVectorStore({ client, collectionName: "product_image_embeddings_512", dimension: 512 });
    await store.upsertProductImageVector({
      vectorId: "v1",
      embedding: [1, ...Array(511).fill(0)],
      shopDomain: "demo.myshopify.com",
      shopifyProductGid: "p1",
      shopifyMediaGid: "m1",
      shopifyVariantGid: "variant1",
      availableForSale: true,
      productType: "Sunglasses",
      status: "ACTIVE",
    });
    expect(client.delete).toHaveBeenCalledWith({ collection_name: "product_image_embeddings_512", filter: 'vector_id == "v1"' });
    expect(client.insert).toHaveBeenCalled();
  });

  it("searches with shop filter and available filter", async () => {
    const client = createFakeClient();
    client.hasCollection.mockResolvedValue({ value: true });
    const store = createMilvusVectorStore({ client, collectionName: "product_image_embeddings_512", dimension: 512 });
    const hits = await store.search({
      embedding: [1, ...Array(511).fill(0)],
      shopDomain: "demo.myshopify.com",
      limit: 12,
      availableOnly: true,
    });
    expect(hits).toEqual([{ vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "m1", score: 0.91 }]);
    expect(client.search).toHaveBeenCalledWith(expect.objectContaining({ filter: 'shop_domain == "demo.myshopify.com" && available_for_sale == true' }));
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run app/services/milvus-client.server.test.ts
```

Expected: FAIL because `milvus-client.server.ts` does not exist.

- [ ] **Step 3: Create Milvus wrapper**

Create `app/services/milvus-client.server.ts`:

```ts
import { MilvusClient } from "@zilliz/milvus2-sdk-node";
import type { MilvusSearchHit } from "../lib/image-search/types";

interface MilvusSdkLike {
  hasCollection(input: { collection_name: string }): Promise<{ value: boolean }>;
  createCollection(input: unknown): Promise<unknown>;
  createIndex(input: unknown): Promise<unknown>;
  loadCollectionSync(input: { collection_name: string }): Promise<unknown>;
  delete(input: { collection_name: string; filter: string }): Promise<unknown>;
  insert(input: { collection_name: string; data: unknown[] }): Promise<unknown>;
  flushSync(input: { collection_names: string[] }): Promise<unknown>;
  search(input: unknown): Promise<{ results?: unknown[] }>;
  query(input: unknown): Promise<{ data?: unknown[] }>;
}

export interface ProductImageVectorInput {
  vectorId: string;
  embedding: number[];
  shopDomain: string;
  shopifyProductGid: string;
  shopifyMediaGid: string;
  shopifyVariantGid: string | null;
  availableForSale: boolean;
  productType: string | null;
  status: string;
}

function escapeMilvusString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function shopFilter(shopDomain: string): string {
  return `shop_domain == "${escapeMilvusString(shopDomain)}"`;
}

export function createMilvusVectorStore(input: { client: MilvusSdkLike; collectionName: string; dimension: number }) {
  const { client, collectionName, dimension } = input;

  return {
    async ensureCollection(): Promise<void> {
      const exists = await client.hasCollection({ collection_name: collectionName });
      if (!exists.value) {
        await client.createCollection({
          collection_name: collectionName,
          fields: [
            { name: "vector_id", data_type: "VarChar", is_primary_key: true, max_length: 128 },
            { name: "embedding", data_type: "FloatVector", dim: dimension },
            { name: "shop_domain", data_type: "VarChar", max_length: 255 },
            { name: "shopify_product_gid", data_type: "VarChar", max_length: 255 },
            { name: "shopify_media_gid", data_type: "VarChar", max_length: 255 },
            { name: "shopify_variant_gid", data_type: "VarChar", max_length: 255 },
            { name: "available_for_sale", data_type: "Bool" },
            { name: "product_type", data_type: "VarChar", max_length: 255 },
            { name: "status", data_type: "VarChar", max_length: 64 },
            { name: "created_at_unix", data_type: "Int64" },
          ],
        });
        await client.createIndex({
          collection_name: collectionName,
          field_name: "embedding",
          index_name: "embedding_ip_index",
          metric_type: "IP",
          index_type: "HNSW",
          params: { M: 16, efConstruction: 200 },
        });
      }
      await client.loadCollectionSync({ collection_name: collectionName });
    },

    async upsertProductImageVector(vector: ProductImageVectorInput): Promise<void> {
      await this.ensureCollection();
      await client.delete({ collection_name: collectionName, filter: `vector_id == "${escapeMilvusString(vector.vectorId)}"` });
      await client.insert({
        collection_name: collectionName,
        data: [
          {
            vector_id: vector.vectorId,
            embedding: vector.embedding,
            shop_domain: vector.shopDomain,
            shopify_product_gid: vector.shopifyProductGid,
            shopify_media_gid: vector.shopifyMediaGid,
            shopify_variant_gid: vector.shopifyVariantGid ?? "",
            available_for_sale: vector.availableForSale,
            product_type: vector.productType ?? "",
            status: vector.status,
            created_at_unix: Math.floor(Date.now() / 1000),
          },
        ],
      });
      await client.flushSync({ collection_names: [collectionName] });
    },

    async search(input: { embedding: number[]; shopDomain: string; limit: number; availableOnly: boolean; excludeProductGid?: string }): Promise<MilvusSearchHit[]> {
      const filters = [shopFilter(input.shopDomain)];
      if (input.availableOnly) filters.push("available_for_sale == true");
      if (input.excludeProductGid) filters.push(`shopify_product_gid != "${escapeMilvusString(input.excludeProductGid)}"`);

      const response = await client.search({
        collection_name: collectionName,
        vector: input.embedding,
        anns_field: "embedding",
        metric_type: "IP",
        limit: input.limit,
        filter: filters.join(" && "),
        output_fields: ["vector_id", "shopify_product_gid", "shopify_media_gid"],
      });

      return (response.results ?? []).map((hit) => {
        const row = hit as Record<string, unknown>;
        return {
          vectorId: String(row.vector_id),
          shopifyProductGid: String(row.shopify_product_gid),
          shopifyMediaGid: String(row.shopify_media_gid),
          score: Number(row.score),
        };
      });
    },

    async getVectorById(vectorId: string): Promise<number[] | null> {
      const response = await client.query({
        collection_name: collectionName,
        filter: `vector_id == "${escapeMilvusString(vectorId)}"`,
        output_fields: ["vector_id", "embedding"],
        limit: 1,
      });
      const row = response.data?.[0] as { embedding?: number[] } | undefined;
      return row?.embedding ?? null;
    },
  };
}

export function createDefaultMilvusVectorStore(config: {
  milvusAddress: string;
  milvusUsername: string;
  milvusPassword: string;
  milvusCollection: string;
  embeddingDimension: number;
}) {
  const client = new MilvusClient({
    address: config.milvusAddress,
    username: config.milvusUsername || undefined,
    password: config.milvusPassword || undefined,
  });

  return createMilvusVectorStore({
    client,
    collectionName: config.milvusCollection,
    dimension: config.embeddingDimension,
  });
}
```

- [ ] **Step 4: Run tests and typecheck**

Run:

```bash
npx vitest run app/services/milvus-client.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 5: Commit**

Run:

```bash
git add app/services/milvus-client.server.ts app/services/milvus-client.server.test.ts
git commit -m "feat: add milvus vector store"
```

---

## Task 7: Add product card mapping and Shopify product sync service

**Files:**
- Create: `app/lib/image-search/product-card.server.ts`
- Test: `app/lib/image-search/product-card.server.test.ts`
- Create: `app/services/shopify-product-sync.server.ts`
- Test: `app/services/shopify-product-sync.server.test.ts`

- [ ] **Step 1: Write product card mapper test**

Create `app/lib/image-search/product-card.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildProductCardDTO } from "./product-card.server";

describe("buildProductCardDTO", () => {
  it("chooses first available variant and exposes numeric variant id", () => {
    const dto = buildProductCardDTO({
      product: {
        shopifyProductGid: "gid://shopify/Product/1",
        title: "Sunglasses",
        handle: "sunglasses",
        featuredImageUrl: "https://cdn.shopify.com/p.jpg",
        minPrice: { toString: () => "99.00" },
        currencyCode: "CAD",
        availableForSale: true,
      },
      variants: [
        { shopifyVariantGid: "gid://shopify/ProductVariant/1", shopifyVariantNumericId: "111", title: "Black", price: { toString: () => "99.00" }, compareAtPrice: null, availableForSale: false },
        { shopifyVariantGid: "gid://shopify/ProductVariant/2", shopifyVariantNumericId: "222", title: "Brown", price: { toString: () => "109.00" }, compareAtPrice: { toString: () => "129.00" }, availableForSale: true },
      ],
      imageUrl: "https://cdn.shopify.com/result.jpg",
      similarityScore: 0.91,
      isFavorited: true,
    });

    expect(dto).toEqual({
      productGid: "gid://shopify/Product/1",
      variantGid: "gid://shopify/ProductVariant/2",
      variantId: "222",
      title: "Sunglasses",
      handle: "sunglasses",
      imageUrl: "https://cdn.shopify.com/result.jpg",
      price: "109.00",
      compareAtPrice: "129.00",
      currencyCode: "CAD",
      availableForSale: true,
      variantTitle: "Brown",
      similarityScore: 0.91,
      isFavorited: true,
    });
  });
});
```

- [ ] **Step 2: Run mapper test to verify it fails**

Run:

```bash
npx vitest run app/lib/image-search/product-card.server.test.ts
```

Expected: FAIL because mapper does not exist.

- [ ] **Step 3: Create product card mapper**

Create `app/lib/image-search/product-card.server.ts`:

```ts
import type { ProductCardDTO } from "./types";

type DecimalLike = { toString(): string } | string | number | null | undefined;

interface ProductLike {
  shopifyProductGid: string;
  title: string;
  handle: string;
  featuredImageUrl: string | null;
  minPrice: DecimalLike;
  currencyCode: string | null;
  availableForSale: boolean;
}

interface VariantLike {
  shopifyVariantGid: string;
  shopifyVariantNumericId: string;
  title: string;
  price: DecimalLike;
  compareAtPrice: DecimalLike;
  availableForSale: boolean;
}

function decimalToString(value: DecimalLike): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function buildProductCardDTO(input: {
  product: ProductLike;
  variants: VariantLike[];
  imageUrl?: string | null;
  similarityScore: number | null;
  isFavorited: boolean;
}): ProductCardDTO {
  const variant = input.variants.find((item) => item.availableForSale) ?? input.variants[0] ?? null;

  return {
    productGid: input.product.shopifyProductGid,
    variantGid: variant?.shopifyVariantGid ?? null,
    variantId: variant?.shopifyVariantNumericId ?? null,
    title: input.product.title,
    handle: input.product.handle,
    imageUrl: input.imageUrl ?? input.product.featuredImageUrl,
    price: decimalToString(variant?.price ?? input.product.minPrice),
    compareAtPrice: decimalToString(variant?.compareAtPrice),
    currencyCode: input.product.currencyCode,
    availableForSale: input.product.availableForSale && Boolean(variant?.availableForSale),
    variantTitle: variant?.title ?? null,
    similarityScore: input.similarityScore,
    isFavorited: input.isFavorited,
  };
}
```

- [ ] **Step 4: Write Shopify product sync test**

Create `app/services/shopify-product-sync.server.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { mapShopifyProductNode } from "./shopify-product-sync.server";

describe("mapShopifyProductNode", () => {
  it("maps products, variants, legacy numeric ids, and media images", () => {
    const mapped = mapShopifyProductNode({
      shopDomain: "demo.myshopify.com",
      currencyCode: "CAD",
      product: {
        id: "gid://shopify/Product/1",
        title: "Sunglasses",
        handle: "sunglasses",
        status: "ACTIVE",
        vendor: "Lens Vendor",
        productType: "Sunglasses",
        tags: ["lenscart-test"],
        featuredMedia: { id: "gid://shopify/MediaImage/1", image: { id: "gid://shopify/Image/1", url: "https://cdn.shopify.com/1.jpg", altText: "front", width: 100, height: 100 } },
        media: { nodes: [{ id: "gid://shopify/MediaImage/1", image: { id: "gid://shopify/Image/1", url: "https://cdn.shopify.com/1.jpg", altText: "front", width: 100, height: 100 } }] },
        variants: { nodes: [{ id: "gid://shopify/ProductVariant/1", legacyResourceId: "1234567890", title: "Default Title", sku: "SKU", price: "244.00", compareAtPrice: null, availableForSale: true, inventoryQuantity: 5 }] },
      },
    });

    expect(mapped.product.shopifyProductGid).toBe("gid://shopify/Product/1");
    expect(mapped.product.minPrice).toBe("244.00");
    expect(mapped.product.availableForSale).toBe(true);
    expect(mapped.variants[0].shopifyVariantNumericId).toBe("1234567890");
    expect(mapped.images[0].isFeatured).toBe(true);
    expect(mapped.images[0].imageUrlHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 5: Run sync test to verify it fails**

Run:

```bash
npx vitest run app/services/shopify-product-sync.server.test.ts
```

Expected: FAIL because sync service does not exist.

- [ ] **Step 6: Create Shopify product sync service**

Create `app/services/shopify-product-sync.server.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { createImageUrlHash } from "../lib/image-search/hash.server";

export const IMAGE_SEARCH_PRODUCTS_QUERY = `#graphql
query ImageSearchProducts($query: String!, $first: Int!) {
  shop {
    myshopifyDomain
    currencyCode
  }
  products(first: $first, query: $query) {
    nodes {
      id
      title
      handle
      status
      vendor
      productType
      tags
      featuredMedia {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
            width
            height
          }
        }
      }
      media(first: 10) {
        nodes {
          ... on MediaImage {
            id
            image {
              id
              url
              altText
              width
              height
            }
          }
        }
      }
      variants(first: 10) {
        nodes {
          id
          legacyResourceId
          title
          sku
          price
          compareAtPrice
          availableForSale
          inventoryQuantity
        }
      }
    }
  }
}`;

type ShopifyProductNode = Record<string, any>;

export function mapShopifyProductNode(input: { shopDomain: string; currencyCode: string; product: ShopifyProductNode }) {
  const variants = input.product.variants.nodes.map((variant: Record<string, any>) => ({
    shopDomain: input.shopDomain,
    shopifyProductGid: input.product.id,
    shopifyVariantGid: variant.id,
    shopifyVariantNumericId: String(variant.legacyResourceId),
    title: variant.title,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    availableForSale: Boolean(variant.availableForSale),
    inventoryQuantity: variant.inventoryQuantity,
    rawShopifyPayload: variant,
  }));

  const prices = variants.map((variant: { price: string | null }) => Number.parseFloat(variant.price ?? "0")).filter(Number.isFinite);
  const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : null;
  const totalInventory = variants.reduce((sum: number, variant: { inventoryQuantity: number | null }) => sum + (variant.inventoryQuantity ?? 0), 0);
  const availableForSale = variants.some((variant: { availableForSale: boolean }) => variant.availableForSale);
  const featuredMediaId = input.product.featuredMedia?.id ?? null;

  const images = input.product.media.nodes
    .filter((media: Record<string, any>) => media?.image?.url)
    .map((media: Record<string, any>, index: number) => ({
      shopDomain: input.shopDomain,
      shopifyProductGid: input.product.id,
      shopifyMediaGid: media.id,
      shopifyImageGid: media.image.id ?? null,
      imageUrl: media.image.url,
      altText: media.image.altText ?? null,
      position: index + 1,
      width: media.image.width ?? null,
      height: media.image.height ?? null,
      isFeatured: media.id === featuredMediaId,
      imageUrlHash: createImageUrlHash(media.image.url),
    }));

  return {
    product: {
      shopDomain: input.shopDomain,
      shopifyProductGid: input.product.id,
      title: input.product.title,
      handle: input.product.handle,
      status: input.product.status,
      vendor: input.product.vendor ?? null,
      productType: input.product.productType ?? null,
      tags: input.product.tags ?? [],
      featuredImageUrl: input.product.featuredMedia?.image?.url ?? images[0]?.imageUrl ?? null,
      minPrice,
      currencyCode: input.currencyCode,
      totalInventory,
      availableForSale,
      rawShopifyPayload: input.product,
      lastSyncedAt: new Date(),
    },
    variants,
    images,
  };
}

export async function fetchShopifyProductsForIndex(input: {
  admin: { graphql(query: string, options: unknown): Promise<Response> };
  query: string;
  first: number;
}) {
  const response = await input.admin.graphql(IMAGE_SEARCH_PRODUCTS_QUERY, {
    variables: { query: input.query, first: input.first },
  });
  const body = await response.json();
  if (body.errors) {
    throw new Error(`Shopify Admin GraphQL failed: ${JSON.stringify(body.errors)}`);
  }
  return {
    shopDomain: body.data.shop.myshopifyDomain as string,
    currencyCode: body.data.shop.currencyCode as string,
    products: body.data.products.nodes as ShopifyProductNode[],
  };
}

export async function upsertMappedProduct(input: { prisma: PrismaClient; mapped: ReturnType<typeof mapShopifyProductNode> }) {
  const product = await input.prisma.shopProduct.upsert({
    where: {
      shopDomain_shopifyProductGid: {
        shopDomain: input.mapped.product.shopDomain,
        shopifyProductGid: input.mapped.product.shopifyProductGid,
      },
    },
    update: input.mapped.product,
    create: input.mapped.product,
  });

  for (const variant of input.mapped.variants) {
    await input.prisma.shopProductVariant.upsert({
      where: {
        shopDomain_shopifyVariantGid: {
          shopDomain: variant.shopDomain,
          shopifyVariantGid: variant.shopifyVariantGid,
        },
      },
      update: { ...variant, productId: product.id },
      create: { ...variant, productId: product.id },
    });
  }

  for (const image of input.mapped.images) {
    const existing = await input.prisma.shopProductImage.findUnique({
      where: {
        shopDomain_shopifyMediaGid: {
          shopDomain: image.shopDomain,
          shopifyMediaGid: image.shopifyMediaGid,
        },
      },
    });

    const shouldResetEmbedding = !existing || existing.imageUrlHash !== image.imageUrlHash;
    await input.prisma.shopProductImage.upsert({
      where: {
        shopDomain_shopifyMediaGid: {
          shopDomain: image.shopDomain,
          shopifyMediaGid: image.shopifyMediaGid,
        },
      },
      update: {
        ...image,
        productId: product.id,
        ...(shouldResetEmbedding ? { embeddingStatus: "pending", embeddingError: null } : {}),
      },
      create: { ...image, productId: product.id, embeddingStatus: "pending" },
    });
  }

  return product;
}
```

- [ ] **Step 7: Run tests**

Run:

```bash
npx vitest run app/lib/image-search/product-card.server.test.ts app/services/shopify-product-sync.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/lib/image-search/product-card.server.ts app/lib/image-search/product-card.server.test.ts app/services/shopify-product-sync.server.ts app/services/shopify-product-sync.server.test.ts
git commit -m "feat: add shopify product sync mapping"
```

---

## Task 8: Implement indexing orchestration and admin API

**Files:**
- Create: `app/services/product-indexer.server.ts`
- Test: `app/services/product-indexer.server.test.ts`
- Create: `app/routes/api.image-search.index-products.tsx`
- Modify: `app/routes/app._index.tsx`

- [ ] **Step 1: Write indexer unit test**

Create `app/services/product-indexer.server.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { shouldIndexImage } from "./product-indexer.server";

describe("shouldIndexImage", () => {
  const baseImage = {
    embeddingStatus: "indexed",
    embeddingModel: "openai/clip-vit-base-patch16",
    embeddingDimension: 512,
    milvusCollection: "product_image_embeddings_512",
    milvusVectorId: "vector-id",
  };

  it("indexes when mode is force", () => {
    expect(shouldIndexImage({ image: baseImage, mode: "force", model: "openai/clip-vit-base-patch16", dimension: 512, collection: "product_image_embeddings_512" })).toBe(true);
  });

  it("skips already indexed current images", () => {
    expect(shouldIndexImage({ image: baseImage, mode: "incremental", model: "openai/clip-vit-base-patch16", dimension: 512, collection: "product_image_embeddings_512" })).toBe(false);
  });

  it("indexes failed or stale images", () => {
    expect(shouldIndexImage({ image: { ...baseImage, embeddingStatus: "failed" }, mode: "incremental", model: "openai/clip-vit-base-patch16", dimension: 512, collection: "product_image_embeddings_512" })).toBe(true);
    expect(shouldIndexImage({ image: { ...baseImage, embeddingDimension: 1024 }, mode: "incremental", model: "openai/clip-vit-base-patch16", dimension: 512, collection: "product_image_embeddings_512" })).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run app/services/product-indexer.server.test.ts
```

Expected: FAIL because indexer does not exist.

- [ ] **Step 3: Create product indexer service**

Create `app/services/product-indexer.server.ts`:

```ts
import type { PrismaClient, ShopProductImage } from "@prisma/client";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { createMilvusVectorId } from "../lib/image-search/hash.server";
import type { ProductIndexMode } from "../lib/image-search/types";
import { createEmbeddingClient } from "./embedding-client.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import { fetchShopifyProductsForIndex, mapShopifyProductNode, upsertMappedProduct } from "./shopify-product-sync.server";

export const DEVELOPMENT_SOURCE_FILTER = {
  query: "tag:lenscart-test status:active",
  mode: "development_test_products",
};

export function shouldIndexImage(input: {
  image: Pick<ShopProductImage, "embeddingStatus" | "embeddingModel" | "embeddingDimension" | "milvusCollection" | "milvusVectorId">;
  mode: ProductIndexMode;
  model: string;
  dimension: number;
  collection: string;
}): boolean {
  if (input.mode === "force") return true;
  if (input.image.embeddingStatus !== "indexed") return true;
  if (input.image.embeddingModel !== input.model) return true;
  if (input.image.embeddingDimension !== input.dimension) return true;
  if (input.image.milvusCollection !== input.collection) return true;
  if (!input.image.milvusVectorId) return true;
  return false;
}

export async function runProductImageIndexJob(input: {
  prisma: PrismaClient;
  admin: { graphql(query: string, options: unknown): Promise<Response> };
  mode: ProductIndexMode;
}) {
  const config = getImageSearchConfig();
  const fetched = await fetchShopifyProductsForIndex({ admin: input.admin, query: DEVELOPMENT_SOURCE_FILTER.query, first: 25 });
  const job = await input.prisma.productIndexJob.create({
    data: {
      shopDomain: fetched.shopDomain,
      status: "running",
      mode: input.mode,
      sourceFilter: DEVELOPMENT_SOURCE_FILTER,
      startedAt: new Date(),
    },
  });

  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config);
  let variantsSeen = 0;
  let imagesSeen = 0;
  let imagesIndexed = 0;
  let imagesSkipped = 0;
  let imagesFailed = 0;

  try {
    for (const productNode of fetched.products) {
      const mapped = mapShopifyProductNode({ shopDomain: fetched.shopDomain, currencyCode: fetched.currencyCode, product: productNode });
      variantsSeen += mapped.variants.length;
      imagesSeen += mapped.images.length;
      const product = await upsertMappedProduct({ prisma: input.prisma, mapped });
      const dbImages = await input.prisma.shopProductImage.findMany({ where: { productId: product.id }, include: { product: { include: { variants: true } } } });

      for (const image of dbImages) {
        if (!shouldIndexImage({ image, mode: input.mode, model: config.embeddingModel, dimension: config.embeddingDimension, collection: config.milvusCollection })) {
          imagesSkipped += 1;
          continue;
        }

        await input.prisma.shopProductImage.update({ where: { id: image.id }, data: { embeddingStatus: "processing", embeddingError: null } });

        try {
          const embedding = await embeddingClient.embedImageUrl(image.imageUrl);
          const vectorId = createMilvusVectorId({
            shopDomain: image.shopDomain,
            shopifyMediaGid: image.shopifyMediaGid,
            embeddingModel: embedding.model,
            embeddingDimension: embedding.dimension,
          });
          const defaultVariant = image.product.variants.find((variant) => variant.availableForSale) ?? image.product.variants[0] ?? null;
          await vectorStore.upsertProductImageVector({
            vectorId,
            embedding: embedding.embedding,
            shopDomain: image.shopDomain,
            shopifyProductGid: image.shopifyProductGid,
            shopifyMediaGid: image.shopifyMediaGid,
            shopifyVariantGid: defaultVariant?.shopifyVariantGid ?? null,
            availableForSale: image.product.availableForSale,
            productType: image.product.productType,
            status: image.product.status,
          });
          await input.prisma.shopProductImage.update({
            where: { id: image.id },
            data: {
              embeddingStatus: "indexed",
              embeddingProvider: "clip_http",
              embeddingModel: embedding.model,
              embeddingModelAlias: embedding.modelAlias ?? config.embeddingModelAlias,
              embeddingDimension: embedding.dimension,
              milvusCollection: config.milvusCollection,
              milvusVectorId: vectorId,
              lastEmbeddedAt: new Date(),
              embeddingError: null,
            },
          });
          imagesIndexed += 1;
        } catch (error) {
          imagesFailed += 1;
          await input.prisma.shopProductImage.update({
            where: { id: image.id },
            data: { embeddingStatus: "failed", embeddingError: error instanceof Error ? error.message.slice(0, 1000) : "Unknown embedding error" },
          });
        }
      }
    }

    return input.prisma.productIndexJob.update({
      where: { id: job.id },
      data: {
        status: "completed",
        productsSeen: fetched.products.length,
        variantsSeen,
        imagesSeen,
        imagesIndexed,
        imagesSkipped,
        imagesFailed,
        completedAt: new Date(),
      },
    });
  } catch (error) {
    await input.prisma.productIndexJob.update({
      where: { id: job.id },
      data: {
        status: "failed",
        errorMessage: error instanceof Error ? error.message.slice(0, 1000) : "Unknown indexing error",
        completedAt: new Date(),
      },
    });
    throw error;
  }
}
```

- [ ] **Step 4: Create admin index API route**

Create `app/routes/api.image-search.index-products.tsx`:

```ts
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { runProductImageIndexJob } from "../services/product-indexer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "force" ? "force" : "incremental";
  const job = await runProductImageIndexJob({ prisma, admin, mode });

  return Response.json({
    jobId: job.id,
    status: job.status,
    productsSeen: job.productsSeen,
    variantsSeen: job.variantsSeen,
    imagesSeen: job.imagesSeen,
    imagesIndexed: job.imagesIndexed,
    imagesSkipped: job.imagesSkipped,
    imagesFailed: job.imagesFailed,
  });
};
```

- [ ] **Step 5: Replace admin home with indexing UI**

Replace `app/routes/app._index.tsx` with:

```tsx
import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const lastJob = await prisma.productIndexJob.findFirst({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return { lastJob };
};

export default function Index() {
  const { lastJob } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    const data = fetcher.data as { status?: string; imagesFailed?: number } | undefined;
    if (data?.status === "completed") {
      shopify.toast.show(data.imagesFailed && data.imagesFailed > 0 ? "Index completed with failed images" : "Index completed");
    }
  }, [fetcher.data, shopify]);

  function startIndex(mode: "incremental" | "force") {
    fetcher.submit(JSON.stringify({ mode }), {
      method: "POST",
      action: "/api/image-search/index-products",
      encType: "application/json",
    });
  }

  const currentJob = (fetcher.data as typeof lastJob | undefined) ?? lastJob;

  return (
    <s-page heading="Image Search Indexing">
      <s-section heading="Product image index">
        <s-paragraph>
          Index Shopify products tagged with <s-text tone="strong">lenscart-test</s-text> and status <s-text tone="strong">active</s-text> during development.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => startIndex("incremental")} {...(isLoading ? { loading: true } : {})}>
            Index product images
          </s-button>
          <s-button variant="secondary" onClick={() => startIndex("force")} {...(isLoading ? { loading: true } : {})}>
            Re-index product images
          </s-button>
        </s-stack>
      </s-section>

      <s-section heading="Last index job">
        {currentJob ? (
          <s-stack direction="block" gap="small">
            <s-paragraph>Status: {currentJob.status}</s-paragraph>
            <s-paragraph>Mode: {currentJob.mode}</s-paragraph>
            <s-paragraph>Products seen: {currentJob.productsSeen}</s-paragraph>
            <s-paragraph>Variants seen: {currentJob.variantsSeen}</s-paragraph>
            <s-paragraph>Images seen: {currentJob.imagesSeen}</s-paragraph>
            <s-paragraph>Images indexed: {currentJob.imagesIndexed}</s-paragraph>
            <s-paragraph>Images skipped: {currentJob.imagesSkipped}</s-paragraph>
            <s-paragraph>Images failed: {currentJob.imagesFailed}</s-paragraph>
            <s-paragraph>Started at: {currentJob.startedAt ? new Date(currentJob.startedAt).toLocaleString() : "Not started"}</s-paragraph>
            <s-paragraph>Completed at: {currentJob.completedAt ? new Date(currentJob.completedAt).toLocaleString() : "Not completed"}</s-paragraph>
            {currentJob.errorMessage ? <s-paragraph tone="critical">Error: {currentJob.errorMessage}</s-paragraph> : null}
          </s-stack>
        ) : (
          <s-paragraph>No index jobs yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
```

- [ ] **Step 6: Run checks**

Run:

```bash
npx vitest run app/services/product-indexer.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/services/product-indexer.server.ts app/services/product-indexer.server.test.ts app/routes/api.image-search.index-products.tsx app/routes/app._index.tsx
git commit -m "feat: add product image indexing"
```

---

## Task 9: Implement upload storage, favorites, and upload history services

**Files:**
- Create: `app/services/upload-storage.server.ts`
- Create: `app/services/favorites.server.ts`
- Create: `app/services/upload-history.server.ts`
- Test: `app/services/favorites.server.test.ts`
- Test: `app/services/upload-history.server.test.ts`

- [ ] **Step 1: Write favorites service tests**

Create `app/services/favorites.server.test.ts` with a fake Prisma adapter:

```ts
import { describe, expect, it, vi } from "vitest";
import { addFavorite, deleteFavorite, listFavoriteProductGids } from "./favorites.server";

function fakePrisma() {
  const rows: any[] = [];
  return {
    favoriteProduct: {
      findMany: vi.fn(async ({ where }: any) => rows.filter((row) => row.shopDomain === where.shopDomain && row.identityType === where.identityType && row.identityId === where.identityId)),
      upsert: vi.fn(async ({ create }: any) => {
        const existing = rows.find((row) => row.shopDomain === create.shopDomain && row.identityType === create.identityType && row.identityId === create.identityId && row.shopifyProductGid === create.shopifyProductGid);
        if (existing) return existing;
        rows.push(create);
        return create;
      }),
      deleteMany: vi.fn(async ({ where }: any) => {
        const before = rows.length;
        for (let index = rows.length - 1; index >= 0; index -= 1) {
          const row = rows[index];
          if (row.shopDomain === where.shopDomain && row.identityType === where.identityType && row.identityId === where.identityId && row.shopifyProductGid === where.shopifyProductGid) rows.splice(index, 1);
        }
        return { count: before - rows.length };
      }),
    },
  } as any;
}

describe("favorites service", () => {
  it("adds favorites idempotently and lists by identity", async () => {
    const prisma = fakePrisma();
    await addFavorite({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-1", shopifyProductGid: "p1", shopifyVariantGid: "v1", sourceSurface: "image_search" });
    await addFavorite({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-1", shopifyProductGid: "p1", shopifyVariantGid: "v1", sourceSurface: "image_search" });
    await addFavorite({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-2", shopifyProductGid: "p2", shopifyVariantGid: "v2", sourceSurface: "image_search" });

    await expect(listFavoriteProductGids({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-1" })).resolves.toEqual(["p1"]);
  });

  it("deletes favorites idempotently", async () => {
    const prisma = fakePrisma();
    await deleteFavorite({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-1", shopifyProductGid: "missing" });
    await expect(listFavoriteProductGids({ prisma, shopDomain: "demo.myshopify.com", identityType: "anonymous", identityId: "id-1" })).resolves.toEqual([]);
  });
});
```

- [ ] **Step 2: Run favorites test to verify it fails**

Run:

```bash
npx vitest run app/services/favorites.server.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Create favorites service**

Create `app/services/favorites.server.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import type { IdentityType, SourceSurface } from "../lib/image-search/types";

export async function listFavoriteProductGids(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
}): Promise<string[]> {
  const rows = await input.prisma.favoriteProduct.findMany({
    where: { shopDomain: input.shopDomain, identityType: input.identityType, identityId: input.identityId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map((row) => row.shopifyProductGid);
}

export async function addFavorite(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
  shopifyProductGid: string;
  shopifyVariantGid: string | null;
  sourceSurface: SourceSurface;
}) {
  await input.prisma.favoriteProduct.upsert({
    where: {
      shopDomain_identityType_identityId_shopifyProductGid: {
        shopDomain: input.shopDomain,
        identityType: input.identityType,
        identityId: input.identityId,
        shopifyProductGid: input.shopifyProductGid,
      },
    },
    update: { shopifyVariantGid: input.shopifyVariantGid, sourceSurface: input.sourceSurface },
    create: {
      shopDomain: input.shopDomain,
      identityType: input.identityType,
      identityId: input.identityId,
      shopifyProductGid: input.shopifyProductGid,
      shopifyVariantGid: input.shopifyVariantGid,
      sourceSurface: input.sourceSurface,
    },
  });
  return { favorited: true };
}

export async function deleteFavorite(input: {
  prisma: PrismaClient;
  shopDomain: string;
  identityType: IdentityType;
  identityId: string;
  shopifyProductGid: string;
}) {
  await input.prisma.favoriteProduct.deleteMany({
    where: {
      shopDomain: input.shopDomain,
      identityType: input.identityType,
      identityId: input.identityId,
      shopifyProductGid: input.shopifyProductGid,
    },
  });
  return { favorited: false };
}
```

- [ ] **Step 4: Create upload history service**

Create `app/services/upload-history.server.ts`:

```ts
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
```

- [ ] **Step 5: Create upload storage service**

Create `app/services/upload-storage.server.ts`:

```ts
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
  const thumbnail = await sharp(input.imageBytes).rotate().resize({ width: 240, height: 240, fit: "inside" }).webp({ quality: 82 }).toBuffer();
  await writeFile(absolutePath, thumbnail);

  const base = input.publicBaseUrl.replace(/\/$/, "");
  return {
    thumbnailStorageKey,
    thumbnailUrl: base ? `${base}/${thumbnailStorageKey}` : `/storage/uploads/${thumbnailStorageKey}`,
  };
}
```

- [ ] **Step 6: Run checks**

Run:

```bash
npx vitest run app/services/favorites.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 7: Commit**

Run:

```bash
git add app/services/upload-storage.server.ts app/services/favorites.server.ts app/services/upload-history.server.ts app/services/favorites.server.test.ts
git commit -m "feat: add favorites and upload history services"
```

---

## Task 10: Implement Image Search storefront API

**Files:**
- Create: `app/services/image-search.server.ts`
- Test: `app/services/image-search.server.test.ts`
- Create: `app/routes/api.image-search.search.tsx`

- [ ] **Step 1: Write result dedupe test**

Create `app/services/image-search.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { dedupeHitsByProduct } from "./image-search.server";

describe("dedupeHitsByProduct", () => {
  it("keeps highest scoring hit per product", () => {
    expect(
      dedupeHitsByProduct([
        { vectorId: "v1", shopifyProductGid: "p1", shopifyMediaGid: "m1", score: 0.7 },
        { vectorId: "v2", shopifyProductGid: "p1", shopifyMediaGid: "m2", score: 0.9 },
        { vectorId: "v3", shopifyProductGid: "p2", shopifyMediaGid: "m3", score: 0.8 },
      ]),
    ).toEqual([
      { vectorId: "v2", shopifyProductGid: "p1", shopifyMediaGid: "m2", score: 0.9 },
      { vectorId: "v3", shopifyProductGid: "p2", shopifyMediaGid: "m3", score: 0.8 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run:

```bash
npx vitest run app/services/image-search.server.test.ts
```

Expected: FAIL because service does not exist.

- [ ] **Step 3: Create Image Search service**

Create `app/services/image-search.server.ts`:

```ts
import type { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import type { MilvusSearchHit } from "../lib/image-search/types";
import { assertAllowedImageUpload } from "../lib/image-search/validation.server";
import { createEmbeddingClient } from "./embedding-client.server";
import { listFavoriteProductGids } from "./favorites.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";
import { saveLocalThumbnail } from "./upload-storage.server";
import { createUploadHistory, listRecentUploads } from "./upload-history.server";

export function dedupeHitsByProduct(hits: MilvusSearchHit[]): MilvusSearchHit[] {
  const bestByProduct = new Map<string, MilvusSearchHit>();
  for (const hit of hits) {
    const existing = bestByProduct.get(hit.shopifyProductGid);
    if (!existing || hit.score > existing.score) {
      bestByProduct.set(hit.shopifyProductGid, hit);
    }
  }
  return [...bestByProduct.values()].sort((a, b) => b.score - a.score);
}

export async function runImageSearch(input: {
  prisma: PrismaClient;
  shopDomain: string;
  anonymousId: string;
  customerGid?: string | null;
  file: File;
  limit: number;
  availableOnly: boolean;
}) {
  assertAllowedImageUpload({ contentType: input.file.type, byteSize: input.file.size });

  const config = getImageSearchConfig();
  const embeddingClient = createEmbeddingClient(config);
  const vectorStore = createDefaultMilvusVectorStore(config);
  const uploadId = randomUUID();
  const imageBytes = Buffer.from(await input.file.arrayBuffer());
  const thumbnail = await saveLocalThumbnail({
    storageDir: config.uploadStorageLocalDir,
    publicBaseUrl: config.uploadStoragePublicBaseUrl,
    shopDomain: input.shopDomain,
    uploadId,
    imageBytes,
  });

  try {
    const embedding = await embeddingClient.embedImageFile(input.file);
    const rawHits = await vectorStore.search({
      embedding: embedding.embedding,
      shopDomain: input.shopDomain,
      limit: Math.max(input.limit * 3, 36),
      availableOnly: input.availableOnly,
    });
    const hits = dedupeHitsByProduct(rawHits).slice(0, input.limit);
    const productGids = hits.map((hit) => hit.shopifyProductGid);
    const mediaGidsByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.shopifyMediaGid]));
    const scoreByProduct = new Map(hits.map((hit) => [hit.shopifyProductGid, hit.score]));
    const favoriteGids = await listFavoriteProductGids({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      identityType: input.customerGid ? "customer" : "anonymous",
      identityId: input.customerGid ?? input.anonymousId,
    });
    const favoriteSet = new Set(favoriteGids);

    const products = await input.prisma.shopProduct.findMany({
      where: {
        shopDomain: input.shopDomain,
        shopifyProductGid: { in: productGids },
        status: "ACTIVE",
        ...(input.availableOnly ? { availableForSale: true } : {}),
      },
      include: { variants: true, images: true },
    });

    const productByGid = new Map(products.map((product) => [product.shopifyProductGid, product]));
    const results = hits
      .map((hit) => {
        const product = productByGid.get(hit.shopifyProductGid);
        if (!product) return null;
        const mediaGid = mediaGidsByProduct.get(product.shopifyProductGid);
        const image = product.images.find((item) => item.shopifyMediaGid === mediaGid) ?? product.images.find((item) => item.isFeatured) ?? product.images[0];
        return buildProductCardDTO({
          product,
          variants: product.variants,
          imageUrl: image?.imageUrl ?? product.featuredImageUrl,
          similarityScore: scoreByProduct.get(product.shopifyProductGid) ?? null,
          isFavorited: favoriteSet.has(product.shopifyProductGid),
        });
      })
      .filter((value): value is NonNullable<typeof value> => Boolean(value));

    const upload = await createUploadHistory({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      thumbnailStorageKey: thumbnail.thumbnailStorageKey,
      thumbnailUrl: thumbnail.thumbnailUrl,
      originalImageStorageKey: null,
      originalFilename: input.file.name,
      contentType: input.file.type,
      byteSize: input.file.size,
      searchStatus: "completed",
    });
    const recentUploads = await listRecentUploads({ prisma: input.prisma, shopDomain: input.shopDomain, anonymousId: input.anonymousId, customerGid: input.customerGid, limit: 8 });

    return {
      uploadId: upload.id,
      results,
      favorites: favoriteGids,
      recentUploads,
      queryMeta: {
        embeddingModel: embedding.model,
        embeddingModelAlias: embedding.modelAlias ?? config.embeddingModelAlias,
        dimension: embedding.dimension,
        limit: input.limit,
        availableOnly: input.availableOnly,
      },
    };
  } catch (error) {
    await createUploadHistory({
      prisma: input.prisma,
      shopDomain: input.shopDomain,
      anonymousId: input.anonymousId,
      customerGid: input.customerGid,
      thumbnailStorageKey: thumbnail.thumbnailStorageKey,
      thumbnailUrl: thumbnail.thumbnailUrl,
      originalImageStorageKey: null,
      originalFilename: input.file.name,
      contentType: input.file.type,
      byteSize: input.file.size,
      searchStatus: "failed",
    });
    throw error;
  }
}
```

- [ ] **Step 4: Create API route**

Create `app/routes/api.image-search.search.tsx`:

```ts
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { runImageSearch } from "../services/image-search.server";
import { normalizeLimit, parseBooleanParam, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const formData = await request.formData();
  const shopDomain = validateShopDomain(String(formData.get("shop") ?? url.searchParams.get("shop") ?? ""));

  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!installedSession) {
    return Response.json({ error: "Shop is not installed" }, { status: 403 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "Image file is required" }, { status: 400 });
  }

  try {
    const result = await runImageSearch({
      prisma,
      shopDomain,
      anonymousId: String(formData.get("anonymousId") ?? ""),
      customerGid: formData.get("customerGid") ? String(formData.get("customerGid")) : null,
      file,
      limit: normalizeLimit(String(formData.get("limit") ?? ""), 12, 48),
      availableOnly: parseBooleanParam(String(formData.get("availableOnly") ?? "true"), true),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Something went wrong. Please try again." }, { status: 400 });
  }
};
```

- [ ] **Step 5: Run checks**

Run:

```bash
npx vitest run app/services/image-search.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 6: Commit**

Run:

```bash
git add app/services/image-search.server.ts app/services/image-search.server.test.ts app/routes/api.image-search.search.tsx
git commit -m "feat: add image search storefront api"
```

---

## Task 11: Implement recommendations and storefront support API routes

**Files:**
- Create: `app/services/recommendations.server.ts`
- Test: `app/services/recommendations.server.test.ts`
- Create: `app/routes/api.recommendations.similar-products.tsx`
- Create: `app/routes/api.favorites.tsx`
- Create: `app/routes/api.favorites.delete.tsx`
- Create: `app/routes/api.upload-history.tsx`

- [ ] **Step 1: Write recommendations source image selector test**

Create `app/services/recommendations.server.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { selectSourceIndexedImage } from "./recommendations.server";

describe("selectSourceIndexedImage", () => {
  it("prefers featured indexed image", () => {
    const image = selectSourceIndexedImage([
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first" },
      { isFeatured: true, embeddingStatus: "indexed", milvusVectorId: "featured" },
    ] as any);
    expect(image?.milvusVectorId).toBe("featured");
  });

  it("falls back to first indexed image", () => {
    const image = selectSourceIndexedImage([
      { isFeatured: true, embeddingStatus: "failed", milvusVectorId: null },
      { isFeatured: false, embeddingStatus: "indexed", milvusVectorId: "first-indexed" },
    ] as any);
    expect(image?.milvusVectorId).toBe("first-indexed");
  });
});
```

- [ ] **Step 2: Run recommendation test to verify it fails**

Run:

```bash
npx vitest run app/services/recommendations.server.test.ts
```

Expected: FAIL because recommendations service does not exist.

- [ ] **Step 3: Create recommendations service**

Create `app/services/recommendations.server.ts`:

```ts
import type { PrismaClient, ShopProductImage } from "@prisma/client";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { buildProductCardDTO } from "../lib/image-search/product-card.server";
import { listFavoriteProductGids } from "./favorites.server";
import { dedupeHitsByProduct } from "./image-search.server";
import { createDefaultMilvusVectorStore } from "./milvus-client.server";

export function selectSourceIndexedImage<T extends Pick<ShopProductImage, "isFeatured" | "embeddingStatus" | "milvusVectorId">>(images: T[]): T | null {
  return images.find((image) => image.isFeatured && image.embeddingStatus === "indexed" && image.milvusVectorId) ?? images.find((image) => image.embeddingStatus === "indexed" && image.milvusVectorId) ?? null;
}

export async function getSimilarProducts(input: {
  prisma: PrismaClient;
  shopDomain: string;
  productGid: string;
  anonymousId?: string | null;
  limit: number;
  availableOnly: boolean;
}) {
  const config = getImageSearchConfig();
  const vectorStore = createDefaultMilvusVectorStore(config);
  const product = await input.prisma.shopProduct.findUnique({
    where: { shopDomain_shopifyProductGid: { shopDomain: input.shopDomain, shopifyProductGid: input.productGid } },
    include: { images: true },
  });

  if (!product) return { sourceProductGid: input.productGid, sourceMediaGid: null, results: [] };
  const sourceImage = selectSourceIndexedImage(product.images);
  if (!sourceImage?.milvusVectorId) return { sourceProductGid: input.productGid, sourceMediaGid: null, results: [] };

  const sourceEmbedding = await vectorStore.getVectorById(sourceImage.milvusVectorId);
  if (!sourceEmbedding) return { sourceProductGid: input.productGid, sourceMediaGid: sourceImage.shopifyMediaGid, results: [] };

  const rawHits = await vectorStore.search({
    embedding: sourceEmbedding,
    shopDomain: input.shopDomain,
    limit: Math.max(input.limit * 3, 30),
    availableOnly: input.availableOnly,
    excludeProductGid: input.productGid,
  });
  const hits = dedupeHitsByProduct(rawHits).slice(0, input.limit);
  const favoriteGids = input.anonymousId
    ? await listFavoriteProductGids({ prisma: input.prisma, shopDomain: input.shopDomain, identityType: "anonymous", identityId: input.anonymousId })
    : [];
  const favoriteSet = new Set(favoriteGids);
  const products = await input.prisma.shopProduct.findMany({
    where: {
      shopDomain: input.shopDomain,
      shopifyProductGid: { in: hits.map((hit) => hit.shopifyProductGid) },
      status: "ACTIVE",
      ...(input.availableOnly ? { availableForSale: true } : {}),
    },
    include: { variants: true, images: true },
  });
  const productByGid = new Map(products.map((row) => [row.shopifyProductGid, row]));
  const results = hits
    .map((hit) => {
      const row = productByGid.get(hit.shopifyProductGid);
      if (!row) return null;
      const image = row.images.find((item) => item.shopifyMediaGid === hit.shopifyMediaGid) ?? row.images.find((item) => item.isFeatured) ?? row.images[0];
      return buildProductCardDTO({
        product: row,
        variants: row.variants,
        imageUrl: image?.imageUrl ?? row.featuredImageUrl,
        similarityScore: hit.score,
        isFavorited: favoriteSet.has(row.shopifyProductGid),
      });
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value));

  return { sourceProductGid: input.productGid, sourceMediaGid: sourceImage.shopifyMediaGid, results };
}
```

- [ ] **Step 4: Create Similar Products route**

Create `app/routes/api.recommendations.similar-products.tsx`:

```ts
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { normalizeLimit, parseBooleanParam, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { getSimilarProducts } from "../services/recommendations.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));

  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!installedSession) return Response.json({ error: "Shop is not installed" }, { status: 403 });

  const productGid = url.searchParams.get("productGid");
  if (!productGid?.startsWith("gid://shopify/Product/")) {
    return Response.json({ error: "Invalid productGid" }, { status: 400 });
  }

  const result = await getSimilarProducts({
    prisma,
    shopDomain,
    productGid,
    anonymousId: url.searchParams.get("anonymousId"),
    limit: normalizeLimit(url.searchParams.get("limit"), 10, 24),
    availableOnly: parseBooleanParam(url.searchParams.get("availableOnly"), true),
  });
  return Response.json(result);
};
```

- [ ] **Step 5: Create favorites routes**

Create `app/routes/api.favorites.tsx`:

```ts
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { validateIdentity, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { addFavorite, listFavoriteProductGids } from "../services/favorites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const identity = validateIdentity({ identityType: url.searchParams.get("identityType"), identityId: url.searchParams.get("identityId") });
  const favorites = await listFavoriteProductGids({ prisma, shopDomain, ...identity });
  return Response.json({ favorites });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  const shopDomain = validateShopDomain(body.shop);
  const identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
  const result = await addFavorite({
    prisma,
    shopDomain,
    ...identity,
    shopifyProductGid: body.shopifyProductGid,
    shopifyVariantGid: body.shopifyVariantGid ?? null,
    sourceSurface: body.sourceSurface ?? "image_search",
  });
  return Response.json(result);
};
```

Create `app/routes/api.favorites.delete.tsx`:

```ts
import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { validateIdentity, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { deleteFavorite } from "../services/favorites.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  const shopDomain = validateShopDomain(body.shop);
  const identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
  const result = await deleteFavorite({ prisma, shopDomain, ...identity, shopifyProductGid: body.shopifyProductGid });
  return Response.json(result);
};
```

- [ ] **Step 6: Create upload history route**

Create `app/routes/api.upload-history.tsx`:

```ts
import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { normalizeLimit, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { listRecentUploads } from "../services/upload-history.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const anonymousId = url.searchParams.get("anonymousId");
  if (!anonymousId) return Response.json({ error: "anonymousId is required" }, { status: 400 });
  const recentUploads = await listRecentUploads({
    prisma,
    shopDomain,
    anonymousId,
    customerGid: url.searchParams.get("customerGid"),
    limit: normalizeLimit(url.searchParams.get("limit"), 8, 24),
  });
  return Response.json({ recentUploads });
};
```

- [ ] **Step 7: Run checks**

Run:

```bash
npx vitest run app/services/recommendations.server.test.ts
npm run typecheck
```

Expected: tests and typecheck pass.

- [ ] **Step 8: Commit**

Run:

```bash
git add app/services/recommendations.server.ts app/services/recommendations.server.test.ts app/routes/api.recommendations.similar-products.tsx app/routes/api.favorites.tsx app/routes/api.favorites.delete.tsx app/routes/api.upload-history.tsx
git commit -m "feat: add recommendations and storefront support apis"
```

---

## Task 12: Create Theme App Extension storefront UI

**Files:**
- Create: `extensions/lens-cart-ai-theme/shopify.extension.toml`
- Create: `extensions/lens-cart-ai-theme/blocks/image-search-app-embed.liquid`
- Create: `extensions/lens-cart-ai-theme/blocks/similar-products.liquid`
- Create: `extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js`
- Create: `extensions/lens-cart-ai-theme/assets/lens-cart-ai.css`

- [ ] **Step 1: Create extension config**

Create `extensions/lens-cart-ai-theme/shopify.extension.toml`:

```toml
name = "LensCart AI Storefront"
type = "theme"
```

- [ ] **Step 2: Create App Embed block**

Create `extensions/lens-cart-ai-theme/blocks/image-search-app-embed.liquid`:

```liquid
{% if block.settings.enabled %}
  {{ 'lens-cart-ai.css' | asset_url | stylesheet_tag }}
  <script src="{{ 'lens-cart-ai-storefront.js' | asset_url }}" defer></script>

  <div
    id="lenscart-ai-root"
    class="lenscart-ai-root"
    data-shop-domain="{{ shop.permanent_domain | escape }}"
    data-api-base-url="{{ block.settings.api_base_url | escape }}"
  >
    <button class="lenscart-ai-fab" type="button" data-lenscart-open>
      <span aria-hidden="true">⌕</span>
      <span class="lenscart-ai-sr-only">Open image search</span>
    </button>

    <div class="lenscart-ai-modal" data-lenscart-modal hidden>
      <div class="lenscart-ai-backdrop" data-lenscart-close></div>
      <section class="lenscart-ai-dialog" aria-label="Image Search">
        <header class="lenscart-ai-header">
          <h2>Image Search</h2>
          <button type="button" data-lenscart-close>×</button>
        </header>
        <div class="lenscart-ai-body">
          <aside class="lenscart-ai-left">
            <div class="lenscart-ai-preview" data-lenscart-preview>Upload an image to search similar products.</div>
            <label class="lenscart-ai-upload-button">
              Upload New Image
              <input type="file" accept="image/jpeg,image/png,image/webp" data-lenscart-file hidden>
            </label>
            <div class="lenscart-ai-recent" data-lenscart-recent></div>
          </aside>
          <main class="lenscart-ai-right">
            <label class="lenscart-ai-filter"><input type="checkbox" data-lenscart-available-only checked> Available Products Only</label>
            <div class="lenscart-ai-sort">Sort by: Most Relevant</div>
            <div class="lenscart-ai-status" data-lenscart-status></div>
            <div class="lenscart-ai-grid" data-lenscart-results></div>
          </main>
        </div>
      </section>
    </div>
  </div>
{% endif %}

{% schema %}
{
  "name": "LensCart AI Image Search",
  "target": "body",
  "settings": [
    { "type": "checkbox", "id": "enabled", "label": "Enable Image Search", "default": true },
    { "type": "text", "id": "api_base_url", "label": "API base URL", "default": "/apps/lens-cart-ai" }
  ]
}
{% endschema %}
```

- [ ] **Step 3: Create PDP Similar Products block**

Create `extensions/lens-cart-ai-theme/blocks/similar-products.liquid`:

```liquid
{{ 'lens-cart-ai.css' | asset_url | stylesheet_tag }}
<script src="{{ 'lens-cart-ai-storefront.js' | asset_url }}" defer></script>

<section
  class="lenscart-ai-similar"
  data-lenscart-similar
  data-shop-domain="{{ shop.permanent_domain | escape }}"
  data-product-gid="gid://shopify/Product/{{ product.id }}"
  data-api-base-url="{{ block.settings.api_base_url | escape }}"
  data-limit="{{ block.settings.limit }}"
>
  <h2>{{ block.settings.heading }}</h2>
  <div class="lenscart-ai-status" data-lenscart-similar-status>Loading similar products…</div>
  <div class="lenscart-ai-grid lenscart-ai-grid-horizontal" data-lenscart-similar-results></div>
</section>

{% schema %}
{
  "name": "LensCart Similar Products",
  "target": "section",
  "settings": [
    { "type": "text", "id": "heading", "label": "Heading", "default": "Similar Products" },
    { "type": "range", "id": "limit", "label": "Product count", "min": 4, "max": 12, "step": 1, "default": 8 },
    { "type": "text", "id": "api_base_url", "label": "API base URL", "default": "/apps/lens-cart-ai" }
  ]
}
{% endschema %}
```

- [ ] **Step 4: Create storefront JavaScript**

Create `extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js`:

```js
(function () {
  const keys = {
    anonymousId: "lensCartAi.v1.anonymousId",
    recentUploads: (shop) => `lensCartAi.v1.recentUploads.${shop}`,
    favorites: (shop) => `lensCartAi.v1.favoriteProducts.${shop}`,
  };

  function uuid() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
      const rand = Math.random() * 16 | 0;
      const value = char === "x" ? rand : (rand & 0x3) | 0x8;
      return value.toString(16);
    });
  }

  function getAnonymousId() {
    let value = localStorage.getItem(keys.anonymousId);
    if (!value) {
      value = uuid();
      localStorage.setItem(keys.anonymousId, value);
    }
    return value;
  }

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function money(product) {
    return product.price && product.currencyCode ? `${product.currencyCode} ${product.price}` : "";
  }

  async function addToCart(product, button, status) {
    if (!product.availableForSale || !product.variantId) return;
    button.textContent = "Adding…";
    button.disabled = true;
    try {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: product.variantId, quantity: 1 }),
      });
      if (!response.ok) throw new Error("cart failed");
      button.textContent = "Added";
      status.textContent = "";
    } catch (_error) {
      button.textContent = "Add to Cart";
      button.disabled = false;
      status.textContent = "Unable to add item to cart. Please try again.";
    }
  }

  function renderProducts(container, products, status, shop, apiBaseUrl, sourceSurface) {
    const favoritesKey = keys.favorites(shop);
    const favorites = new Set(readJson(favoritesKey, []));
    container.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "lenscart-ai-card";
      card.tabIndex = 0;
      card.addEventListener("click", () => { window.location.href = `/products/${product.handle}`; });

      const image = document.createElement("img");
      image.src = product.imageUrl || "";
      image.alt = product.title;
      card.appendChild(image);

      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "lenscart-ai-favorite";
      favorite.textContent = favorites.has(product.productGid) || product.isFavorited ? "♥" : "♡";
      favorite.addEventListener("click", async (event) => {
        event.stopPropagation();
        const isFavorited = favorites.has(product.productGid);
        if (isFavorited) favorites.delete(product.productGid); else favorites.add(product.productGid);
        writeJson(favoritesKey, Array.from(favorites));
        favorite.textContent = isFavorited ? "♡" : "♥";
        const path = isFavorited ? "/api/favorites/delete" : "/api/favorites";
        try {
          await fetch(`${apiBaseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop,
              identityType: "anonymous",
              identityId: getAnonymousId(),
              shopifyProductGid: product.productGid,
              shopifyVariantGid: product.variantGid,
              sourceSurface,
            }),
          });
        } catch (_error) {
          status.textContent = "Favorite saved locally. Sync will retry next time.";
        }
      });
      card.appendChild(favorite);

      const title = document.createElement("h3");
      title.textContent = product.title;
      card.appendChild(title);

      const variant = document.createElement("p");
      variant.textContent = product.variantTitle || "";
      card.appendChild(variant);

      const price = document.createElement("p");
      price.textContent = money(product);
      card.appendChild(price);

      const similar = document.createElement("button");
      similar.type = "button";
      similar.textContent = "Find Similar";
      similar.addEventListener("click", (event) => event.stopPropagation());
      card.appendChild(similar);

      const cart = document.createElement("button");
      cart.type = "button";
      cart.textContent = product.availableForSale ? "Add to Cart" : "Sold out";
      cart.disabled = !product.availableForSale;
      cart.addEventListener("click", (event) => {
        event.stopPropagation();
        addToCart(product, cart, status);
      });
      card.appendChild(cart);

      container.appendChild(card);
    });
  }

  function initImageSearch(root) {
    const shop = root.dataset.shopDomain;
    const apiBaseUrl = root.dataset.apiBaseUrl || "/apps/lens-cart-ai";
    const modal = root.querySelector("[data-lenscart-modal]");
    const open = root.querySelector("[data-lenscart-open]");
    const closes = root.querySelectorAll("[data-lenscart-close]");
    const fileInput = root.querySelector("[data-lenscart-file]");
    const preview = root.querySelector("[data-lenscart-preview]");
    const status = root.querySelector("[data-lenscart-status]");
    const results = root.querySelector("[data-lenscart-results]");
    const recent = root.querySelector("[data-lenscart-recent]");
    const availableOnly = root.querySelector("[data-lenscart-available-only]");

    function renderRecent(items) {
      writeJson(keys.recentUploads(shop), items);
      recent.innerHTML = "";
      items.forEach((item) => {
        const img = document.createElement("img");
        img.src = item.thumbnailUrl;
        img.alt = "Recent upload";
        recent.appendChild(img);
      });
    }

    open.addEventListener("click", () => { modal.hidden = false; });
    closes.forEach((button) => button.addEventListener("click", () => { modal.hidden = true; }));
    renderRecent(readJson(keys.recentUploads(shop), []));

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        status.textContent = "Please upload a JPG, PNG, or WebP image.";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "Image is too large. Please upload a smaller image.";
        return;
      }
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.alt = "Uploaded image preview";
      preview.appendChild(img);
      status.textContent = "Searching…";
      results.innerHTML = "";

      const form = new FormData();
      form.append("image", file);
      form.append("shop", shop);
      form.append("anonymousId", getAnonymousId());
      form.append("limit", "12");
      form.append("availableOnly", availableOnly.checked ? "true" : "false");
      form.append("sort", "most_relevant");

      try {
        const response = await fetch(`${apiBaseUrl}/api/image-search/search`, { method: "POST", body: form });
        const body = await response.json();
        if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
        status.textContent = body.results.length ? "" : "No similar products found.";
        renderProducts(results, body.results, status, shop, apiBaseUrl, "image_search");
        renderRecent(body.recentUploads || []);
        writeJson(keys.favorites(shop), body.favorites || readJson(keys.favorites(shop), []));
      } catch (error) {
        status.textContent = error && error.message ? error.message : "Something went wrong. Please try again.";
      }
    });
  }

  async function initSimilarProducts(section) {
    const shop = section.dataset.shopDomain;
    const productGid = section.dataset.productGid;
    const apiBaseUrl = section.dataset.apiBaseUrl || "/apps/lens-cart-ai";
    const limit = section.dataset.limit || "8";
    const status = section.querySelector("[data-lenscart-similar-status]");
    const results = section.querySelector("[data-lenscart-similar-results]");
    try {
      const params = new URLSearchParams({ shop, productGid, anonymousId: getAnonymousId(), limit, availableOnly: "true" });
      const response = await fetch(`${apiBaseUrl}/api/recommendations/similar-products?${params}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "Similar products unavailable.");
      if (!body.results.length) {
        section.hidden = true;
        return;
      }
      status.textContent = "";
      renderProducts(results, body.results, status, shop, apiBaseUrl, "pdp_similar_products");
    } catch (_error) {
      status.textContent = "Similar products unavailable.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lenscart-open]").forEach((button) => initImageSearch(button.closest("[data-shop-domain]")));
    document.querySelectorAll("[data-lenscart-similar]").forEach(initSimilarProducts);
  });
})();
```

- [ ] **Step 5: Create storefront CSS**

Create `extensions/lens-cart-ai-theme/assets/lens-cart-ai.css`:

```css
.lenscart-ai-sr-only { position: absolute; width: 1px; height: 1px; padding: 0; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.lenscart-ai-fab { position: fixed; right: 24px; bottom: 24px; z-index: 2147483000; width: 56px; height: 56px; border-radius: 50%; border: 0; background: #111827; color: #fff; font-size: 28px; cursor: pointer; box-shadow: 0 12px 30px rgba(0, 0, 0, 0.25); }
.lenscart-ai-modal[hidden] { display: none; }
.lenscart-ai-modal { position: fixed; inset: 0; z-index: 2147483001; }
.lenscart-ai-backdrop { position: absolute; inset: 0; background: rgba(15, 23, 42, 0.55); }
.lenscart-ai-dialog { position: absolute; right: 24px; bottom: 96px; width: min(980px, calc(100vw - 32px)); max-height: min(760px, calc(100vh - 128px)); overflow: auto; border-radius: 20px; background: #fff; color: #111827; box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35); }
.lenscart-ai-header { display: flex; align-items: center; justify-content: space-between; padding: 18px 22px; border-bottom: 1px solid #e5e7eb; }
.lenscart-ai-header h2 { margin: 0; font-size: 20px; }
.lenscart-ai-header button { border: 0; background: transparent; font-size: 28px; cursor: pointer; }
.lenscart-ai-body { display: grid; grid-template-columns: 280px 1fr; gap: 20px; padding: 20px; }
.lenscart-ai-left { display: flex; flex-direction: column; gap: 14px; }
.lenscart-ai-preview { min-height: 220px; border: 1px dashed #cbd5e1; border-radius: 16px; display: grid; place-items: center; text-align: center; color: #64748b; overflow: hidden; }
.lenscart-ai-preview img, .lenscart-ai-recent img, .lenscart-ai-card img { width: 100%; height: 100%; object-fit: cover; }
.lenscart-ai-upload-button, .lenscart-ai-card button { border: 1px solid #111827; border-radius: 999px; padding: 10px 14px; cursor: pointer; text-align: center; background: #fff; color: #111827; }
.lenscart-ai-recent { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
.lenscart-ai-recent img { aspect-ratio: 1; border-radius: 10px; border: 1px solid #e5e7eb; }
.lenscart-ai-right { display: flex; flex-direction: column; gap: 12px; }
.lenscart-ai-filter { display: inline-flex; align-items: center; gap: 8px; }
.lenscart-ai-sort, .lenscart-ai-status { color: #64748b; font-size: 14px; }
.lenscart-ai-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 14px; }
.lenscart-ai-grid-horizontal { grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); }
.lenscart-ai-card { position: relative; display: flex; flex-direction: column; gap: 8px; border: 1px solid #e5e7eb; border-radius: 16px; padding: 10px; cursor: pointer; background: #fff; }
.lenscart-ai-card > img { aspect-ratio: 1; border-radius: 12px; background: #f8fafc; }
.lenscart-ai-card h3 { margin: 0; font-size: 14px; line-height: 1.3; }
.lenscart-ai-card p { margin: 0; font-size: 13px; color: #475569; }
.lenscart-ai-favorite { position: absolute; top: 14px; right: 14px; width: 34px; height: 34px; padding: 0; border-radius: 50%; background: rgba(255, 255, 255, 0.92); }
.lenscart-ai-similar { margin: 32px 0; }
@media (max-width: 760px) { .lenscart-ai-dialog { right: 16px; left: 16px; bottom: 88px; width: auto; } .lenscart-ai-body { grid-template-columns: 1fr; } }
```

- [ ] **Step 6: Run Shopify extension validation**

Run:

```bash
npm run shopify app dev -- --no-update
```

Expected: Shopify CLI recognizes the theme extension and does not report Liquid schema or TOML errors. Stop the dev server after validation.

- [ ] **Step 7: Commit**

Run:

```bash
git add extensions/lens-cart-ai-theme
git commit -m "feat: add storefront image search extension"
```

---

## Task 13: Add local verification documentation and run end-to-end checks

**Files:**
- Modify: `README.md`
- Create: `docs/image-search-phase-1-local-verification.md`

- [ ] **Step 1: Create local verification checklist**

Create `docs/image-search-phase-1-local-verification.md`:

```md
# Image Search Phase 1 Local Verification

## Required services

1. PostgreSQL at `127.0.0.1:25433`
2. Milvus at `127.0.0.1:29530`
3. FastAPI embedding service at `127.0.0.1:8001`
4. Shopify React Router app through `npm run dev`
5. Theme App Extension enabled in the dev store theme editor

## Commands

```bash
npm install
npx prisma migrate dev
npm run typecheck
npm run test
```

```bash
cd services/embedding
python3 -m venv .venv
. .venv/bin/activate
pip install -e '.[test]'
pytest
uvicorn app.main:app --host 127.0.0.1 --port 8001
```

```bash
npm run dev
```

## Admin indexing verification

1. Open the embedded Shopify app `/app`.
2. Click `Index product images`.
3. Confirm the latest job shows:
   - `status = completed`
   - `productsSeen > 0`
   - `variantsSeen > 0`
   - `imagesSeen > 0`
   - `imagesIndexed > 0`
4. In PostgreSQL, confirm `shop_product_images.embedding_status = indexed`, `embedding_dimension = 512`, and `milvus_vector_id` is not empty.
5. In Milvus, confirm `product_image_embeddings_512` has corresponding vectors for the shop domain.

## Storefront Image Search verification

1. Enable the `LensCart AI Image Search` app embed.
2. Open any storefront page.
3. Click the bottom-right floating button.
4. Upload a JPG, PNG, or WebP smaller than 5MB.
5. Confirm preview appears and search loading state changes to results or empty state.
6. Confirm each result has image, title, price, favorite, Find Similar, and Add to Cart.
7. Click a card body and confirm it navigates to `/products/{handle}`.
8. Click Add to Cart and confirm:
   - page does not navigate
   - modal stays open
   - button changes to `Added`
   - Shopify cart receives the numeric `variantId`
9. Toggle favorite, refresh, and confirm the favorite state is restored from localStorage.
10. Toggle Available Products Only and search again.

## PDP Similar Products verification

1. Add the `LensCart Similar Products` product app block on a product template.
2. Open a product that has indexed images.
3. Confirm Similar Products renders below PDP content.
4. Confirm current product is not included.
5. Confirm recommendation card clicks navigate to product pages.
6. Confirm Add to Cart on recommendations does not refresh or navigate.
7. Open a product without indexed images and confirm PDP main content remains usable.

## Security checks

1. Storefront API requests include `shop` and are rejected for invalid shop domains.
2. Production App Proxy requests with invalid `signature` return HTTP 401.
3. PostgreSQL queries include `shopDomain` filters.
4. Milvus search filters include `shop_domain`.
5. GIF uploads and files larger than 5MB are rejected with user-facing messages.
6. Default upload history stores thumbnail metadata and leaves `original_image_storage_key` empty.
```

- [ ] **Step 2: Update README with Image Search run order**

Append this section near the top of `README.md` after the intro:

```md
## LensCart AI Image Search Phase 1

Local service startup order:

1. Start PostgreSQL and set `DATABASE_URL`.
2. Start Milvus and set `MILVUS_ADDRESS`, `MILVUS_USERNAME`, `MILVUS_PASSWORD`, and `MILVUS_COLLECTION=product_image_embeddings_512`.
3. Start the embedding service:

   ```bash
   cd services/embedding
   python3 -m venv .venv
   . .venv/bin/activate
   pip install -e '.[test]'
   uvicorn app.main:app --host 127.0.0.1 --port 8001
   ```

4. Run database migrations:

   ```bash
   npx prisma migrate dev
   ```

5. Start Shopify app dev:

   ```bash
   npm run dev
   ```

6. Open `/app`, click `Index product images`, then enable the theme app embed and product app block in the dev store theme editor.

Full verification checklist: `docs/image-search-phase-1-local-verification.md`.
```

- [ ] **Step 3: Run full automated verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
cd services/embedding && . .venv/bin/activate && pytest
```

Expected:

```txt
npm run lint: PASS
npm run typecheck: PASS
npm run test: PASS
pytest: PASS
```

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: React Router build succeeds.

- [ ] **Step 5: Commit**

Run:

```bash
git add README.md docs/image-search-phase-1-local-verification.md
git commit -m "docs: add image search verification guide"
```

---

## Task 14: Manual acceptance pass

**Files:**
- No planned source changes unless verification finds a defect.
- Use: `docs/image-search-phase-1-local-verification.md`

- [ ] **Step 1: Start services in order**

Run PostgreSQL, Milvus, embedding service, and Shopify app in the order documented in `docs/image-search-phase-1-local-verification.md`.

Expected:

```txt
PostgreSQL reachable
Milvus reachable
GET http://127.0.0.1:8001/health returns ok true and dimension 512
Shopify app dev tunnel starts
```

- [ ] **Step 2: Verify admin indexing**

Open `/app`, click `Index product images`, and record the job summary.

Expected:

```txt
status = completed
productsSeen > 0
variantsSeen > 0
imagesSeen > 0
imagesIndexed > 0
imagesFailed may be 0 or more, but individual image failures do not fail the entire job
```

- [ ] **Step 3: Verify Storefront Image Search modal**

Enable the App Embed, open storefront, upload a valid image, and verify:

```txt
Floating button opens modal
Preview appears
Loading state appears
Results grid appears or controlled empty state appears
Card body navigates to /products/{handle}
Add to Cart does not navigate and shows Added on success
Favorite toggles and survives refresh
Recent upload thumbnail appears
```

- [ ] **Step 4: Verify PDP Similar Products**

Enable Product App Block on PDP and verify:

```txt
Similar Products block appears for indexed products
Current product is excluded
Add to Cart does not refresh or navigate
Unindexed products do not break PDP content
```

- [ ] **Step 5: Verify security and error states**

Run these checks manually:

```txt
Invalid shop domain is rejected
Oversized image shows Image is too large. Please upload a smaller image.
GIF upload shows Please upload a JPG, PNG, or WebP image.
Production invalid App Proxy signature returns 401
PostgreSQL rows are scoped by shop_domain
Milvus search filters include shop_domain
```

- [ ] **Step 6: Final automated verification**

Run:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
cd services/embedding && . .venv/bin/activate && pytest
```

Expected: every command passes.

- [ ] **Step 7: Commit verification fixes if any**

If Step 2-6 required source changes, commit them:

```bash
git add app extensions services docs prisma package.json package-lock.json README.md .gitignore .env.example
git commit -m "fix: complete image search acceptance fixes"
```

If no files changed, do not create an empty commit.

---

## Self-Review

### Spec coverage

- Storefront Theme App Extension App Embed and Product App Block: Task 12.
- React Router backend indexing/search/recommendations/favorites/upload-history APIs: Tasks 8, 10, 11.
- Python FastAPI embedding service with CLIP ViT-B/16 and 512-dimensional normalized output: Task 4.
- PostgreSQL business truth source tables and constraints: Task 2.
- Milvus collection `product_image_embeddings_512`: Task 6.
- Admin `/app` indexing page: Task 8.
- Variant numeric id from `legacyResourceId`: Tasks 2 and 7.
- Anonymous localStorage favorites and upload state: Task 12.
- Default thumbnail-only upload storage: Tasks 9 and 10.
- Product card Add to Cart behavior through `/cart/add.js`: Task 12.
- PDP Similar Products without re-embedding on page view: Task 11.
- Security and shop isolation: Tasks 3, 6, 10, 11, 14.
- Testing and acceptance standards: Tasks 1-14.

### Placeholder scan

This plan contains concrete paths, commands, DTOs, schema, and code snippets for each implementation step. It intentionally avoids deferred implementation markers and ambiguous validation instructions.

### Type consistency

- `shopifyVariantNumericId` maps to `shopify_variant_numeric_id` in Prisma and becomes `ProductCardDTO.variantId`.
- `shopDomain` maps to `shop_domain` in PostgreSQL and `shop_domain` in Milvus filters.
- `ProductCardDTO` fields are shared by search, recommendations, and storefront rendering.
- Favorites consistently use `identityType` and `identityId` in service and routes.
- Milvus vector IDs are generated by `createMilvusVectorId` from canonical model and dimension, not alias.
