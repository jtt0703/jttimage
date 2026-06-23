import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { redirectWithCurrentSearch } from "../lib/redirect.server";
import { authenticate } from "../shopify.server";
import { BillingAccessError, requireBillingAccess } from "../services/billing.server";

type IndexJobActionResult = {
  jobId?: string;
  status?: string;
  imagesFailed?: number;
};

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  try {
    await requireBillingAccess({ prisma, admin, shopDomain: session.shop });
  } catch (error) {
    if (error instanceof BillingAccessError) throw redirect(redirectWithCurrentSearch(request, "/app/billing"));
    throw error;
  }

  const [lastJob, totalImages, indexedImages, pendingImages] = await Promise.all([
    prisma.productIndexJob.findFirst({
      where: { shopDomain: session.shop },
      orderBy: { createdAt: "desc" },
    }),
    prisma.shopProductImage.count({ where: { shopDomain: session.shop } }),
    prisma.shopProductImage.count({ where: { shopDomain: session.shop, embeddingStatus: "indexed" } }),
    prisma.shopProductImage.count({ where: { shopDomain: session.shop, embeddingStatus: "pending" } }),
  ]);

  return { indexedImages, lastJob, pendingImages, totalImages };
};

export default function Index() {
  const { indexedImages, lastJob, pendingImages, totalImages } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading = ["loading", "submitting"].includes(fetcher.state);
  const queuedJob = fetcher.data as IndexJobActionResult | undefined;
  const hasQueuedJob = queuedJob?.status === "queued" || queuedJob?.status === "running";

  useEffect(() => {
    const data = fetcher.data as IndexJobActionResult | undefined;
    if (data?.status === "queued" || data?.status === "running") {
      shopify.toast.show("Index job queued. Refresh this page in a moment to see updated counts.");
      return;
    }
    if (data?.status === "completed") {
      shopify.toast.show(data.imagesFailed && data.imagesFailed > 0 ? "Index completed with failed images" : "Index completed");
    }
  }, [fetcher.data, shopify]);

  function startIndex(mode: "incremental" | "force") {
    fetcher.submit(JSON.stringify({ mode }), {
      method: "POST",
      action: "/api/image-search/index-products",
      encType: "application/json",
    });
  }

  const currentJob = lastJob;
  const currentJobIsProcessing = currentJob?.status === "queued" || currentJob?.status === "running";

  return (
    <s-page heading="LensCart AI Overview">
      <s-section heading="Indexing health">
        <s-stack direction="block" gap="small">
          <s-paragraph>Indexed images: {indexedImages}</s-paragraph>
          <s-paragraph>Pending images: {pendingImages}</s-paragraph>
          <s-paragraph>Total synced images: {totalImages}</s-paragraph>
        </s-stack>
      </s-section>

      <s-section heading="Product image index">
        <s-paragraph>
          Use these buttons to index products from the configured Shopify product query. Shopify product create, update,
          and delete changes are handled automatically by webhooks.
        </s-paragraph>
        <s-stack direction="inline" gap="base">
          <s-button onClick={() => startIndex("incremental")} {...(isLoading ? { loading: true } : {})}>
            Index product images
          </s-button>
          <s-button variant="secondary" onClick={() => startIndex("force")} {...(isLoading ? { loading: true } : {})}>
            Re-index product images
          </s-button>
        </s-stack>
      </s-section>

      {hasQueuedJob ? (
        <s-section heading="Index job queued">
          <s-paragraph>
            The worker is processing this job in the background. Wait a moment, then refresh this page to see updated
            counts.
          </s-paragraph>
          <s-button onClick={() => window.location.reload()}>Refresh status</s-button>
        </s-section>
      ) : null}

      <s-section heading="Storefront readiness">
        <s-paragraph>
          The storefront image search widget is configured in the Shopify theme editor. Use Settings to review the app
          embed options before taking App Store screenshots.
        </s-paragraph>
        <s-link href="/app/settings">Review storefront settings</s-link>
      </s-section>

      <s-section heading="Last index job">
        {currentJob ? (
          <s-stack direction="block" gap="small">
            <s-paragraph>Status: {currentJob.status}</s-paragraph>
            <s-paragraph>Mode: {currentJob.mode}</s-paragraph>
            {currentJobIsProcessing ? (
              <s-paragraph>Counts will appear after the background job completes.</s-paragraph>
            ) : (
              <>
                <s-paragraph>Products seen: {currentJob.productsSeen}</s-paragraph>
                <s-paragraph>Variants seen: {currentJob.variantsSeen}</s-paragraph>
                <s-paragraph>Images seen: {currentJob.imagesSeen}</s-paragraph>
                <s-paragraph>Images indexed: {currentJob.imagesIndexed}</s-paragraph>
                <s-paragraph>Images skipped: {currentJob.imagesSkipped}</s-paragraph>
                <s-paragraph>Images failed: {currentJob.imagesFailed}</s-paragraph>
                <s-paragraph>Started at: {currentJob.startedAt ? new Date(currentJob.startedAt).toLocaleString() : "Not started"}</s-paragraph>
                <s-paragraph>
                  Completed at: {currentJob.completedAt ? new Date(currentJob.completedAt).toLocaleString() : "Not completed"}
                </s-paragraph>
                {currentJob.errorMessage ? <s-paragraph tone="critical">Error: {currentJob.errorMessage}</s-paragraph> : null}
              </>
            )}
          </s-stack>
        ) : (
          <s-paragraph>No index jobs yet.</s-paragraph>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
