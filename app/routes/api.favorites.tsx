import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { validateIdentity, validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";
import { addFavorite, listFavoriteProductGids } from "../services/favorites.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  const shopDomain = validateShopDomain(url.searchParams.get("shop"));
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const identity = validateIdentity({
    identityType: url.searchParams.get("identityType"),
    identityId: url.searchParams.get("identityId"),
  });
  const favorites = await listFavoriteProductGids({ prisma, shopDomain, ...identity });
  return Response.json({ favorites });
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? ""))
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  const body = await request.json();
  const shopDomain = validateShopDomain(body.shop);
  const identity = validateIdentity({ identityType: body.identityType, identityId: body.identityId });
  const result = await addFavorite({
    prisma,
    shopDomain,
    ...identity,
    shopifyProductGid: body.shopifyProductGid,
    shopifyVariantGid: body.shopifyVariantGid ?? null,
    sourceSurface: body.sourceSurface ?? "image_search",
  });
  return Response.json(result);
};
