# Billing Subscription Webhook Sync Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep local billing entitlement current when Shopify app subscriptions are updated, so storefront API access is revoked after cancellation instead of relying indefinitely on a stale active DB row.

**Architecture:** Add a Shopify `app_subscriptions/update` webhook route that verifies the webhook, opens an offline Admin client for the webhook shop, and reuses `refreshBillingStatus()` as the single source of truth for local `ShopBillingState`. Register the topic in both Shopify TOML configs.

**Tech Stack:** React Router route actions, Shopify app React Router `authenticate.webhook` and `unauthenticated.admin`, Prisma-backed billing service, Vitest.

## Global Constraints

- Do not change storefront API gating behavior in this task; keep the no-Admin storefront fast path.
- Do not add a scheduler in this task.
- Follow existing webhook route and test patterns.
- Use TDD: write failing tests before implementation.

---

### Task 1: Add App Subscription Update Webhook Route

**Files:**
- Create: `app/routes/webhooks.app.subscriptions_update.tsx`
- Create: `app/routes.webhooks.app.subscriptions_update.test.tsx`

**Interfaces:**
- Consumes: `authenticate.webhook(request)`, `unauthenticated.admin(shop)`, `refreshBillingStatus({ prisma, admin, shopDomain })`
- Produces: `action({ request })` route action returning `200` after billing state refresh

- [ ] **Step 1: Write the failing route test**

Create `app/routes.webhooks.app.subscriptions_update.test.tsx` with tests that mock `authenticate.webhook`, `unauthenticated.admin`, `db.server`, and `refreshBillingStatus`.

- [ ] **Step 2: Run the route test to verify it fails**

Run: `npm test -- app/routes.webhooks.app.subscriptions_update.test.tsx`
Expected: fails because `./routes/webhooks.app.subscriptions_update` does not exist.

- [ ] **Step 3: Implement the route**

Create `app/routes/webhooks.app.subscriptions_update.tsx`. The action authenticates the webhook, logs receipt, gets an Admin client with `unauthenticated.admin(shop)`, calls `refreshBillingStatus({ prisma, admin, shopDomain: shop })`, logs the refreshed state, and returns `new Response()`.

- [ ] **Step 4: Run the route test to verify it passes**

Run: `npm test -- app/routes.webhooks.app.subscriptions_update.test.tsx`
Expected: pass.

### Task 2: Register App Subscription Update Webhook Topic

**Files:**
- Modify: `shopify.app.lens-search.toml`
- Modify: `shopify.app.toml`
- Test: `app/routes.webhooks.app.subscriptions_update.test.tsx`

**Interfaces:**
- Produces: TOML entries with `topics = [ "app_subscriptions/update" ]` and `uri = "/webhooks/app/subscriptions_update"`

- [ ] **Step 1: Write the failing config contract test**

Add tests that read both Shopify TOML files and assert they contain the topic and route URI.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/routes.webhooks.app.subscriptions_update.test.tsx`
Expected: fails because the TOML files do not yet include `app_subscriptions/update`.

- [ ] **Step 3: Add TOML webhook registrations**

Add a `[[webhooks.subscriptions]]` block to both TOML files:

```toml
  [[webhooks.subscriptions]]
  topics = [ "app_subscriptions/update" ]
  uri = "/webhooks/app/subscriptions_update"
```

- [ ] **Step 4: Run the config and route tests**

Run: `npm test -- app/routes.webhooks.app.subscriptions_update.test.tsx`
Expected: pass.

### Task 3: Full Verification

**Files:**
- No new files beyond Tasks 1 and 2.

- [ ] **Step 1: Run focused billing/webhook tests**

Run: `npm test -- app/routes.webhooks.app.subscriptions_update.test.tsx app/services/billing.server.test.ts`
Expected: pass.

- [ ] **Step 2: Run full verification**

Run:

```bash
npm test
npm run typecheck
npm run lint
npm run build
```

Expected: all commands exit 0.
