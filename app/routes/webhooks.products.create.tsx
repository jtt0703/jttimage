import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";
import { enqueueProductImageIndexJob } from "../services/job-queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic, payload } = await authenticate.webhook(request);
  const config = getImageSearchConfig();
  const productId = (payload as { id?: number | string } | undefined)?.id;
  const productGid = productId ? `gid://shopify/Product/${productId}` : null;
  const sourceFilter = productGid
    ? { topic, productGid, query: `id:${productId}`, first: 1, mode: "webhook_product" }
    : { topic, query: config.shopifyProductQuery, mode: "webhook_incremental" };
  logger.info(
    { event: "shopify_webhook.received", shopDomain: shop, topic, shopifyProductGid: productGid },
    "shopify product create webhook received",
  );

  const job = await prisma.productIndexJob.create({
    data: {
      shopDomain: shop,
      status: "queued",
      mode: "incremental",
      sourceFilter,
    },
  });
  await enqueueProductImageIndexJob({ jobId: job.id, shopDomain: shop });
  logger.info(
    { event: "shopify_webhook.enqueued", shopDomain: shop, topic, jobId: job.id, shopifyProductGid: productGid },
    "shopify webhook index job enqueued",
  );

  return new Response();
};
