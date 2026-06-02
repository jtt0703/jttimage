import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { validateIdentity, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { deleteFavorite } from "../services/favorites.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  const shopDomain = validateShopDomain(body.shop);
  const identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
  const result = await deleteFavorite({ prisma, shopDomain, ...identity, shopifyProductGid: body.shopifyProductGid });
  return Response.json(result);
};
