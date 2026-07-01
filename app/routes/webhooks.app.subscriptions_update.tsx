import type { ActionFunctionArgs } from "react-router";
import prisma from "../db.server";
import { logger } from "../lib/logger.server";
import { authenticate, unauthenticated } from "../shopify.server";
import { refreshBillingStatus } from "../services/billing.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop, topic } = await authenticate.webhook(request);
  logger.info({ event: "billing_webhook.received", shopDomain: shop, topic }, "app subscription webhook received");

  const { admin } = await unauthenticated.admin(shop);
  const billingStatus = await refreshBillingStatus({ prisma, admin, shopDomain: shop });
  logger.info(
    {
      event: "billing_webhook.refreshed",
      shopDomain: shop,
      topic,
      entitled: billingStatus.entitled,
      subscriptionStatus: billingStatus.state.subscriptionStatus,
      activeSubscriptionId: billingStatus.state.activeSubscriptionId,
    },
    "app subscription webhook refreshed billing state",
  );

  return new Response();
};
