import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

type CustomerRedactPayload = {
  shop_domain?: string;
  customer?: { id?: number | string };
  customer_id?: number | string;
};

function customerGidFromPayload(payload: CustomerRedactPayload): string | null {
  const id = payload.customer?.id ?? payload.customer_id;
  if (!id) return null;
  const normalizedId = String(id);
  return normalizedId.startsWith("gid://shopify/Customer/")
    ? normalizedId
    : `gid://shopify/Customer/${normalizedId}`;
}

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const customerGid = customerGidFromPayload(payload as CustomerRedactPayload);

  if (customerGid) {
    await prisma.favoriteProduct.deleteMany({
      where: { shopDomain: shop, identityType: "customer", identityId: customerGid },
    });
    await prisma.imageSearchUpload.deleteMany({
      where: { shopDomain: shop, customerGid },
    });
  }

  logger.info(
    { event: "privacy_webhook.processed", shopDomain: shop, topic, customerGidPresent: Boolean(customerGid) },
    "customer redact webhook processed",
  );
  return new Response(null, { status: 200 });
};
