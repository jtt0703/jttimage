import type { PrismaClient, ShopBillingState } from "@prisma/client";
import { getBillingPlanConfig, type BillingPlanConfig } from "./billing-plan.server";

export const BILLING_REQUIRED_MESSAGE = "Lens Search billing is not active for this store.";

export type ShopifySubscription = {
  id: string;
  name: string;
  status: string;
  test: boolean;
  trialDays: number;
  createdAt?: string | null;
  currentPeriodEnd?: string | null;
};

type AdminGraphqlClient = {
  graphql(query: string, options?: { variables?: Record<string, unknown> }): Promise<Response>;
};

export class BillingAccessError extends Error {
  status = 402;
  code = "billing_required";
  reason = "billing_inactive";
  plan = getBillingPlanConfig().planName;

  constructor(message = BILLING_REQUIRED_MESSAGE) {
    super(message);
    this.name = "BillingAccessError";
  }

  toResponseBody() {
    return {
      error: this.message,
      code: this.code,
      reason: this.reason,
      plan: this.plan,
    };
  }
}

export function billingAccessErrorResponse(error: unknown): Response | null {
  if (!(error instanceof BillingAccessError)) return null;
  return Response.json(error.toResponseBody(), { status: error.status });
}

function parseDate(value: string | null | undefined): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date: Date, days: number): Date {
  const copy = new Date(date);
  copy.setUTCDate(copy.getUTCDate() + days);
  return copy;
}

export function selectActiveSubscription(
  subscriptions: ShopifySubscription[],
  plan: Pick<BillingPlanConfig, "planName">,
): ShopifySubscription | null {
  return (
    subscriptions.find((subscription) => {
      return subscription.name === plan.planName && subscription.status === "ACTIVE";
    }) ?? null
  );
}

export function subscriptionDataFromShopify(input: {
  shopDomain: string;
  planName: string;
  previousTrialUsed: boolean;
  subscription: ShopifySubscription | null;
  now: Date;
}): Omit<ShopBillingState, "id" | "createdAt" | "updatedAt"> {
  const createdAt = parseDate(input.subscription?.createdAt);
  const trialUsed = input.previousTrialUsed || Boolean(input.subscription && input.subscription.trialDays > 0);
  return {
    shopDomain: input.shopDomain,
    planName: input.planName,
    trialUsed,
    trialStartedAt: createdAt && input.subscription && input.subscription.trialDays > 0 ? createdAt : null,
    trialEndedAt:
      createdAt && input.subscription && input.subscription.trialDays > 0
        ? addDays(createdAt, input.subscription.trialDays)
        : null,
    activeSubscriptionId: input.subscription?.id ?? null,
    subscriptionStatus: input.subscription ? "active" : "inactive",
    subscriptionTest: input.subscription?.test ?? null,
    subscriptionCreatedAt: createdAt,
    currentPeriodEnd: parseDate(input.subscription?.currentPeriodEnd),
    lastCheckedAt: input.now,
  };
}

export function isBillingStateFresh(input: { lastCheckedAt: Date | null; now: Date; cacheSeconds: number }): boolean {
  if (!input.lastCheckedAt) return false;
  return input.now.getTime() - input.lastCheckedAt.getTime() <= input.cacheSeconds * 1000;
}

export function buildBillingReturnUrl(request: Request, shopDomain: string): string {
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  const requestUrl = new URL(request.url);
  const returnUrl = new URL("/app/billing/return", baseUrl);
  returnUrl.searchParams.set("shop", shopDomain);
  const host = requestUrl.searchParams.get("host");
  if (host) returnUrl.searchParams.set("host", host);
  returnUrl.searchParams.set("embedded", requestUrl.searchParams.get("embedded") || "1");
  return returnUrl.toString();
}

export function buildSubscriptionCreateVariables(input: {
  plan: BillingPlanConfig;
  returnUrl: string;
  trialUsed: boolean;
}) {
  const variables: Record<string, unknown> = {
    name: input.plan.planName,
    returnUrl: input.returnUrl,
    test: input.plan.isTest,
    lineItems: [
      {
        plan: {
          appRecurringPricingDetails: {
            price: {
              amount: input.plan.monthlyPrice,
              currencyCode: input.plan.currencyCode,
            },
            interval: "EVERY_30_DAYS",
          },
        },
      },
    ],
  };
  if (!input.trialUsed && input.plan.trialDays > 0) variables.trialDays = input.plan.trialDays;
  return variables;
}

const ACTIVE_SUBSCRIPTIONS_QUERY = `#graphql
  query CurrentAppInstallationSubscriptions {
    currentAppInstallation {
      activeSubscriptions {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
    }
  }
`;

const APP_SUBSCRIPTION_CREATE_MUTATION = `#graphql
  mutation AppSubscriptionCreate(
    $name: String!
    $returnUrl: URL!
    $test: Boolean!
    $trialDays: Int
    $lineItems: [AppSubscriptionLineItemInput!]!
  ) {
    appSubscriptionCreate(
      name: $name
      returnUrl: $returnUrl
      test: $test
      trialDays: $trialDays
      lineItems: $lineItems
    ) {
      confirmationUrl
      appSubscription {
        id
        name
        status
        test
        trialDays
        createdAt
        currentPeriodEnd
      }
      userErrors {
        field
        message
      }
    }
  }
`;

