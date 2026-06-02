import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  validateIdentity,
  validateShopifyProductGid,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { deleteFavorite } from "../services/favorites.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  let shopDomain: string;
  let identity: ReturnType<typeof validateIdentity>;
  let shopifyProductGid: string;
  try {
    shopDomain = validateShopDomain(body.shop);
    identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
    shopifyProductGid = validateShopifyProductGid(body.shopifyProductGid);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid favorite request" }, { status: 400 });
  }
  const result = await deleteFavorite({ prisma, shopDomain, ...identity, shopifyProductGid });
  return Response.json(result);
};
