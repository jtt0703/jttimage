import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateIdentity,
  validateShopifyProductGid,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";
import { addFavorite, listFavoriteProducts } from "../services/favorites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!installedSession) return Response.json({ error: "Shop is not installed" }, { status: 403 });
  try {
    await requireBillingAccess({ prisma, shopDomain });
  } catch (error) {
    const billingResponse = billingAccessErrorResponse(error);
    if (billingResponse) return billingResponse;
    throw error;
  }

  const identity = validateIdentity({
    identityType: url.searchParams.get("identityType"),
    identityId: url.searchParams.get("identityId"),
  });
  const result = await listFavoriteProducts({ prisma, shopDomain, ...identity });
  return Response.json(result);
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  let shopDomain: string;
  try {
    shopDomain = validateShopDomain(body.shop);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid favorite request" }, { status: 400 });
  }
  const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!installedSession) return Response.json({ error: "Shop is not installed" }, { status: 403 });
  try {
    await requireBillingAccess({ prisma, shopDomain });
  } catch (error) {
    const billingResponse = billingAccessErrorResponse(error);
    if (billingResponse) return billingResponse;
    throw error;
  }

  let identity: ReturnType<typeof validateIdentity>;
  let shopifyProductGid: string;
  try {
    identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
    shopifyProductGid = validateShopifyProductGid(body.shopifyProductGid);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid favorite request" }, { status: 400 });
  }
  const result = await addFavorite({
    prisma,
    shopDomain,
    ...identity,
    shopifyProductGid,
    shopifyVariantGid: body.shopifyVariantGid ?? null,
    sourceSurface: body.sourceSurface ?? "image_search",
  });
  return Response.json(result);
};
