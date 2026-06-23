# Shopify Billing Subscription Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add real Shopify Billing API subscription creation and enforcement so Lens Search is usable only by shops with an active `Starter` subscription.

**Architecture:** Billing is implemented as a small service layer backed by a persistent `ShopBillingState` Prisma model. Shopify is the source of truth for active subscriptions via Admin GraphQL `currentAppInstallation.activeSubscriptions`; local DB caches entitlement freshness and trial history so uninstall/reinstall cannot grant a second trial. Admin routes and storefront API routes call shared gate helpers, while `/app/billing` and auth/webhook routes remain reachable without entitlement.

**Tech Stack:** React Router route modules, Shopify App React Router auth clients, Admin GraphQL Billing API, Prisma/PostgreSQL, Vitest, Shopify app proxy storefront routes.

---

## File Structure

- Modify: `prisma/schema.prisma` — add `ShopBillingState` model.
- Create: `prisma/migrations/<timestamp>_shop_billing_state/migration.sql` — add table and indexes.
- Create: `app/services/billing-plan.server.ts` — central env-backed plan config.
- Create: `app/services/billing.server.ts` — GraphQL subscription create/check, local state sync, entitlement gates, route response helpers.
- Modify: `app/routes/app.billing.tsx` — real billing status page and subscription action.
- Create: `app/routes/app.billing.return.tsx` — Shopify confirmation return route.
- Modify: `app/routes/app._index.tsx` — require active subscription before showing admin indexing page.
- Modify: `app/routes/app.settings.tsx` — require active subscription before settings.
- Modify: `app/routes/api.image-search.index-products.tsx` — block indexing without active subscription.
- Modify: `app/routes/api.image-search.search.tsx` — block storefront image search without active subscription.
- Modify: `app/routes/api.recommendations.similar-products.tsx` — block similar products without active subscription.
- Modify: `app/routes/api.favorites.tsx` — block favorite list/add without active subscription.
- Modify: `app/routes/api.favorites.delete.tsx` — block favorite delete without active subscription.
- Modify: `app/routes/api.upload-history.tsx` — block upload history without active subscription.
- Modify: `app/routes/api.wishlist.tsx` — return friendly HTML unavailable page without active subscription.
- Modify: `app/routes/webhooks.app.uninstalled.tsx` — keep billing state when deleting sessions.
- Modify: `extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js` — display friendly subscription-unavailable messages for `402` JSON responses.
- Modify: `.env.example` — add billing env keys.
- Add/update tests near existing route/service tests.

---

