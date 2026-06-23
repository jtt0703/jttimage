import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);

  await prisma.favoriteProduct.deleteMany({ where: { shopDomain: shop } });
  await prisma.imageSearchUpload.deleteMany({ where: { shopDomain: shop } });
  await prisma.productIndexJob.deleteMany({ where: { shopDomain: shop } });
  await prisma.shopProduct.deleteMany({ where: { shopDomain: shop } });
  await prisma.session.deleteMany({ where: { shop } });

  logger.info({ event: "privacy_webhook.processed", shopDomain: shop, topic }, "shop redact webhook processed");
  return new Response(null, { status: 200 });
};
