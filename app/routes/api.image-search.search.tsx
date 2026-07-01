import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import {
  normalizeLimit,
  parseBooleanParam,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { errorLogFields, logger } from "../lib/logger.server";
import { storefrontCorsPreflight, withStorefrontCors } from "../lib/storefront-cors.server";
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";
import { EmbeddingServiceTimeoutError, EmbeddingServiceUnavailableError } from "../services/embedding-client.server";
import { runImageSearch } from "../services/image-search.server";
import { MilvusUnavailableError } from "../services/milvus-client.server";

class ImageSearchTimeoutError extends Error {
  constructor() {
    super("Image search timed out. Please try again with a smaller image.");
    this.name = "ImageSearchTimeoutError";
  }
}

async function withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: NodeJS.Timeout | null = null;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new ImageSearchTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function errorStatus(error: unknown): number {
  if (error instanceof ImageSearchTimeoutError || error instanceof EmbeddingServiceTimeoutError) return 504;
  if (error instanceof EmbeddingServiceUnavailableError || error instanceof MilvusUnavailableError) return 503;
  if (error instanceof Error && error.message.startsWith("Invalid shop domain")) return 400;
  if (error instanceof Error && error.message.startsWith("Please upload")) return 400;
  if (error instanceof Error && error.message.startsWith("Image is too large")) return 400;
  return 500;
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof ImageSearchTimeoutError || error instanceof EmbeddingServiceTimeoutError) {
    return "Image search timed out. Please try again with a smaller image.";
  }
  if (error instanceof EmbeddingServiceUnavailableError || error instanceof MilvusUnavailableError) {
    return "Image search is temporarily unavailable. Please try again later.";
  }
  if (error instanceof Error && error.message.startsWith("Invalid shop domain")) {
    return error.message;
  }
  if (error instanceof Error && (error.message.startsWith("Please upload") || error.message.startsWith("Image is too large"))) {
    return error.message;
  }
  return "Something went wrong. Please try again.";
}

export const action = async ({ request }: ActionFunctionArgs) => {
  if (request.method === "OPTIONS") return storefrontCorsPreflight(request);

  const requestStartedAtMs = performance.now();
  const url = new URL(request.url);
  let shopDomain = "unknown";
  try {
    const uploadParseStartedAtMs = performance.now();
    const formData = await request.formData();
    const uploadParseMs = performance.now() - uploadParseStartedAtMs;
    shopDomain = validateShopDomain(String(formData.get("shop") ?? url.searchParams.get("shop") ?? ""));

    if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
      return withStorefrontCors(request, Response.json({ error: "Invalid app proxy signature" }, { status: 401 }));
    }

    const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
    if (!installedSession) {
      return withStorefrontCors(request, Response.json({ error: "Shop is not installed" }, { status: 403 }));
    }

    try {
      await requireBillingAccess({ prisma, shopDomain });
    } catch (error) {
      const billingResponse = billingAccessErrorResponse(error);
      if (billingResponse) return withStorefrontCors(request, billingResponse);
      throw error;
    }

    const file = formData.get("image");
    if (!(file instanceof File)) {
      return withStorefrontCors(request, Response.json({ error: "Image file is required" }, { status: 400 }));
    }

    const config = getImageSearchConfig();
    const result = await withTimeout(
      runImageSearch({
        prisma,
        shopDomain,
        anonymousId: String(formData.get("anonymousId") ?? ""),
        customerGid: formData.get("customerGid") ? String(formData.get("customerGid")) : null,
        file,
        limit: normalizeLimit(String(formData.get("limit") ?? ""), 12, 48),
        availableOnly: parseBooleanParam(String(formData.get("availableOnly") ?? "true"), true),
        requestTiming: {
          requestStartedAtMs,
          uploadParseMs,
        },
      }),
      config.imageSearchSyncTimeoutMs,
    );
    return withStorefrontCors(request, Response.json(result));
  } catch (error) {
    const status = errorStatus(error);
    logger.error(
      {
        event: status === 504 ? "image_search.timeout" : "image_search.route_failed",
        shopDomain,
        status,
        ...errorLogFields(error),
      },
      "image search route failed",
    );
    return withStorefrontCors(request, Response.json({ error: publicErrorMessage(error) }, { status }));
  }
};
