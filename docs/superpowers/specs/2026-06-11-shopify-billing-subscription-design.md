# Shopify Billing Subscription Design

## Goal

Implement real Shopify Billing API subscription enforcement before App Store submission so Lens Search can only be used by shops with an active subscription.

The commercial offer is fixed:

- Plan name: `Starter`
- Price: `USD 7.99/month`
- Trial: 14 days
- Trial rule: one 14-day free trial per `myshopify.com` shop domain for the lifetime of this app
- Reinstall rule: uninstalling and reinstalling must not grant a second trial

## Current State

The app currently has no active Shopify billing enforcement.

- `app/routes/app.billing.tsx` shows planned billing copy only.
- `app/shopify.server.ts` has no billing configuration or subscription enforcement.
- `SHOPIFY_BILLING_TEST` exists in local environment files, but no current code reads it.
- Storefront app proxy routes currently check installation/session and Shopify proxy signature, but not paid entitlement.

Because of this, setting `SHOPIFY_BILLING_TEST=false` alone cannot make the app production-billable.

## Billing Approach

Use Manual Shopify Billing API integration through Admin GraphQL.

The app will create subscriptions with `appSubscriptionCreate` using:

- `name: "Starter"`
- `returnUrl: "${SHOPIFY_APP_URL}/app/billing/return"`
- one recurring line item with `price.amount = 7.99`, `currencyCode = USD`, and monthly interval
- `test` from `SHOPIFY_BILLING_TEST`
- `trialDays: 14` only if the local billing state says the shop has never used a trial

The app will read current Shopify subscription state with `currentAppInstallation.activeSubscriptions`.

## Data Model

Add a persistent local model named `ShopBillingState`.

Fields:

- `id`
- `shopDomain`
- `planName`
- `trialUsed`
- `trialStartedAt`
- `trialEndedAt`
- `activeSubscriptionId`
- `subscriptionStatus`
- `subscriptionTest`
- `lastCheckedAt`
- `createdAt`
- `updatedAt`

Indexes:

- unique `shopDomain`
- index on `subscriptionStatus`
- index on `lastCheckedAt`

Important behavior:

- `trialUsed` starts as `false`.
- `trialUsed` changes to `true` only after Shopify confirms an active subscription that was created with trial days.
- `ShopBillingState` must not be deleted on app uninstall.
- If the merchant cancels, uninstalls, reinstalls, or subscribes again later, `trialUsed=true` means no second trial.

## Entitlement Rules

A shop is entitled when Shopify currently reports an active app subscription for the configured plan.

Local DB state is a cache, not the source of truth. Shopify is the source of truth for active subscription state, while local DB is the source of truth for whether the shop already used its one trial.

Refresh policy:

- Admin routes refresh subscription state from Shopify before deciding access.
- Storefront routes use local entitlement first.
- If local entitlement is missing or stale, storefront routes may refresh through the shop offline session using `unauthenticated.admin(shopDomain)`.
- A five-minute freshness window is acceptable for storefront route performance.

If Shopify cannot be reached while checking an admin request, fail closed and show a billing unavailable message.

If Shopify cannot be reached while checking a storefront request, fail closed and return a public unavailable response.

## Admin Flow

`/app/billing` is the public billing screen inside the authenticated embedded app. It does not require an active subscription.

`/app/billing` shows:

- Starter plan
- USD 7.99/month
- 14-day free trial if `trialUsed=false`
- no free-trial copy if `trialUsed=true`
- a primary action to subscribe or start trial

Subscription action:

1. Authenticate admin request.
2. Load or create local `ShopBillingState`.
3. Refresh current Shopify subscriptions.
4. If already entitled, redirect to `/app`.
5. If not entitled, call `appSubscriptionCreate`.
6. Pass `trialDays: 14` only when `trialUsed=false`.
7. Redirect merchant to Shopify `confirmationUrl`.

Return flow:

1. Shopify redirects to `/app/billing/return`.
2. Authenticate admin request.
3. Refresh current Shopify subscriptions.
4. If active, update local state and redirect to `/app`.
5. If not active, redirect to `/app/billing` with a clear message.

