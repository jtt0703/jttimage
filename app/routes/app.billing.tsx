import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function BillingPage() {
  return (
    <s-page heading="Billing">
      <s-section heading="Starter plan">
        <s-paragraph>
          Planned launch pricing: Starter at USD 7/month with a 7-day free trial. Shopify App Pricing will be connected
          after the production HTTPS deployment and Partner Dashboard pricing setup are complete.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Monthly subscription managed by Shopify App Pricing.</s-list-item>
          <s-list-item>Seven-day free trial for new merchants.</s-list-item>
          <s-list-item>Plan change and active subscription checks will be added before App Store submission.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
