import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { runProductImageIndexJob } from "../services/product-indexer.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const body = await request.json().catch(() => ({}));
  const mode = body.mode === "force" ? "force" : "incremental";
  const job = await runProductImageIndexJob({ prisma, admin, mode });

  return Response.json({
    jobId: job.id,
    status: job.status,
    productsSeen: job.productsSeen,
    variantsSeen: job.variantsSeen,
    imagesSeen: job.imagesSeen,
    imagesIndexed: job.imagesIndexed,
    imagesSkipped: job.imagesSkipped,
    imagesFailed: job.imagesFailed,
  });
};