### Task 1: Add persistent billing state schema

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/20260611000000_shop_billing_state/migration.sql`

- [ ] **Step 1: Add Prisma model**

Append this model after `Session` in `prisma/schema.prisma`:

```prisma
model ShopBillingState {
  id                    String    @id @default(uuid())
  shopDomain            String    @unique @map("shop_domain")
  planName              String    @map("plan_name")
  trialUsed             Boolean   @default(false) @map("trial_used")
  trialStartedAt        DateTime? @map("trial_started_at")
  trialEndedAt          DateTime? @map("trial_ended_at")
  activeSubscriptionId  String?   @map("active_subscription_id")
  subscriptionStatus    String    @default("inactive") @map("subscription_status")
  subscriptionTest      Boolean?  @map("subscription_test")
  subscriptionCreatedAt DateTime? @map("subscription_created_at")
  currentPeriodEnd      DateTime? @map("current_period_end")
  lastCheckedAt         DateTime? @map("last_checked_at")
  createdAt             DateTime  @default(now()) @map("created_at")
  updatedAt             DateTime  @updatedAt @map("updated_at")

  @@index([subscriptionStatus])
  @@index([lastCheckedAt])
  @@map("shop_billing_states")
}
```

- [ ] **Step 2: Add migration SQL**

Create `prisma/migrations/20260611000000_shop_billing_state/migration.sql`:

```sql
-- CreateTable
CREATE TABLE "shop_billing_states" (
    "id" TEXT NOT NULL,
    "shop_domain" TEXT NOT NULL,
    "plan_name" TEXT NOT NULL,
    "trial_used" BOOLEAN NOT NULL DEFAULT false,
    "trial_started_at" TIMESTAMP(3),
    "trial_ended_at" TIMESTAMP(3),
    "active_subscription_id" TEXT,
    "subscription_status" TEXT NOT NULL DEFAULT 'inactive',
    "subscription_test" BOOLEAN,
    "subscription_created_at" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "last_checked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_billing_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "shop_billing_states_shop_domain_key" ON "shop_billing_states"("shop_domain");

-- CreateIndex
CREATE INDEX "shop_billing_states_subscription_status_idx" ON "shop_billing_states"("subscription_status");

-- CreateIndex
CREATE INDEX "shop_billing_states_last_checked_at_idx" ON "shop_billing_states"("last_checked_at");
```

- [ ] **Step 3: Generate Prisma client**

Run:

```bash
npm exec prisma generate
```

Expected: Prisma Client generated successfully and exposes `prisma.shopBillingState`.

- [ ] **Step 4: Commit schema change**

```bash
git add prisma/schema.prisma prisma/migrations/20260611000000_shop_billing_state/migration.sql
git commit -m "feat: add shop billing state model"
```

---

### Task 2: Add billing plan config service

**Files:**
- Create: `app/services/billing-plan.server.ts`
- Create: `app/services/billing-plan.server.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Write config tests**

Create `app/services/billing-plan.server.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBillingPlanConfig, resolveShopifyBillingTestMode } from "./billing-plan.server";

describe("billing plan config", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("uses Starter launch defaults", () => {
    const config = getBillingPlanConfig({});

    expect(config).toEqual({
      planName: "Starter",
      monthlyPrice: 7.99,
      currencyCode: "USD",
      trialDays: 14,
      entitlementCacheSeconds: 300,
      isTest: true,
    });
  });

  it("reads production test mode from SHOPIFY_BILLING_TEST=false", () => {
    vi.stubEnv("SHOPIFY_BILLING_TEST", "false");

    expect(resolveShopifyBillingTestMode(process.env)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

Run:

```bash
npm test -- app/services/billing-plan.server.test.ts
```

Expected: fails because `billing-plan.server.ts` does not exist.

- [ ] **Step 3: Implement config service**

Create `app/services/billing-plan.server.ts`:

```ts
export type BillingPlanConfig = {
  planName: string;
  monthlyPrice: number;
  currencyCode: string;
  trialDays: number;
  entitlementCacheSeconds: number;
  isTest: boolean;
};

function stringEnv(env: Record<string, string | undefined>, name: string, fallback: string): string {
  const value = env[name]?.trim();
  return value ? value : fallback;
}

function numberEnv(env: Record<string, string | undefined>, name: string, fallback: number): number {
  const value = env[name];
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function resolveShopifyBillingTestMode(env: Record<string, string | undefined> = process.env): boolean {
  return env.SHOPIFY_BILLING_TEST !== "false";
}

export function getBillingPlanConfig(env: Record<string, string | undefined> = process.env): BillingPlanConfig {
  return {
    planName: stringEnv(env, "BILLING_PLAN_NAME", "Starter"),
    monthlyPrice: numberEnv(env, "BILLING_MONTHLY_PRICE", 7.99),
    currencyCode: stringEnv(env, "BILLING_CURRENCY_CODE", "USD"),
    trialDays: Math.max(0, Math.floor(numberEnv(env, "BILLING_TRIAL_DAYS", 14))),
    entitlementCacheSeconds: Math.max(0, Math.floor(numberEnv(env, "BILLING_ENTITLEMENT_CACHE_SECONDS", 300))),
    isTest: resolveShopifyBillingTestMode(env),
  };
}
```

- [ ] **Step 4: Add `.env.example` keys**

Append to `.env.example`:

```env
SHOPIFY_BILLING_TEST=true
BILLING_PLAN_NAME=Starter
BILLING_MONTHLY_PRICE=7.99
BILLING_CURRENCY_CODE=USD
BILLING_TRIAL_DAYS=14
BILLING_ENTITLEMENT_CACHE_SECONDS=300
```

- [ ] **Step 5: Run test and verify pass**

Run:

```bash
npm test -- app/services/billing-plan.server.test.ts
```

Expected: 2 tests pass.

- [ ] **Step 6: Commit config service**

```bash
git add .env.example app/services/billing-plan.server.ts app/services/billing-plan.server.test.ts
git commit -m "feat: add billing plan config"
```

---

### Task 3: Implement billing service core

**Files:**
- Create: `app/services/billing.server.ts`
- Create: `app/services/billing.server.test.ts`

- [ ] **Step 1: Write service tests**

Create `app/services/billing.server.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import {
  BillingAccessError,
  buildBillingReturnUrl,
  buildSubscriptionCreateVariables,
  isBillingStateFresh,
  selectActiveSubscription,
  subscriptionDataFromShopify,
} from "./billing.server";

const plan = {
  planName: "Starter",
  monthlyPrice: 7.99,
  currencyCode: "USD",
  trialDays: 14,
  entitlementCacheSeconds: 300,
  isTest: true,
};

describe("billing service", () => {
  it("selects the configured active test subscription", () => {
    const subscription = selectActiveSubscription(
      [
        { id: "gid://shopify/AppSubscription/1", name: "Other", status: "ACTIVE", test: true, trialDays: 14 },
        { id: "gid://shopify/AppSubscription/2", name: "Starter", status: "ACTIVE", test: true, trialDays: 14 },
      ],
      plan,
    );

    expect(subscription?.id).toBe("gid://shopify/AppSubscription/2");
  });

  it("does not select test subscriptions in live mode", () => {
    const subscription = selectActiveSubscription(
      [{ id: "gid://shopify/AppSubscription/2", name: "Starter", status: "ACTIVE", test: true, trialDays: 14 }],
      { ...plan, isTest: false },
    );

    expect(subscription).toBeNull();
  });

  it("marks trial used only for active subscription with trialDays greater than zero", () => {
    const data = subscriptionDataFromShopify({
      shopDomain: "demo.myshopify.com",
      planName: "Starter",
      previousTrialUsed: false,
      subscription: {
        id: "sub-1",
        name: "Starter",
        status: "ACTIVE",
        test: true,
        trialDays: 14,
        createdAt: "2026-06-11T00:00:00Z",
        currentPeriodEnd: "2026-07-11T00:00:00Z",
      },
      now: new Date("2026-06-11T00:10:00Z"),
    });

    expect(data.trialUsed).toBe(true);
    expect(data.subscriptionStatus).toBe("active");
    expect(data.activeSubscriptionId).toBe("sub-1");
  });

  it("clears active subscription without clearing trial history", () => {
    const data = subscriptionDataFromShopify({
      shopDomain: "demo.myshopify.com",
      planName: "Starter",
      previousTrialUsed: true,
      subscription: null,
      now: new Date("2026-06-11T00:10:00Z"),
    });

    expect(data.trialUsed).toBe(true);
    expect(data.subscriptionStatus).toBe("inactive");
    expect(data.activeSubscriptionId).toBeNull();
  });

  it("omits trialDays once trial was used", () => {
    const variables = buildSubscriptionCreateVariables({
      plan,
      returnUrl: "https://search.pagelumo.com/app/billing/return",
      trialUsed: true,
    });

    expect(variables.trialDays).toBeUndefined();
  });

  it("includes trialDays before trial was used", () => {
    const variables = buildSubscriptionCreateVariables({
      plan,
      returnUrl: "https://search.pagelumo.com/app/billing/return",
      trialUsed: false,
    });

    expect(variables.trialDays).toBe(14);
  });

  it("detects fresh local billing state", () => {
    expect(
      isBillingStateFresh({
        lastCheckedAt: new Date("2026-06-11T00:00:00Z"),
        now: new Date("2026-06-11T00:04:59Z"),
        cacheSeconds: 300,
      }),
    ).toBe(true);
  });

  it("builds return URL from SHOPIFY_APP_URL", () => {
    vi.stubEnv("SHOPIFY_APP_URL", "https://search.pagelumo.com");

    expect(buildBillingReturnUrl(new Request("https://ignored.example/app/billing"))).toBe(
      "https://search.pagelumo.com/app/billing/return",
    );

    vi.unstubAllEnvs();
  });

  it("has a public 402 error shape", () => {
    const error = new BillingAccessError();

    expect(error.toResponseBody()).toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- app/services/billing.server.test.ts
```

Expected: fails because `billing.server.ts` does not exist.

- [ ] **Step 3: Implement service core and GraphQL helpers**

Create `app/services/billing.server.ts`:

```ts
import type { PrismaClient, ShopBillingState } from "@prisma/client";
import { getBillingPlanConfig, type BillingPlanConfig } from "./billing-plan.server";

export const BILLING_REQUIRED_MESSAGE = "Lens Search is not active for this store.";

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
  plan = getBillingPlanConfig().planName;

  constructor(message = BILLING_REQUIRED_MESSAGE) {
    super(message);
    this.name = "BillingAccessError";
  }

  toResponseBody() {
    return {
      error: this.message,
      code: this.code,
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
  plan: Pick<BillingPlanConfig, "planName" | "isTest">,
): ShopifySubscription | null {
  return (
    subscriptions.find((subscription) => {
      return (
        subscription.name === plan.planName &&
        subscription.status === "ACTIVE" &&
        (plan.isTest || !subscription.test)
      );
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
    trialEndedAt: createdAt && input.subscription && input.subscription.trialDays > 0 ? addDays(createdAt, input.subscription.trialDays) : null,
    activeSubscriptionId: input.subscription?.id ?? null,
    subscriptionStatus: input.subscription ? "active" : "inactive",
    subscriptionTest: input.subscription?.test ?? null,
    subscriptionCreatedAt: createdAt,
    currentPeriodEnd: parseDate(input.subscription?.currentPeriodEnd),
    lastCheckedAt: input.now,
  };
}

export function isBillingStateFresh(input: {
  lastCheckedAt: Date | null;
  now: Date;
  cacheSeconds: number;
}): boolean {
  if (!input.lastCheckedAt) return false;
  return input.now.getTime() - input.lastCheckedAt.getTime() <= input.cacheSeconds * 1000;
}

export function buildBillingReturnUrl(request: Request): string {
  const baseUrl = process.env.SHOPIFY_APP_URL || new URL(request.url).origin;
  return new URL("/app/billing/return", baseUrl).toString();
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

async function fetchActiveSubscription(admin: AdminGraphqlClient, plan: BillingPlanConfig): Promise<ShopifySubscription | null> {
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
  const fresh = isBillingStateFresh({ lastCheckedAt: state?.lastCheckedAt ?? null, now, cacheSeconds: plan.entitlementCacheSeconds });
  return { entitled: Boolean(state && fresh && state.subscriptionStatus === "active"), state, fresh };
}

export async function requireBillingAccess(input: {
  prisma: Pick<PrismaClient, "shopBillingState">;
  shopDomain: string;
  admin?: AdminGraphqlClient;
  plan?: BillingPlanConfig;
}): Promise<ShopBillingState> {
  const plan = input.plan ?? getBillingPlanConfig();
  if (input.admin) {
    const refreshed = await refreshBillingStatus({ prisma: input.prisma, admin: input.admin, shopDomain: input.shopDomain, plan });
    if (!refreshed.entitled) throw new BillingAccessError();
    return refreshed.state;
  }

  const cached = await getCachedBillingEntitlement({ prisma: input.prisma, shopDomain: input.shopDomain, plan });
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
    returnUrl: buildBillingReturnUrl(input.request),
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
```

- [ ] **Step 4: Run service tests**

Run:

```bash
npm test -- app/services/billing.server.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit billing service**

```bash
git add app/services/billing.server.ts app/services/billing.server.test.ts
git commit -m "feat: add shopify billing service"
```

---

### Task 4: Build real Billing page and return route

**Files:**
- Modify: `app/routes/app.billing.tsx`
- Create: `app/routes/app.billing.return.tsx`
- Create/modify tests: `app/routes.app.billing.test.tsx`

- [ ] **Step 1: Write route tests**

Create `app/routes.app.billing.test.tsx` with mocked `authenticate.admin`, billing service, and assertions:

```ts
import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  getOrCreateBillingState: vi.fn(),
  refreshBillingStatus: vi.fn(),
  createSubscription: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./db.server", () => ({ default: { shopBillingState: {} } }));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    getOrCreateBillingState: mocks.getOrCreateBillingState,
    refreshBillingStatus: mocks.refreshBillingStatus,
    createSubscription: mocks.createSubscription,
  };
});

function args(request: Request) {
  return { request, params: {}, context: {} } as any;
}

describe("billing page route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({ session: { shop: "demo.myshopify.com" }, admin: {} });
    mocks.getOrCreateBillingState.mockResolvedValue({ shopDomain: "demo.myshopify.com", trialUsed: false, subscriptionStatus: "inactive" });
    mocks.refreshBillingStatus.mockResolvedValue({ entitled: false, state: { trialUsed: false, subscriptionStatus: "inactive" }, subscription: null });
  });

  it("loads billing page without active subscription", async () => {
    const { loader } = await import("./routes/app.billing");
    const result = await loader(args(new Request("https://search.pagelumo.com/app/billing")));

    expect(result.billing.entitled).toBe(false);
    expect(result.billing.trialUsed).toBe(false);
  });

  it("redirects to Shopify confirmation URL when starting subscription", async () => {
    const { action } = await import("./routes/app.billing");
    mocks.createSubscription.mockResolvedValue({ confirmationUrl: "https://shopify.test/confirm" });
    const body = new FormData();
    body.set("intent", "start_subscription");

    const response = await action(args(new Request("https://search.pagelumo.com/app/billing", { method: "POST", body })));

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://shopify.test/confirm");
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- app/routes.app.billing.test.tsx
```

Expected: fails because current billing route returns `null` from loader and has no action.

- [ ] **Step 3: Implement `/app/billing` loader/action/UI**

Replace `app/routes/app.billing.tsx` with a real billing page that:

```ts
import type { HeadersFunction, ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getBillingPlanConfig } from "../services/billing-plan.server";
import { createSubscription, refreshBillingStatus } from "../services/billing.server";

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
  const { session, admin } = await authenticate.admin(request);
  const formData = await request.formData();
  if (String(formData.get("intent")) !== "start_subscription") {
    return Response.json({ error: "Invalid billing action" }, { status: 400 });
  }
  const { confirmationUrl } = await createSubscription({ prisma, admin, shopDomain: session.shop, request });
  return redirect(confirmationUrl);
};

export default function BillingPage() {
  const { billing, plan, shopDomain } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";
  const price = `$${plan.monthlyPrice.toFixed(2)} ${plan.currencyCode}/month`;
  const trialCopy = billing.trialUsed ? "Free trial already used for this store." : `${plan.trialDays}-day free trial included.`;

  return (
    <s-page heading="Billing">
      <s-section heading="Starter plan">
        <s-stack direction="block" gap="small">
          <s-paragraph>Shop: {shopDomain}</s-paragraph>
          <s-paragraph>{price}. {trialCopy}</s-paragraph>
          <s-paragraph>Mode: {billing.isTest ? "Test billing" : "Live billing"}</s-paragraph>
          <s-paragraph>Subscription status: {billing.entitled ? "Active" : "Inactive"}</s-paragraph>
          {billing.currentPeriodEnd ? <s-paragraph>Current period ends: {new Date(billing.currentPeriodEnd).toLocaleString()}</s-paragraph> : null}
        </s-stack>
      </s-section>

      <s-section heading={billing.entitled ? "Subscription active" : "Start subscription"}>
        {billing.entitled ? (
          <s-paragraph>Your Lens Search subscription is active. You can use indexing and storefront search.</s-paragraph>
        ) : (
          <Form method="post">
            <input type="hidden" name="intent" value="start_subscription" />
            <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>Start subscription</s-button>
          </Form>
        )}
      </s-section>
    </s-page>
  );
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
```

- [ ] **Step 4: Implement billing return route**

Create `app/routes/app.billing.return.tsx`:

```ts
import type { LoaderFunctionArgs } from "react-router";
import { redirect } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { refreshBillingStatus } from "../services/billing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session, admin } = await authenticate.admin(request);
  const billingStatus = await refreshBillingStatus({ prisma, admin, shopDomain: session.shop });
  return redirect(billingStatus.entitled ? "/app" : "/app/billing");
};
```

- [ ] **Step 5: Run route tests**

Run:

```bash
npm test -- app/routes.app.billing.test.tsx
```

Expected: all tests pass.

- [ ] **Step 6: Commit billing routes**

```bash
git add app/routes/app.billing.tsx app/routes/app.billing.return.tsx app/routes.app.billing.test.tsx
git commit -m "feat: add billing subscription flow"
```

---

### Task 5: Enforce billing in Admin app routes

**Files:**
- Modify: `app/routes/app._index.tsx`
- Modify: `app/routes/app.settings.tsx`
- Modify: `app/routes/api.image-search.index-products.tsx`
- Add/update tests: `app/routes.app-index-copy.test.ts`, `app/routes.api.image-search.index-products.test.tsx`

- [ ] **Step 1: Add failing tests for admin gate**

In `app/routes.api.image-search.index-products.test.tsx`, add a mock for `requireBillingAccess` and a test:

```ts
it("returns 402 when billing is inactive", async () => {
  const { BillingAccessError } = await import("./services/billing.server");
  mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

  const response = await action(actionArgs(new Request("http://localhost/api/image-search/index-products", {
    method: "POST",
    body: JSON.stringify({ mode: "incremental" }),
  })));

  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "Lens Search is not active for this store.",
    code: "billing_required",
    plan: "Starter",
  });
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- app/routes.api.image-search.index-products.test.tsx
```

Expected: fails because route does not call `requireBillingAccess`.

- [ ] **Step 3: Gate Admin page loaders**

In `app/routes/app._index.tsx` loader, after `authenticate.admin(request)`, call:

```ts
import { redirect } from "react-router";
import { BillingAccessError, requireBillingAccess } from "../services/billing.server";

// inside loader
const { session, admin } = await authenticate.admin(request);
try {
  await requireBillingAccess({ prisma, admin, shopDomain: session.shop });
} catch (error) {
  if (error instanceof BillingAccessError) throw redirect("/app/billing");
  throw error;
}
```

Use the same pattern in `app/routes/app.settings.tsx`.

- [ ] **Step 4: Gate indexing action**

In `app/routes/api.image-search.index-products.tsx`, after `authenticate.admin(request)`, add:

```ts
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";

try {
  await requireBillingAccess({ prisma, admin, shopDomain: session.shop });
} catch (error) {
  const billingResponse = billingAccessErrorResponse(error);
  if (billingResponse) return billingResponse;
  throw error;
}
```

- [ ] **Step 5: Run targeted tests**

Run:

```bash
npm test -- app/routes.api.image-search.index-products.test.tsx app/routes.app-index-copy.test.ts
```

Expected: tests pass.

- [ ] **Step 6: Commit admin enforcement**

```bash
git add app/routes/app._index.tsx app/routes/app.settings.tsx app/routes/api.image-search.index-products.tsx app/routes.api.image-search.index-products.test.tsx app/routes.app-index-copy.test.ts
git commit -m "feat: enforce billing in admin routes"
```

---

### Task 6: Enforce billing in storefront JSON routes

**Files:**
- Modify: `app/routes/api.image-search.search.tsx`
- Modify: `app/routes/api.recommendations.similar-products.tsx`
- Modify: `app/routes/api.favorites.tsx`
- Modify: `app/routes/api.favorites.delete.tsx`
- Modify: `app/routes/api.upload-history.tsx`
- Update route tests

- [ ] **Step 1: Add 402 tests to storefront routes**

For each storefront JSON route test, mock `requireBillingAccess` to reject `new BillingAccessError()` after the shop/session/proxy validation passes. For `app/routes.api.image-search.search.test.tsx`, add:

```ts
it("returns 402 when shop is installed but billing is inactive", async () => {
  const { BillingAccessError } = await import("./services/billing.server");
  mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());
  const formData = new FormData();
  formData.set("shop", "demo-shop.myshopify.com");
  formData.set("anonymousId", "anon-1");
  formData.set("image", new File([Buffer.from("webp")], "query.webp", { type: "image/webp" }));

  const response = await action(actionArgs(new Request("http://localhost/api/image-search/search", {
    method: "POST",
    body: formData,
  })));

  expect(response.status).toBe(402);
  await expect(response.json()).resolves.toEqual({
    error: "Lens Search is not active for this store.",
    code: "billing_required",
    plan: "Starter",
  });
  expect(mocks.runImageSearch).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests and verify failure**

Run:

```bash
npm test -- app/routes.api.image-search.search.test.tsx app/routes.api.recommendations.similar-products.test.tsx app/routes.api.favorites.test.tsx app/routes.api.favorites.delete.test.tsx app/routes.api.upload-history.test.tsx
```

Expected: fails until route gates are added.

- [ ] **Step 3: Add route gates**

In each route, import:

```ts
import { billingAccessErrorResponse, requireBillingAccess } from "../services/billing.server";
```

After shop validation and installation/session check, add:

```ts
try {
  await requireBillingAccess({ prisma, shopDomain });
} catch (error) {
  const billingResponse = billingAccessErrorResponse(error);
  if (billingResponse) return withStorefrontCors ? withStorefrontCors(request, billingResponse) : billingResponse;
  throw error;
}
```

For routes that already use `withStorefrontCors`, wrap the billing response. For routes that do not use CORS, return the billing response directly.

- [ ] **Step 4: Ensure installation check exists before billing refresh**

Routes with no session check must add:

```ts
const installedSession = await prisma.session.findFirst({ where: { shop: shopDomain } });
if (!installedSession) return Response.json({ error: "Shop is not installed" }, { status: 403 });
```

Add this before `requireBillingAccess` so an unknown shop cannot trigger billing checks.

- [ ] **Step 5: Run targeted route tests**

Run:

```bash
npm test -- app/routes.api.image-search.search.test.tsx app/routes.api.recommendations.similar-products.test.tsx app/routes.api.favorites.test.tsx app/routes.api.favorites.delete.test.tsx app/routes.api.upload-history.test.tsx
```

Expected: all targeted tests pass.

- [ ] **Step 6: Commit storefront JSON enforcement**

```bash
git add app/routes/api.image-search.search.tsx app/routes/api.recommendations.similar-products.tsx app/routes/api.favorites.tsx app/routes/api.favorites.delete.tsx app/routes/api.upload-history.tsx app/routes.api.image-search.search.test.tsx app/routes.api.recommendations.similar-products.test.tsx app/routes.api.favorites.test.tsx app/routes.api.favorites.delete.test.tsx app/routes.api.upload-history.test.tsx
git commit -m "feat: enforce billing in storefront APIs"
```

---

### Task 7: Enforce billing in wishlist page with friendly HTML

**Files:**
- Modify: `app/routes/api.wishlist.tsx`
- Update: `app/routes.api.wishlist.test.tsx`

- [ ] **Step 1: Add wishlist billing test**

In `app/routes.api.wishlist.test.tsx`, add:

```ts
it("returns a friendly billing unavailable page when unsubscribed", async () => {
  const { BillingAccessError } = await import("./services/billing.server");
  mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

  const response = await loader(loaderArgs("http://localhost/api/wishlist?shop=demo-shop.myshopify.com"));
  const html = await response.text();

  expect(response.status).toBe(402);
  expect(response.headers.get("content-type")).toContain("text/html");
  expect(html).toContain("Lens Search is not active for this store.");
});
```

- [ ] **Step 2: Run test and verify failure**

Run:

```bash
npm test -- app/routes.api.wishlist.test.tsx
```

Expected: fails because wishlist does not check billing.

- [ ] **Step 3: Add unavailable HTML helper**

In `app/routes/api.wishlist.tsx`, add:

```ts
function billingUnavailableHtml(): string {
  return `<!doctype html>
<html lang="en">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Lens Search unavailable</title></head>
  <body style="font-family: system-ui, sans-serif; margin: 0; padding: 40px; color: #111827; background: #f8fafc;">
    <main style="max-width: 720px; margin: 0 auto; background: white; border: 1px solid #e5e7eb; border-radius: 16px; padding: 28px;">
      <h1>Lens Search is not active</h1>
      <p>Lens Search is not active for this store. Please contact the store owner.</p>
      <a href="/collections/all">Continue shopping</a>
    </main>
  </body>
</html>`;
}
```

- [ ] **Step 4: Gate wishlist loader**

After shop validation and installation check, add:

```ts
try {
  await requireBillingAccess({ prisma, shopDomain });
} catch (error) {
  if (error instanceof BillingAccessError) {
    return new Response(billingUnavailableHtml(), {
      status: 402,
      headers: { "Content-Type": "text/html; charset=utf-8" },
    });
  }
  throw error;
}
```

- [ ] **Step 5: Run wishlist tests**

Run:

```bash
npm test -- app/routes.api.wishlist.test.tsx
```

Expected: pass.

- [ ] **Step 6: Commit wishlist enforcement**

```bash
git add app/routes/api.wishlist.tsx app/routes.api.wishlist.test.tsx
git commit -m "feat: enforce billing on wishlist page"
```

---

### Task 8: Update storefront UI for 402 responses

**Files:**
- Modify: `extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js`

- [ ] **Step 1: Add manual browser regression checklist**

Before changing JS, record current behavior in a note in the PR description or work log:

```text
Current behavior: API 402 responses are parsed as JSON, then generic route catch displays either the raw message or fallback text depending on the caller.
Target behavior: image search, similar products, favorites, wishlist modal all display a friendly merchant-subscription-unavailable message.
```

- [ ] **Step 2: Add response error helper**

In `lens-cart-ai-storefront.js`, replace repeated `if (!response.ok) throw new Error(body.error || ...)` patterns with this helper:

```js
function errorMessageFromResponse(response, body, fallback) {
  if (response.status === 402) return body.error || "Lens Search is not active for this store.";
  return body.error || fallback;
}
```

Then change call sites, for example search:

```js
if (!response.ok) throw new Error(errorMessageFromResponse(response, body, "Something went wrong. Please try again."));
```

For similar products:

```js
if (!response.ok) throw new Error(errorMessageFromResponse(response, body, "Similar products unavailable."));
```

For favorites/wishlist:

```js
if (!response.ok) throw new Error(errorMessageFromResponse(response, body, "Wishlist unavailable."));
```

- [ ] **Step 3: Preserve local favorite fallback only for network errors**

In `loadWishlistProducts`, do not silently fall back to local cache for a valid `402` response. Throw the 402 message so the UI can display it.

Use this structure:

```js
const response = await fetch(`${apiBaseUrl}/favorites?${params}`);
const body = await readJsonResponse(response);
if (!response.ok) throw new Error(errorMessageFromResponse(response, body, "Wishlist unavailable."));
```

The outer catch may still use cached products for network failures, but a 402 should set status to the subscription message.

- [ ] **Step 4: Manual test in Theme Editor**

With a test shop that has no subscription, upload an image. Expected status text:

```text
Lens Search is not active for this store.
```

No raw JSON should be visible.

- [ ] **Step 5: Commit storefront UI update**

```bash
git add extensions/lens-cart-ai-theme/assets/lens-cart-ai-storefront.js
git commit -m "feat: show billing unavailable storefront message"
```

---

### Task 9: Preserve billing state on uninstall

**Files:**
- Modify: `app/routes/webhooks.app.uninstalled.tsx`
- Add/update test: `app/routes.webhooks.app.uninstalled.test.tsx`

- [ ] **Step 1: Add uninstall test**

Create or update `app/routes.webhooks.app.uninstalled.test.tsx` to assert only sessions are deleted:

```ts
import { describe, expect, it, vi } from "vitest";
import { action } from "./routes/webhooks.app.uninstalled";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  deleteMany: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
}));

vi.mock("./db.server", () => ({
  default: { session: { deleteMany: mocks.deleteMany } },
}));

describe("app/uninstalled webhook", () => {
  it("deletes sessions without deleting billing state", async () => {
    mocks.authenticateWebhook.mockResolvedValue({ shop: "demo.myshopify.com", session: { id: "offline_demo" }, topic: "APP_UNINSTALLED" });

    const response = await action({ request: new Request("http://localhost/webhooks/app/uninstalled", { method: "POST" }), params: {}, context: {} } as any);

    expect(response.status).toBe(200);
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
  });
});
```

- [ ] **Step 2: Run webhook test**

Run:

```bash
npm test -- app/routes.webhooks.app.uninstalled.test.tsx
```

Expected: pass with current behavior if billing state is not touched.

- [ ] **Step 3: Add clarifying comment**

In `app/routes/webhooks.app.uninstalled.tsx`, add above session deletion:

```ts
// Keep ShopBillingState on uninstall so reinstalling the app does not grant another free trial.
```

- [ ] **Step 4: Commit webhook clarification**

```bash
git add app/routes/webhooks.app.uninstalled.tsx app/routes.webhooks.app.uninstalled.test.tsx
git commit -m "test: preserve billing state on uninstall"
```

---

### Task 10: Run full verification and manual Shopify test billing

**Files:**
- No code changes unless verification fails.

- [ ] **Step 1: Run typecheck**

Run:

```bash
npm run typecheck
```

Expected: exit 0.

- [ ] **Step 2: Run all tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Apply local migration**

Run only against the intended local/test database:

```bash
npm exec prisma migrate deploy
```

Expected: `shop_billing_states` exists.

- [ ] **Step 4: Configure local test billing**

Set local `.env`:

```env
SHOPIFY_BILLING_TEST=true
BILLING_PLAN_NAME=Starter
BILLING_MONTHLY_PRICE=7.99
BILLING_CURRENCY_CODE=USD
BILLING_TRIAL_DAYS=14
BILLING_ENTITLEMENT_CACHE_SECONDS=300
```

- [ ] **Step 5: Start app and worker**

Run:

```bash
npm run dev -- --config lens-search
npm run worker:product-index
```

Expected: app opens in test shop.

- [ ] **Step 6: Manual billing flow**

Use the test shop:

```text
1. Open /app.
2. Confirm it redirects or links to /app/billing when not subscribed.
3. Click Start subscription.
4. Confirm Shopify test subscription with 14-day trial.
5. Return to /app/billing/return.
6. Confirm /app loads.
7. Run Index product images.
8. In Theme Editor, upload an image and confirm search works.
9. Cancel the test subscription in Shopify admin/Partner tools.
10. Refresh /app and storefront after cache window; confirm usage is blocked.
11. Uninstall/reinstall the app; confirm billing page does not offer another trial.
```

- [ ] **Step 7: Commit final fixes if any**

If manual testing required small fixes:

```bash
git add <changed-files>
git commit -m "fix: complete billing subscription verification"
```

---

## Self-Review

**Spec coverage:** This plan covers the design doc requirements: real Billing API creation, active subscription checks, trial-once logic, local persistent state, admin route enforcement, storefront route enforcement, wishlist HTML behavior, uninstall state preservation, env vars, tests, and manual Shopify test billing.

**Placeholder scan:** The plan does not contain implementation placeholders such as TBD/TODO. It uses fixed launch values: `Starter`, `USD`, `7.99`, `14`, and `300`.

**Type consistency:** Names are consistent across tasks: `ShopBillingState`, `shopBillingState`, `BillingAccessError`, `requireBillingAccess`, `billingAccessErrorResponse`, `refreshBillingStatus`, `createSubscription`, `BILLING_MONTHLY_PRICE`, and `SHOPIFY_BILLING_TEST`.

**Risk note:** The exact GraphQL enum value `EVERY_30_DAYS` should be validated against the installed Shopify API package during implementation. If Shopify returns a GraphQL user error for the interval variable, replace it with the enum spelling required by the current Admin GraphQL version before continuing manual billing tests.
