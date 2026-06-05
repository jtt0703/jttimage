import { createRequire } from "node:module";
import { createShopMilvusCollectionName } from "../lib/image-search/hash.server";
import type { MilvusSearchHit } from "../lib/image-search/types";
import { errorLogFields, logger } from "../lib/logger.server";

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
    collectionName,

    async ensureCollection(): Promise<void> {
      const startedAtMs = performance.now();
      const exists = await client.hasCollection({ collection_name: collectionName });
      if (!exists.value) {
        logger.info({ event: "milvus.collection_created", collectionName, dimension }, "creating milvus collection");
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
      logger.info(
        {
          event: "milvus.collection_loaded",
          collectionName,
          collectionCreated: !exists.value,
          durationMs: Math.round(performance.now() - startedAtMs),
        },
        "milvus collection loaded",
      );
    },

    async upsertProductImageVector(vector: ProductImageVectorInput): Promise<void> {
      const startedAtMs = performance.now();
      logger.info(
        {
          event: "milvus.upsert_started",
          collectionName,
          shopDomain: vector.shopDomain,
          vectorId: vector.vectorId,
          shopifyProductGid: vector.shopifyProductGid,
          shopifyMediaGid: vector.shopifyMediaGid,
        },
        "milvus vector upsert started",
      );
      try {
        await this.ensureCollection();
        await client.delete({
          collection_name: collectionName,
          filter: `vector_id == "${escapeMilvusString(vector.vectorId)}"`,
        });
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
        logger.info(
          {
            event: "milvus.upsert_completed",
            collectionName,
            shopDomain: vector.shopDomain,
            vectorId: vector.vectorId,
            durationMs: Math.round(performance.now() - startedAtMs),
          },
          "milvus vector upsert completed",
        );
      } catch (error) {
        logger.error(
          {
            event: "milvus.error",
            operation: "upsert",
            collectionName,
            shopDomain: vector.shopDomain,
            vectorId: vector.vectorId,
            durationMs: Math.round(performance.now() - startedAtMs),
            ...errorLogFields(error),
          },
          "milvus vector upsert failed",
        );
        throw error;
      }
    },

    async search(input: {
      embedding: number[];
      shopDomain: string;
      limit: number;
      availableOnly: boolean;
      excludeProductGid?: string;
    }): Promise<MilvusSearchHit[]> {
      const startedAtMs = performance.now();
      const filters = [shopFilter(input.shopDomain)];
      if (input.availableOnly) filters.push("available_for_sale == true");
      if (input.excludeProductGid) filters.push(`shopify_product_gid != "${escapeMilvusString(input.excludeProductGid)}"`);
      const filter = filters.join(" && ");

      try {
        await this.ensureCollection();
        const response = await client.search({
          collection_name: collectionName,
          vector: input.embedding,
          anns_field: "embedding",
          metric_type: "IP",
          limit: input.limit,
          filter,
          output_fields: ["vector_id", "shopify_product_gid", "shopify_media_gid"],
        });

        const hits = (response.results ?? []).map((hit) => {
          const row = hit as Record<string, unknown>;
          return {
            vectorId: String(row.vector_id),
            shopifyProductGid: String(row.shopify_product_gid),
            shopifyMediaGid: String(row.shopify_media_gid),
            score: Number(row.score),
          };
        });
        logger.info(
          {
            event: "milvus.search_completed",
            collectionName,
            shopDomain: input.shopDomain,
            limit: input.limit,
            hitsCount: hits.length,
            filter,
            durationMs: Math.round(performance.now() - startedAtMs),
          },
          "milvus search completed",
        );
        return hits;
      } catch (error) {
        logger.error(
          {
            event: "milvus.error",
            operation: "search",
            collectionName,
            shopDomain: input.shopDomain,
            durationMs: Math.round(performance.now() - startedAtMs),
            ...errorLogFields(error),
          },
          "milvus search failed",
        );
        throw error;
      }
    },

    async getVectorById(vectorId: string): Promise<number[] | null> {
      await this.ensureCollection();
      const response = await client.query({
        collection_name: collectionName,
        filter: `vector_id == "${escapeMilvusString(vectorId)}"`,
        output_fields: ["vector_id", "embedding"],
        limit: 1,
      });
      const row = response.data?.[0] as { embedding?: number[] } | undefined;
      return row?.embedding ?? null;
    },

    async deleteVectorById(vectorId: string): Promise<void> {
      await this.ensureCollection();
      await client.delete({
        collection_name: collectionName,
        filter: `vector_id == "${escapeMilvusString(vectorId)}"`,
      });
      await client.flushSync({ collection_names: [collectionName] });
      logger.info({ event: "milvus.delete_completed", collectionName, vectorId }, "milvus vector deleted");
    },

    async deleteProductVectors(input: { shopDomain: string; shopifyProductGid: string }): Promise<void> {
      const filter = `${shopFilter(input.shopDomain)} && shopify_product_gid == "${escapeMilvusString(input.shopifyProductGid)}"`;
      await this.ensureCollection();
      await client.delete({ collection_name: collectionName, filter });
      await client.flushSync({ collection_names: [collectionName] });
      logger.info(
        {
          event: "milvus.delete_completed",
          collectionName,
          shopDomain: input.shopDomain,
          shopifyProductGid: input.shopifyProductGid,
        },
        "milvus product vectors deleted",
      );
    },
  };
}

export function resolveShopMilvusCollection(config: {
  milvusCollection: string;
  milvusCollectionPrefix?: string;
  embeddingDimension: number;
  embeddingModelAlias?: string;
}, shopDomain?: string | null): string {
  if (!shopDomain) return config.milvusCollection;
  return createShopMilvusCollectionName({
    prefix: config.milvusCollectionPrefix ?? config.milvusCollection,
    shopDomain,
    embeddingDimension: config.embeddingDimension,
    embeddingModelAlias: config.embeddingModelAlias ?? "clip",
  });
}

export function createDefaultMilvusVectorStore(
  config: {
    milvusAddress: string;
    milvusUsername: string;
    milvusPassword: string;
    milvusCollection: string;
    milvusCollectionPrefix?: string;
    embeddingDimension: number;
    embeddingModelAlias?: string;
  },
  options: { shopDomain?: string | null } = {},
) {
  const require = createRequire(import.meta.url);
  const { MilvusClient } = require("@zilliz/milvus2-sdk-node") as {
    MilvusClient: new (config: { address: string; username?: string; password?: string }) => MilvusSdkLike;
  };
  const client = new MilvusClient({
    address: config.milvusAddress,
    username: config.milvusUsername || undefined,
    password: config.milvusPassword || undefined,
  });
  const collectionName = resolveShopMilvusCollection(config, options.shopDomain);
  logger.info(
    {
      event: "milvus.collection_resolved",
      shopDomain: options.shopDomain ?? null,
      collectionName,
    },
    "resolved milvus collection",
  );

  return createMilvusVectorStore({
    client,
    collectionName,
    dimension: config.embeddingDimension,
  });
}
