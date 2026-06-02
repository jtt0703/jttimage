import { useEffect } from "react";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const lastJob = await prisma.productIndexJob.findFirst({
    where: { shopDomain: session.shop },
    orderBy: { createdAt: "desc" },
  });

  return { lastJob };
};

export default function Index() {
  const { lastJob } = useLoaderData<typeof loader>();
  const fetcher = useFetcher();
  const shopify = useAppBridge();
  const isLoading = ["loading", "submitting"].includes(fetcher.state);

  useEffect(() => {
    const data = fetcher.data as { status?: string; imagesFailed?: number } | undefined;
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

  const currentJob = (fetcher.data as typeof lastJob | undefined) ?? lastJob;

  return (
    <s-page heading="Image Search Indexing">
      <s-section heading="Product image index">
        <s-paragraph>
          Index Shopify products tagged with <strong>lenscart-test</strong> and status <strong>active</strong> during
          development.
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

      <s-section heading="Last index job">
        {currentJob ? (
          <s-stack direction="block" gap="small">
            <s-paragraph>Status: {currentJob.status}</s-paragraph>
            <s-paragraph>Mode: {currentJob.mode}</s-paragraph>
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
