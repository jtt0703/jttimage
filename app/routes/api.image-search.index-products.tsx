import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { authenticate } from "../shopify.server";
import { enqueueProductImageIndexJob } from "../services/job-queue.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "force" ? "force" : "incremental";
  const config = getImageSearchConfig();
  const sourceFilter = {
    query: config.shopifyProductQuery,
    mode: "configured_product_query",
    first: config.shopifyProductsPageSize,
  };

  logger.info(
    {
      event: "product_index.enqueue_requested",
      shopDomain: session.shop,
      mode,
      sourceFilter,
    },
    "product image index enqueue requested",
  );

  const job = await prisma.productIndexJob.create({
    data: {
      shopDomain: session.shop,
      status: "queued",
      mode,
      sourceFilter,
    },
  });

  await enqueueProductImageIndexJob({ jobId: job.id, shopDomain: session.shop });

  return Response.json(
    {
      jobId: job.id,
      status: job.status,
      productsSeen: job.productsSeen,
      variantsSeen: job.variantsSeen,
      imagesSeen: job.imagesSeen,
      imagesIndexed: job.imagesIndexed,
      imagesSkipped: job.imagesSkipped,
      imagesFailed: job.imagesFailed,
    },
    { status: 202 },
  );
};
