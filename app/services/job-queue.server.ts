import { Queue, Worker, type JobsOptions } from "bullmq";
import { getImageSearchConfig } from "../lib/image-search/env.server";
import { errorLogFields, logger } from "../lib/logger.server";

export const PRODUCT_IMAGE_INDEX_QUEUE = "product-image-index";

export interface ProductImageIndexJobPayload {
  jobId: string;
  shopDomain: string;
}

let productImageIndexQueue: Queue<ProductImageIndexJobPayload> | null = null;

function redisConnection() {
  const config = getImageSearchConfig();
  return { url: config.redisUrl };
}

export function getProductImageIndexQueue(): Queue<ProductImageIndexJobPayload> {
  if (!productImageIndexQueue) {
    productImageIndexQueue = new Queue<ProductImageIndexJobPayload>(PRODUCT_IMAGE_INDEX_QUEUE, {
      connection: redisConnection(),
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 30_000 },
        removeOnComplete: { age: 7 * 24 * 60 * 60, count: 1_000 },
        removeOnFail: { age: 14 * 24 * 60 * 60, count: 1_000 },
      },
    });
  }
  return productImageIndexQueue;
}

export async function enqueueProductImageIndexJob(input: ProductImageIndexJobPayload, options: JobsOptions = {}) {
  const queue = getProductImageIndexQueue();
  const queued = await queue.add("index-shop-products", input, {
    jobId: input.jobId,
    ...options,
  });
  logger.info(
    {
      event: "product_index.enqueued",
      queueName: PRODUCT_IMAGE_INDEX_QUEUE,
      queueJobId: queued.id,
      jobId: input.jobId,
      shopDomain: input.shopDomain,
    },
    "product image index job enqueued",
  );
  return queued;
}

export function createProductImageIndexWorker(
  processor: (payload: ProductImageIndexJobPayload) => Promise<void>,
): Worker<ProductImageIndexJobPayload> {
  const config = getImageSearchConfig();
  const worker = new Worker<ProductImageIndexJobPayload>(
    PRODUCT_IMAGE_INDEX_QUEUE,
    async (job) => {
      logger.info(
        {
          event: "product_index.worker_job_started",
          queueName: PRODUCT_IMAGE_INDEX_QUEUE,
          queueJobId: job.id,
          jobId: job.data.jobId,
          shopDomain: job.data.shopDomain,
          attemptsMade: job.attemptsMade,
        },
        "product image index worker job started",
      );
      try {
        await processor(job.data);
      } catch (error) {
        logger.error(
          {
            event: "product_index.worker_job_failed",
            queueName: PRODUCT_IMAGE_INDEX_QUEUE,
            queueJobId: job.id,
            jobId: job.data.jobId,
            shopDomain: job.data.shopDomain,
            attemptsMade: job.attemptsMade,
            ...errorLogFields(error),
          },
          "product image index worker job failed",
        );
        throw error;
      }
    },
    {
      connection: redisConnection(),
      concurrency: config.productIndexQueueConcurrency,
    },
  );

  worker.on("completed", (job) => {
    logger.info(
      {
        event: "product_index.worker_job_completed",
        queueName: PRODUCT_IMAGE_INDEX_QUEUE,
        queueJobId: job.id,
        jobId: job.data.jobId,
        shopDomain: job.data.shopDomain,
      },
      "product image index worker job completed",
    );
  });

  worker.on("failed", (job, error) => {
    logger.error(
      {
        event: "product_index.worker_job_failed_event",
        queueName: PRODUCT_IMAGE_INDEX_QUEUE,
        queueJobId: job?.id,
        jobId: job?.data.jobId,
        shopDomain: job?.data.shopDomain,
        ...errorLogFields(error),
      },
      "product image index worker emitted failed event",
    );
  });

  return worker;
}
