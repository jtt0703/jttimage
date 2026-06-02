import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import {
  normalizeLimit,
  parseBooleanParam,
  validateShopDomain,
  verifyShopifyProxySignature,
} from "../lib/image-search/validation.server";
import { runImageSearch } from "../services/image-search.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const url = new URL(request.url);
  const formData = await request.formData();
  const shopDomain = validateShopDomain(String(formData.get("shop") ?? url.searchParams.get("shop") ?? ""));

  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
  if (!installedSession) {
    return Response.json({ error: "Shop is not installed" }, { status: 403 });
  }

  const file = formData.get("image");
  if (!(file instanceof File)) {
    return Response.json({ error: "Image file is required" }, { status: 400 });
  }

  try {
    const result = await runImageSearch({
      prisma,
      shopDomain,
      anonymousId: String(formData.get("anonymousId") ?? ""),
      customerGid: formData.get("customerGid") ? String(formData.get("customerGid")) : null,
      file,
      limit: normalizeLimit(String(formData.get("limit") ?? ""), 12, 48),
      availableOnly: parseBooleanParam(String(formData.get("availableOnly") ?? "true"), true),
    });
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Something went wrong. Please try again." },
      { status: 400 },
    );
  }
};
