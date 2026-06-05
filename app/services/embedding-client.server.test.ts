import { afterEach, describe, expect, it, vi } from "vitest";
import { createEmbeddingClient, validateEmbeddingResponse } from "./embedding-client.server";

const config = {
  embeddingServiceUrl: "http://embedding.test",
  embeddingModel: "openai/clip-vit-base-patch32",
  embeddingModelAlias: "clip-vit-b-32",
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
        { model: "openai/clip-vit-base-patch32", modelAlias: "other-alias", dimension: 512, embedding },
        config,
      ),
    ).toEqual({ model: "openai/clip-vit-base-patch32", modelAlias: "other-alias", dimension: 512, embedding });
  });

  it("rejects wrong canonical model", () => {
    expect(() =>
      validateEmbeddingResponse(
        { model: "wrong", modelAlias: "clip-vit-b-32", dimension: 512, embedding: [1, ...Array(511).fill(0)] },
        config,
      ),
    ).toThrow("Embedding model mismatch");
  });

  it("rejects non-normalized vector", () => {
    expect(() =>
      validateEmbeddingResponse(
        {
          model: "openai/clip-vit-base-patch32",
          modelAlias: "clip-vit-b-32",
          dimension: 512,
          embedding: [2, ...Array(511).fill(0)],
        },
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
    expect(fetch).toHaveBeenCalledWith("http://embedding.test/health", expect.objectContaining({ method: "GET" }));
  });

  it("posts image urls as json", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            model: "openai/clip-vit-base-patch32",
            modelAlias: "clip-vit-b-32",
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