export async function getOrCreateBillingState(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  shopDomain: string;
  plan?: BillingPlanConfig;
}): Promise<ShopBillingState> {
  const plan = input.plan ?? getBillingPlanConfig();
  return input.prisma.shopBillingState.upsert({
    where: { shopDomain: input.shopDomain },
    update: { planName: plan.planName },
    create: {
      shopDomain: input.shopDomain,
      planName: plan.planName,
      subscriptionStatus: "inactive",
    },
  });
}

async function fetchActiveSubscription(
  admin: AdminGraphqlClient,
  plan: BillingPlanConfig,
): Promise<ShopifySubscription | null> {
  const response = await admin.graphql(ACTIVE_SUBSCRIPTIONS_QUERY);
  const body = (await response.json()) as {
    errors?: unknown[];
    data?: { currentAppInstallation?: { activeSubscriptions?: ShopifySubscription[] } };
  };
  if (body.errors?.length) throw new Error("Unable to check Shopify billing subscriptions");
  return selectActiveSubscription(body.data?.currentAppInstallation?.activeSubscriptions ?? [], plan);
}

export async function refreshBillingStatus(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  admin: AdminGraphqlClient;
  shopDomain: string;
  plan?: BillingPlanConfig;
  now?: Date;
}): Promise<{ entitled: boolean; state: ShopBillingState; subscription: ShopifySubscription | null }> {
  const plan = input.plan ?? getBillingPlanConfig();
  const now = input.now ?? new Date();
  const currentState = await getOrCreateBillingState({ prisma: input.prisma, shopDomain: input.shopDomain, plan });
  const subscription = await fetchActiveSubscription(input.admin, plan);
  const data = subscriptionDataFromShopify({
    shopDomain: input.shopDomain,
    planName: plan.planName,
    previousTrialUsed: currentState.trialUsed,
    subscription,
    now,
  });
  const state = await input.prisma.shopBillingState.update({
    where: { shopDomain: input.shopDomain },
    data,
  });
  return { entitled: Boolean(subscription), state, subscription };
}

export async function getCachedBillingEntitlement(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  shopDomain: string;
  plan?: BillingPlanConfig;
  now?: Date;
}): Promise<{ entitled: boolean; state: ShopBillingState | null; fresh: boolean }> {
  const plan = input.plan ?? getBillingPlanConfig();
  const now = input.now ?? new Date();
  const state = await input.prisma.shopBillingState.findUnique({ where: { shopDomain: input.shopDomain } });
  const fresh = isBillingStateFresh({
    lastCheckedAt: state?.lastCheckedAt ?? null,
    now,
    cacheSeconds: plan.entitlementCacheSeconds,
  });
  return { entitled: Boolean(state && state.subscriptionStatus === "active"), state, fresh };
}

export async function requireBillingAccess(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  shopDomain: string;
  admin?: AdminGraphqlClient;
  plan?: BillingPlanConfig;
  now?: Date;
}): Promise<ShopBillingState> {
  const plan = input.plan ?? getBillingPlanConfig();
  if (input.admin) {
    const refreshed = await refreshBillingStatus({
      prisma: input.prisma,
      admin: input.admin,
      shopDomain: input.shopDomain,
      plan,
      now: input.now,
    });
    if (!refreshed.entitled) throw new BillingAccessError();
    return refreshed.state;
  }

  const cached = await getCachedBillingEntitlement({
    prisma: input.prisma,
    shopDomain: input.shopDomain,
    plan,
    now: input.now,
  });
  if (!cached.entitled || !cached.state) throw new BillingAccessError();
  return cached.state;
}

export async function createSubscription(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  admin: AdminGraphqlClient;
  shopDomain: string;
  request: Request;
  plan?: BillingPlanConfig;
}): Promise<{ confirmationUrl: string }> {
  const plan = input.plan ?? getBillingPlanConfig();
  const state = await getOrCreateBillingState({ prisma: input.prisma, shopDomain: input.shopDomain, plan });
  const variables = buildSubscriptionCreateVariables({
    plan,
    returnUrl: buildBillingReturnUrl(input.request, input.shopDomain),
    trialUsed: state.trialUsed,
  });
  const response = await input.admin.graphql(APP_SUBSCRIPTION_CREATE_MUTATION, { variables });
  const body = (await response.json()) as {
    errors?: unknown[];
    data?: { appSubscriptionCreate?: { confirmationUrl?: string; userErrors?: Array<{ message: string }> } };
  };
  if (body.errors?.length) throw new Error("Unable to create Shopify subscription");
  const result = body.data?.appSubscriptionCreate;
  const userError = result?.userErrors?.[0];
  if (userError) throw new Error(userError.message);
  if (!result?.confirmationUrl) throw new Error("Shopify did not return a subscription confirmation URL");
  return { confirmationUrl: result.confirmationUrl };
}
