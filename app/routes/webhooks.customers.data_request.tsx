import type { ActionFunctionArgs } from "react-router";
import { logger } from "../lib/logger.server";
import { authenticate } from "../shopify.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info(
    { event: "privacy_webhook.received", shopDomain: shop, topic },
    "customer data request webhook received",
  );
  return new Response(null, { status: 200 });
};
