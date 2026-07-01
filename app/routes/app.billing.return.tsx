import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { redirectWithCurrentSearch } from "../lib/redirect.server";
import { authenticate } from "../shopify.server";
import { refreshBillingStatus } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const billingStatus = await refreshBillingStatus({ prisma, admin, shopDomain: session.shop });
  return redirect(redirectWithCurrentSearch(request, billingStatus.entitled ? "/app" : "/app/billing"));
};
