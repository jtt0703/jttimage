import type { LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { normalizeLimit, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { listRecentUploads } from "../services/upload-history.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
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
