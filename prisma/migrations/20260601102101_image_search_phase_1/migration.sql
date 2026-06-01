-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "shop" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "isOnline" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT,
    "expires" TIMESTAMP(3),
    "accessToken" TEXT NOT NULL,
    "userId" BIGINT,
    "firstName" TEXT,
    "lastName" TEXT,
    "email" TEXT,
    "accountOwner" BOOLEAN NOT NULL DEFAULT false,
    "locale" TEXT,
    "collaborator" BOOLEAN DEFAULT false,
    "emailVerified" BOOLEAN DEFAULT false,
    "refreshToken" TEXT,
    "refreshTokenExpires" TIMESTAMP(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_products" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "shopify_product_gid" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "handle" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "vendor" TEXT,
    "product_type" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "featured_image_url" TEXT,
    "min_price" DECIMAL(18,2),
    "currency_code" TEXT,
    "total_inventory" INTEGER,
    "available_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "raw_shopify_payload" JSONB NOT NULL,
    "last_synced_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_product_variants" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "shopify_product_gid" TEXT NOT NULL,
    "shopify_variant_gid" TEXT NOT NULL,
    "shopify_variant_numeric_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sku" TEXT,
    "price" DECIMAL(18,2),
    "compare_at_price" DECIMAL(18,2),
    "available_for_sale" BOOLEAN NOT NULL DEFAULT false,
    "inventory_quantity" INTEGER,
    "raw_shopify_payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_product_images" (
    "id" TEXT NOT NULL,
    "product_id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "shopify_product_gid" TEXT NOT NULL,
    "shopify_media_gid" TEXT NOT NULL,
    "shopify_image_gid" TEXT,
    "image_url" TEXT NOT NULL,
    "alt_text" TEXT,
    "position" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "image_url_hash" TEXT NOT NULL,
    "embedding_status" TEXT NOT NULL DEFAULT 'pending',
    "embedding_provider" TEXT,
    "embedding_model" TEXT,
    "embedding_model_alias" TEXT,
    "embedding_dimension" INTEGER,
    "milvus_collection" TEXT,
    "milvus_vector_id" TEXT,
    "last_embedded_at" TIMESTAMP(3),
    "embedding_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_product_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_index_jobs" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "source_filter" JSONB NOT NULL,
    "products_seen" INTEGER NOT NULL DEFAULT 0,
    "variants_seen" INTEGER NOT NULL DEFAULT 0,
    "images_seen" INTEGER NOT NULL DEFAULT 0,
    "images_indexed" INTEGER NOT NULL DEFAULT 0,
    "images_skipped" INTEGER NOT NULL DEFAULT 0,
    "images_failed" INTEGER NOT NULL DEFAULT 0,
    "error_message" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_index_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "image_search_uploads" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "anonymous_id" TEXT NOT NULL,
    "customer_gid" TEXT,
    "thumbnail_storage_key" TEXT NOT NULL,
    "thumbnail_url" TEXT NOT NULL,
    "original_image_storage_key" TEXT,
    "original_filename" TEXT,
    "content_type" TEXT NOT NULL,
    "byte_size" INTEGER NOT NULL,
    "search_status" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "image_search_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "favorite_products" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "identity_type" TEXT NOT NULL,
    "identity_id" TEXT NOT NULL,
    "shopify_product_gid" TEXT NOT NULL,
    "shopify_variant_gid" TEXT,
    "source_surface" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "favorite_products_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_products_shop_domain_handle_idx" ON "shop_products"("shop_domain", "handle");

-- CreateIndex
CREATE UNIQUE INDEX "shop_products_shop_domain_shopify_product_gid_key" ON "shop_products"("shop_domain", "shopify_product_gid");

-- CreateIndex
CREATE INDEX "shop_product_variants_shop_domain_shopify_product_gid_idx" ON "shop_product_variants"("shop_domain", "shopify_product_gid");

-- CreateIndex
CREATE UNIQUE INDEX "shop_product_variants_shop_domain_shopify_variant_gid_key" ON "shop_product_variants"("shop_domain", "shopify_variant_gid");

-- CreateIndex
CREATE INDEX "shop_product_images_shop_domain_shopify_product_gid_idx" ON "shop_product_images"("shop_domain", "shopify_product_gid");

-- CreateIndex
CREATE INDEX "shop_product_images_shop_domain_embedding_status_idx" ON "shop_product_images"("shop_domain", "embedding_status");

-- CreateIndex
CREATE INDEX "shop_product_images_milvus_vector_id_idx" ON "shop_product_images"("milvus_vector_id");

-- CreateIndex
CREATE UNIQUE INDEX "shop_product_images_shop_domain_shopify_media_gid_key" ON "shop_product_images"("shop_domain", "shopify_media_gid");

-- CreateIndex
CREATE INDEX "product_index_jobs_shop_domain_created_at_idx" ON "product_index_jobs"("shop_domain", "created_at");

-- CreateIndex
CREATE INDEX "image_search_uploads_shop_domain_anonymous_id_created_at_idx" ON "image_search_uploads"("shop_domain", "anonymous_id", "created_at");

-- CreateIndex
CREATE INDEX "image_search_uploads_shop_domain_customer_gid_created_at_idx" ON "image_search_uploads"("shop_domain", "customer_gid", "created_at");

-- CreateIndex
CREATE INDEX "favorite_products_shop_domain_identity_type_identity_id_idx" ON "favorite_products"("shop_domain", "identity_type", "identity_id");

-- CreateIndex
CREATE UNIQUE INDEX "favorite_products_shop_domain_identity_type_identity_id_sho_key" ON "favorite_products"("shop_domain", "identity_type", "identity_id", "shopify_product_gid");

-- AddForeignKey
ALTER TABLE "shop_product_variants" ADD CONSTRAINT "shop_product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shop_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_product_images" ADD CONSTRAINT "shop_product_images_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "shop_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
