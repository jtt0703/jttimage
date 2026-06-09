import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  return null;
};

export default function SettingsPage() {
  return (
    <s-page heading="Storefront Settings">
      <s-section heading="Image search widget">
        <s-paragraph>
          Configure the LensCart AI app embed from the Shopify theme editor. Merchants can choose one of four floating
          button positions: bottom right, bottom left, middle right, or middle left.
        </s-paragraph>
        <s-unordered-list>
          <s-list-item>Enable the LensCart AI Image Search app embed.</s-list-item>
          <s-list-item>Keep the API base URL set to /apps/lens-cart-ai unless your app proxy changes.</s-list-item>
          <s-list-item>Pick a floating button position that does not conflict with chat or cart widgets.</s-list-item>
        </s-unordered-list>
      </s-section>

      <s-section heading="Launch checklist">
        <s-unordered-list>
          <s-list-item>Confirm storefront image search returns nine relevant products.</s-list-item>
          <s-list-item>Confirm product create, update, and delete webhooks keep indexed images current.</s-list-item>
          <s-list-item>Replace development URLs with the production HTTPS app domain before Shopify review.</s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
