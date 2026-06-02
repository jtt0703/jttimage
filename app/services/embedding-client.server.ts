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
