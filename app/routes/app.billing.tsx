import { useState } from "react";
import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getBillingPlanConfig } from "../services/billing-plan.server";
import { createSubscription, refreshBillingStatus } from "../services/billing.server";

const SHOPIFY_REAUTHORIZE_HEADER = "X-Shopify-API-Request-Failure-Reauthorize-Url";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const plan = getBillingPlanConfig();
  const billingStatus = await refreshBillingStatus({ prisma, admin, shopDomain: session.shop, plan });

  return {
    shopDomain: session.shop,
    plan,
    billing: {
      entitled: billingStatus.entitled,
      status: billingStatus.state.subscriptionStatus,
      trialUsed: billingStatus.state.trialUsed,
      subscriptionId: billingStatus.state.activeSubscriptionId,
      currentPeriodEnd: billingStatus.state.currentPeriodEnd,
      isTest: plan.isTest,
    },
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session, admin, redirect } = await authenticate.admin(request);
  const formData = await request.formData();
  if (String(formData.get("intent")) !== "start_subscription") {
    return Response.json({ error: "Invalid billing action" }, { status: 400 });
  }

  const { confirmationUrl } = await createSubscription({ prisma, admin, shopDomain: session.shop, request });
  return redirect(confirmationUrl, { target: "_top" });
};

export default function BillingPage() {
  const { billing, plan, shopDomain } = useLoaderData<typeof loader>();
  const shopify = useAppBridge();
  const [isStarting, setIsStarting] = useState(false);
  const price = `$${plan.monthlyPrice.toFixed(2)} ${plan.currencyCode}/month`;
  const trialCopy = billing.trialUsed
    ? "Free trial already used for this store."
    : `${plan.trialDays}-day free trial included.`;

  async function startSubscription() {
    if (isStarting) return;

    setIsStarting(true);
    try {
      const idToken = await shopify.idToken();
      const body = new FormData();
      body.set("intent", "start_subscription");

      const response = await fetch("/app/billing", {
        method: "POST",
        headers: { Authorization: `Bearer ${idToken}` },
        body,
      });
      const redirectUrl = response.headers.get(SHOPIFY_REAUTHORIZE_HEADER) ?? response.headers.get("Location");

      if (redirectUrl) {
        window.open(redirectUrl, "_top");
        return;
      }

      throw new Error(`Billing request did not return a redirect: ${response.status}`);
    } catch (error) {
      console.error("Unable to start subscription", error);
      shopify.toast.show("Unable to start subscription. Try again.", { isError: true });
      setIsStarting(false);
    }
  }

  return (
    <s-page heading="Billing">
      <s-section heading="Starter plan">
        <s-stack direction="block" gap="small">
          <s-paragraph>Shop: {shopDomain}</s-paragraph>
          <s-paragraph>
            {price}. {trialCopy}
          </s-paragraph>
          <s-paragraph>Mode: {billing.isTest ? "Test billing" : "Live billing"}</s-paragraph>
          <s-paragraph>Subscription status: {billing.entitled ? "Active" : "Inactive"}</s-paragraph>
          {billing.currentPeriodEnd ? (
            <s-paragraph>Current period ends: {new Date(billing.currentPeriodEnd).toLocaleString()}</s-paragraph>
          ) : null}
        </s-stack>
      </s-section>

      <s-section heading={billing.entitled ? "Subscription active" : "Start subscription"}>
        {billing.entitled ? (
          <s-paragraph>Your Lens Search subscription is active. You can use indexing and storefront search.</s-paragraph>
        ) : (
          <s-button onClick={startSubscription} {...(isStarting ? { loading: true } : {})}>
            Start subscription
          </s-button>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
