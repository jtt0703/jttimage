# LensCart AI UI Polish Design

## Goal

Prepare the Shopify Admin and storefront image-search UI for launch screenshots and merchant review while keeping the work local and independent from production deployment or Shopify App Pricing integration.

## Admin UI

Remove the template `Additional page` route and navigation item. Keep `Home` as the operational overview for indexing status and actions, and add two lightweight routes:

- `Settings`: explains the storefront app embed setup and the merchant-facing widget controls.
- `Billing`: previews the planned Starter plan copy for `$7/month` with a 7-day trial, without calling Shopify billing yet.

The privacy policy remains an external launch requirement, not a primary in-app navigation page. The app can link to support/privacy resources later when those URLs exist.

## Storefront UI

Expose a merchant setting named `Button position` on the image-search app embed with exactly four options:

- Bottom right
- Bottom left
- Middle right
- Middle left

The Liquid block writes the chosen setting as a data attribute on the app root. CSS controls the floating button and modal anchor for each position. The image-search modal receives a more polished empty state, subtle searching animation, and product-card hover treatment. Hover should lift the active product card briefly, strengthen depth, and slightly scale the product image without dimming unrelated products.

## Testing

Update contract tests so launch-facing behavior is guarded:

- Admin navigation no longer references `Additional page` and includes `Settings` and `Billing`.
- Theme app embed contains the four button-position settings and data attribute.
- Storefront CSS includes position classes, empty/searching visual states, and hover depth behavior.
- Existing 9-result image-search and Find Similar limits remain unchanged.
