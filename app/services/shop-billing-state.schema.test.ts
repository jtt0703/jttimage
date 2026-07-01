import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const schemaPath = join(process.cwd(), "prisma/schema.prisma");
const migrationPath = join(process.cwd(), "prisma/migrations/20260611000000_shop_billing_state/migration.sql");

describe("ShopBillingState Prisma schema", () => {
  it("defines persistent billing state for one subscription record per shop", () => {
    const schema = readFileSync(schemaPath, "utf8");

    expect(schema).toContain("model ShopBillingState {");
    expect(schema).toContain('shopDomain            String    @unique @map("shop_domain")');
    expect(schema).toContain('trialUsed             Boolean   @default(false) @map("trial_used")');
    expect(schema).toContain('activeSubscriptionId  String?   @map("active_subscription_id")');
    expect(schema).toContain('subscriptionStatus    String    @default("inactive") @map("subscription_status")');
    expect(schema).toContain('lastCheckedAt         DateTime? @map("last_checked_at")');
    expect(schema).toContain("@@index([subscriptionStatus])");
    expect(schema).toContain("@@index([lastCheckedAt])");
    expect(schema).toContain('@@map("shop_billing_states")');
  });

  it("creates the billing state table and required indexes", () => {
    expect(existsSync(migrationPath)).toBe(true);

    const migration = readFileSync(migrationPath, "utf8");

    expect(migration).toContain('CREATE TABLE "shop_billing_states"');
    expect(migration).toContain('"shop_domain" TEXT NOT NULL');
    expect(migration).toContain('"trial_used" BOOLEAN NOT NULL DEFAULT false');
    expect(migration).toContain('"subscription_status" TEXT NOT NULL DEFAULT \'inactive\'');
    expect(migration).toContain('CREATE UNIQUE INDEX "shop_billing_states_shop_domain_key" ON "shop_billing_states"("shop_domain")');
    expect(migration).toContain('CREATE INDEX "shop_billing_states_subscription_status_idx" ON "shop_billing_states"("subscription_status")');
    expect(migration).toContain('CREATE INDEX "shop_billing_states_last_checked_at_idx" ON "shop_billing_states"("last_checked_at")');
  });
});
