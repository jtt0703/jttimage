import { describe, expect, it, vi } from "vitest";
import { createMilvusVectorStore, MilvusUnavailableError } from "./milvus-client.server";

function createFakeClient() {
  return {
    hasCollection: vi.fn(async () => ({ value: false })),
    createCollection: vi.fn(async () => ({})),
    createIndex: vi.fn(async () => ({})),
    loadCollectionSync: vi.fn(async () => ({})),
    delete: vi.fn(async () => ({})),
    insert: vi.fn(async () => ({})),
    flushSync: vi.fn(async () => ({})),
    search: vi.fn(async () => ({
      results: [{ vector_id: "v1", shopify_product_gid: "p1", shopify_media_gid: "m1", score: 0.91 }],
    })),
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
    expect(client.delete).toHaveBeenCalledWith({
      collection_name: "product_image_embeddings_512",
      filter: 'vector_id == "v1"',
    });
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
    expect(client.search).toHaveBeenCalledWith(
      expect.objectContaining({ filter: 'shop_domain == "demo.myshopify.com" && available_for_sale == true' }),
    );
  });

  it("normalizes grpc deadline failures as Milvus unavailable", async () => {
    const client = createFakeClient();
    client.hasCollection.mockResolvedValue({ value: true });
    client.loadCollectionSync.mockRejectedValue({
      code: 4,
      details: "Deadline exceeded after 14.999s,Waiting for LB pick",
    });
    const store = createMilvusVectorStore({ client, collectionName: "product_image_embeddings_512", dimension: 512 });

    await expect(
      store.search({
        embedding: [1, ...Array(511).fill(0)],
        shopDomain: "demo.myshopify.com",
        limit: 12,
        availableOnly: true,
      }),
    ).rejects.toBeInstanceOf(MilvusUnavailableError);
  });
});
