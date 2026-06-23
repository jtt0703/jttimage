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
