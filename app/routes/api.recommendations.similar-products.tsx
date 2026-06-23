import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  normalizeLimit,
  parseBooleanParam,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { errorLogFields, logger } from "../lib/logger.server";
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";
import { getSimilarProducts } from "../services/recommendations.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));

  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  try {
    const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
    if (!installedSession) return Response.json({ error: "Shop is not installed" }, { status: 403 });

    try {
      await requireBillingAccess({ prisma, shopDomain });
    } catch (error) {
      const billingResponse = billingAccessErrorResponse(error);
      if (billingResponse) return billingResponse;
      throw error;
    }

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
  } catch (error) {
    logger.error(
      {
        event: "recommendations.route_failed",
        shopDomain,
        status: 503,
        ...errorLogFields(error),
      },
      "similar products route failed",
    );
    return Response.json(
      { error: "Similar products are temporarily unavailable. Please try again later." },
      { status: 503 },
    );
  }
};
