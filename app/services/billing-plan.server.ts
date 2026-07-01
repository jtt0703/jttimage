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
