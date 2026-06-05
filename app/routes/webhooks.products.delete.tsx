import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { errorLogFields, logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";
import { createDefaultMilvusVectorStore } from "../services/milvus-client.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const productId = (payload as { id?: number | string } | undefined)?.id;
  const shopifyProductGid = productId ? `gid://shopify/Product/${productId}` : null;
  logger.info(
    { event: "shopify_webhook.received", shopDomain: shop, topic, shopifyProductGid },
    "shopify product delete webhook received",
  );

  if (!shopifyProductGid) {
    logger.warn({ event: "shopify_webhook.failed", shopDomain: shop, topic }, "product delete webhook missing product id");
    return new Response();
  }

  try {
    const config = getImageSearchConfig();
    const vectorStore = createDefaultMilvusVectorStore(config, { shopDomain: shop });
    await vectorStore.deleteProductVectors({ shopDomain: shop, shopifyProductGid });
    await prisma.shopProduct.deleteMany({ where: { shopDomain: shop, shopifyProductGid } });
    logger.info(
      { event: "shopify_webhook.processed", shopDomain: shop, topic, shopifyProductGid },
      "shopify product delete webhook processed",
    );
  } catch (error) {
    logger.error(
      { event: "shopify_webhook.failed", shopDomain: shop, topic, shopifyProductGid, ...errorLogFields(error) },
      "shopify product delete webhook failed",
    );
    throw error;
  }

  return new Response();
};
