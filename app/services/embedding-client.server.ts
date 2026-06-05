import type { EmbeddingResponse } from "../lib/image-search/types";
import { errorLogFields, logger } from "../lib/logger.server";

export interface EmbeddingClientConfig {
  embeddingServiceUrl: string;
  embeddingModel: string;
  embeddingModelAlias: string;
  embeddingDimension: number;
  embeddingRequestTimeoutMs?: number;
  embeddingRequestRetries?: number;
  embeddingCircuitFailureThreshold?: number;
  embeddingCircuitResetMs?: number;
}

export class EmbeddingServiceTimeoutError extends Error {
  constructor(message = "Embedding service request timed out") {
    super(message);
    this.name = "EmbeddingServiceTimeoutError";
  }
}

export class EmbeddingServiceUnavailableError extends Error {
  constructor(message = "Embedding service is temporarily unavailable") {
    super(message);
    this.name = "EmbeddingServiceUnavailableError";
  }
}

type RequestKind = "health" | "embed_image_url" | "embed_image_file" | "embed_image_bytes";

const circuitState = {
  failures: 0,
  openedAtMs: 0,
};

function circuitIsOpen(config: EmbeddingClientConfig): boolean {
  const resetMs = config.embeddingCircuitResetMs ?? 60_000;
  if (!circuitState.openedAtMs) return false;
  if (Date.now() - circuitState.openedAtMs > resetMs) {
    circuitState.openedAtMs = 0;
    circuitState.failures = 0;
    logger.info({ event: "embedding.circuit_closed" }, "embedding circuit breaker closed");
    return false;
  }
  return true;
}

function recordRequestSuccess(): void {
  circuitState.failures = 0;
  circuitState.openedAtMs = 0;
}

function recordRequestFailure(config: EmbeddingClientConfig, error: unknown): void {
  const threshold = config.embeddingCircuitFailureThreshold ?? 5;
  circuitState.failures += 1;
  if (circuitState.failures >= threshold && !circuitState.openedAtMs) {
    circuitState.openedAtMs = Date.now();
    logger.warn(
      {
        event: "embedding.circuit_opened",
        failures: circuitState.failures,
        threshold,
        ...errorLogFields(error),
      },
      "embedding circuit breaker opened",
    );
  }
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof EmbeddingServiceTimeoutError) return true;
  if (error instanceof EmbeddingServiceUnavailableError) return true;
  if (error instanceof TypeError) return true;
  return false;
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
    logger.warn(
      {
        event: "embedding.validation_alias_mismatch",
        expectedModelAlias: config.embeddingModelAlias,
        actualModelAlias: response.modelAlias,
      },
      "embedding alias mismatch",
    );
  }

  return response;
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  if (!response.ok) {
    const text = await response.text();
    if (isRetryableStatus(response.status)) {
      throw new EmbeddingServiceUnavailableError(`Embedding service request failed: ${response.status} ${text}`);
    }
    throw new Error(`Embedding service request failed: ${response.status} ${text}`);
  }
  return response.json();
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new EmbeddingServiceTimeoutError();
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

async function requestJson(input: {
  config: EmbeddingClientConfig;
  kind: RequestKind;
  url: string;
  init: RequestInit;
}): Promise<unknown> {
  if (circuitIsOpen(input.config)) {
    throw new EmbeddingServiceUnavailableError("Embedding circuit breaker is open");
  }

  const retries = input.config.embeddingRequestRetries ?? 0;
  const timeoutMs = input.config.embeddingRequestTimeoutMs ?? 45_000;
  let lastError: unknown;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const startedAtMs = performance.now();
    logger.info(
      {
        event: "embedding.request_started",
        kind: input.kind,
        attempt,
        timeoutMs,
        model: input.config.embeddingModel,
      },
      "embedding request started",
    );

    try {
      const response = await fetchWithTimeout(input.url, input.init, timeoutMs);
      const body = await parseJsonResponse(response);
      recordRequestSuccess();
      logger.info(
        {
          event: "embedding.request_completed",
          kind: input.kind,
          attempt,
          status: response.status,
          durationMs: Math.round(performance.now() - startedAtMs),
        },
        "embedding request completed",
      );
      return body;
    } catch (error) {
      lastError = error;
      const retryable = isRetryableError(error);
      logger.warn(
        {
          event: retryable && attempt < retries ? "embedding.request_retry" : "embedding.request_failed",
          kind: input.kind,
          attempt,
          retryable,
          durationMs: Math.round(performance.now() - startedAtMs),
          ...errorLogFields(error),
        },
        "embedding request failed",
      );
      if (!retryable || attempt >= retries) break;
    }
  }

  recordRequestFailure(input.config, lastError);
  throw lastError;
}

export function createEmbeddingClient(config: EmbeddingClientConfig) {
  const baseUrl = config.embeddingServiceUrl.replace(/\/$/, "");

  return {
    async health(): Promise<unknown> {
      return requestJson({
        config,
        kind: "health",
        url: `${baseUrl}/health`,
        init: { method: "GET" },
      });
    },

    async embedImageUrl(imageUrl: string): Promise<EmbeddingResponse> {
      const body = await requestJson({
        config,
        kind: "embed_image_url",
        url: `${baseUrl}/embed/image`,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ imageUrl }),
        },
      });
      return validateEmbeddingResponse(body as EmbeddingResponse, config);
    },

    async embedImageFile(file: File): Promise<EmbeddingResponse> {
      const formData = new FormData();
      formData.append("image", file, file.name || "upload");
      const body = await requestJson({
        config,
        kind: "embed_image_file",
        url: `${baseUrl}/embed/image`,
        init: {
          method: "POST",
          body: formData,
        },
      });
      return validateEmbeddingResponse(body as EmbeddingResponse, config);
    },

    async embedImageBytes(input: { imageBytes: Buffer; filename: string; contentType: string }): Promise<EmbeddingResponse> {
      const formData = new FormData();
      const blob = new Blob([new Uint8Array(input.imageBytes)], { type: input.contentType });
      formData.append("image", blob, input.filename || "upload");
      const body = await requestJson({
        config,
        kind: "embed_image_bytes",
        url: `${baseUrl}/embed/image`,
        init: {
          method: "POST",
          body: formData,
        },
      });
      return validateEmbeddingResponse(body as EmbeddingResponse, config);
    },
  };
}
