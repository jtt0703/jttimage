import prisma from "../db.server";
import { errorLogFields, logger } from "../lib/logger.server";
import { unauthenticated } from "../shopify.server";
import { createProductImageIndexWorker } from "../services/job-queue.server";
import { runProductImageIndexJob } from "../services/product-indexer.server";

const worker = createProductImageIndexWorker(async ({ jobId, shopDomain }) => {
  const { admin } = await unauthenticated.admin(shopDomain);
  await runProductImageIndexJob({ prisma, admin, jobId });
});

async function shutdown(signal: string) {
  logger.info({ event: "product_index.worker_shutdown_started", signal }, "product image index worker shutting down");
  try {
    await worker.close();
    await prisma.$disconnect();
    logger.info({ event: "product_index.worker_shutdown_completed", signal }, "product image index worker stopped");
    process.exit(0);
  } catch (error) {
    logger.error(
      { event: "product_index.worker_shutdown_failed", signal, ...errorLogFields(error) },
      "product image index worker shutdown failed",
    );
    process.exit(1);
  }
}

process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

logger.info({ event: "product_index.worker_started" }, "product image index worker started");