## Route Enforcement

Do not enforce billing in the top-level `app/routes/app.tsx` layout because `/app/billing` must remain reachable.

Enforce billing in:

- `app/routes/app._index.tsx`
- `app/routes/app.settings.tsx`
- `app/routes/api.image-search.index-products.tsx`

Optional later:

- Add enforcement to any future merchant-facing settings or analytics routes.

## Storefront Enforcement

Storefront app proxy routes should require a paid entitlement because the user requirement is that merchants must subscribe before the app can be used.

Enforce entitlement in:

- `app/routes/api.image-search.search.tsx`
- `app/routes/api.recommendations.similar-products.tsx`
- `app/routes/api.favorites.tsx`
- `app/routes/api.favorites.delete.tsx`
- `app/routes/api.upload-history.tsx`
- `app/routes/api.wishlist.tsx`

Do not enforce entitlement in:

- webhook routes
- auth routes
- static uploaded thumbnail proxy route, unless access leakage becomes a separate privacy requirement

Storefront response behavior:

- If shop is not installed: keep current `403`.
- If shop is installed but not subscribed: return `402` with `{ "error": "Lens Search is not active for this store." }`.
- The theme extension should show a friendly unavailable status instead of raw JSON or parse errors.

## Webhook Behavior

Current app webhooks can continue to run without billing checks.

`app/uninstalled` must remove Shopify sessions but must not remove `ShopBillingState`.

If Shopify subscription update webhooks are later added and confirmed available for the app, they can update local billing state faster. They are not required for the first implementation because admin and storefront routes can refresh from Shopify using the offline session.

## Environment Variables

Add these variables to `.env.example` and production environment:

```env
SHOPIFY_BILLING_TEST=true
BILLING_PLAN_NAME=Starter
BILLING_MONTHLY_PRICE=7.99
BILLING_CURRENCY_CODE=USD
BILLING_TRIAL_DAYS=14
BILLING_ENTITLEMENT_CACHE_SECONDS=300
```

Production:

```env
SHOPIFY_BILLING_TEST=false
```

Development and staging test stores:

```env
SHOPIFY_BILLING_TEST=true
```

## Testing Strategy

Unit tests:

- Trial eligibility returns 14 days only before `trialUsed=true`.
- Trial eligibility returns no trial after `trialUsed=true`.
- Active Shopify subscription creates an entitled result.
- Missing subscription creates a not-entitled result.
- Billing state is not deleted on uninstall.

Route tests:

- `/app/billing` remains reachable without active subscription.
- `/app` redirects to `/app/billing` when not subscribed.
- `/api/image-search/index-products` returns a blocked response when not subscribed.
- Storefront search returns `402` when installed but not subscribed.
- Storefront search proceeds when subscribed.

Manual Shopify test:

1. Set `SHOPIFY_BILLING_TEST=true`.
2. Install app on a test shop.
3. Visit `/app`.
4. Confirm redirect to billing screen.
5. Start the 14-day trial.
6. Confirm Shopify subscription.
7. Verify `/app` loads.
8. Trigger product indexing.
9. Verify storefront image search works.
10. Cancel subscription.
11. Verify app blocks usage after entitlement refresh.
12. Reinstall app.
13. Verify billing screen no longer offers another 14-day trial.

## Deployment Notes

Billing should be completed locally and tested with Shopify test billing before deploying to the company server for App Store review preparation.

Before production deployment:

- `SHOPIFY_APP_URL` must be `https://search.pagelumo.com`.
- `shopify.app.lens-search.toml` must use the new Lens Search client ID.
- `SHOPIFY_BILLING_TEST=false` must be set only after test billing is verified.
- The test shop should uninstall any old app instance and install the new Lens Search app.

## Out of Scope

The first billing implementation will not support:

- multiple plans
- annual billing
- usage charges
- coupons
- manual merchant comping
- customer-facing subscription UI on storefront

These can be added later if the product needs them.
