import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateIdentity,
  validateShopifyProductGid,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";
import { deleteFavorite } from "../services/favorites.server";

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
  const result = await deleteFavorite({ prisma, shopDomain, ...identity, shopifyProductGid });
  return Response.json(result);
};
