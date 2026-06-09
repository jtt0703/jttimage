import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = join(process.cwd(), "extensions/lens-cart-ai-theme");

function readProjectFile(relativePath: string): string {
  return readFileSync(join(process.cwd(), relativePath), "utf8");
}

function readExtensionFile(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf8");
}

describe("LensCart AI theme extension contract", () => {
  it("declares a Shopify theme extension", () => {
    const toml = readExtensionFile("shopify.extension.toml");

    expect(toml).toContain('name = "LensCart AI Storefront"');
    expect(toml).toContain('type = "theme"');
  });

  it("configures the Shopify app proxy for storefront API calls", () => {
    const toml = readProjectFile("shopify.app.toml");

    expect(toml).toContain("write_app_proxy");
    expect(toml).toContain("[app_proxy]");
    expect(toml).toContain('url = "/api"');
    expect(toml).toContain('prefix = "apps"');
    expect(toml).toContain('subpath = "lens-cart-ai"');
  });

  it("defines the image search app embed hooks and settings", () => {
    const liquid = readExtensionFile("blocks/image-search-app-embed.liquid");

    expect(liquid).toContain('"target": "body"');
    expect(liquid).toContain('data-shop-domain="{{ shop.permanent_domain | escape }}"');
    expect(liquid).toContain('data-api-base-url="{{ block.settings.api_base_url | escape }}"');
    expect(liquid).toContain('data-button-position="{{ block.settings.button_position | escape }}"');
    expect(liquid).toContain("lenscart-ai-position-{{ block.settings.button_position | escape }}");
    expect(liquid).toContain("data-lenscart-open");
    expect(liquid).toContain("lenscart-ai-fab-icon");
    expect(liquid).toContain('viewBox="1.5 3 21 18"');
    expect(liquid).toContain("data-lenscart-file");
    expect(liquid).toContain("data-lenscart-available-only");
    expect(liquid).toContain('"id": "button_position"');
    expect(liquid).toContain('"value": "bottom-right"');
    expect(liquid).toContain('"value": "bottom-left"');
    expect(liquid).toContain('"value": "middle-right"');
    expect(liquid).toContain('"value": "middle-left"');
    expect(liquid).toContain('"default": "/apps/lens-cart-ai"');
  });

  it("defines the PDP similar products block hooks and settings", () => {
    const liquid = readExtensionFile("blocks/similar-products.liquid");

    expect(liquid).toContain('"target": "section"');
    expect(liquid).toContain("data-lenscart-similar");
    expect(liquid).toContain('data-product-gid="gid://shopify/Product/{{ product.id }}"');
    expect(liquid).toContain("data-lenscart-similar-results");
    expect(liquid).toContain('"default": "Similar Products"');
  });

  it("includes a default locale file for Shopify theme check", () => {
    const locale = readExtensionFile("locales/en.default.json");

    expect(JSON.parse(locale)).toEqual({});
  });

  it("stores anonymous state locally and calls storefront APIs", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("lensCartAi.v1.anonymousId");
    expect(js).toContain("lensCartAi.v1.recentUploads.");
    expect(js).toContain("lensCartAi.v1.favoriteProducts.");
    expect(js).toContain("${apiBaseUrl}/image-search/search");
    expect(js).toContain("${apiBaseUrl}/recommendations/similar-products");
    expect(js).toContain('const path = isFavorited ? "/favorites/delete" : "/favorites";');
    expect(js).toContain("${apiBaseUrl}${path}");
    expect(js).not.toContain("${apiBaseUrl}/api/");
  });

  it("loads local upload thumbnails through the storefront app proxy", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("function storefrontAssetUrl(url, apiBaseUrl)");
    expect(js).toContain('url.startsWith("/storage/uploads/")');
    expect(js).toContain("`${apiBaseUrl}${url}`");
    expect(js).toContain("storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl)");
  });

  it("does not surface raw JSON parse errors for empty proxy responses", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("async function readJsonResponse(response)");
    expect(js).toContain("await response.text()");
    expect(js).toContain("Something went wrong. Please try again.");
    expect(js).not.toContain("await response.json()");
  });

  it("uses Shopify Ajax Cart and avoids product navigation inside the theme editor preview", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("/cart/add.js");
    expect(js).toContain("id: product.variantId");
    expect(js).toContain("quantity: 1");
    expect(js).toContain('cartLink.href = "/cart"');
    expect(js).toContain('cartLink.textContent = "View cart"');
    expect(js).toContain("event.stopPropagation()");
    expect(js).toContain("function isThemeEditorPreview()");
    expect(js).toContain("window.Shopify && window.Shopify.designMode");
    expect(js).toContain("function openProduct(product, status)");
    expect(js).toContain("Product detail links are disabled inside the theme editor preview.");
    expect(js).toContain("window.location.assign(`/products/${product.handle}`)");
    expect(js).not.toContain('window.location.href = `/products/${product.handle}`');
  });

  it("lets shoppers rerun searches from recent uploads", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("async function searchRecentUpload(item)");
    expect(js).toContain("await fetch(storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl))");
    expect(js).toContain('new File([blob], "recent-upload.webp"');
    expect(js).toContain("button.addEventListener(\"click\", () => searchRecentUpload(item))");
  });

  it("wires Find Similar buttons to the similar-products API", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("async function findSimilarProducts(product)");
    expect(js).toContain("productGid: product.productGid");
    expect(js).toContain("${apiBaseUrl}/recommendations/similar-products?${params}");
    expect(js).toContain('form.append("limit", "9")');
    expect(js).toContain('limit: "9"');
    expect(js).toContain("findSimilarProducts(product)");
    expect(js).not.toContain('similar.addEventListener("click", (event) => event.stopPropagation())');
  });

  it("gives storefront feedback for favorite actions", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain('favorite.setAttribute("aria-pressed"');
    expect(js).toContain('favorite.setAttribute("aria-label"');
    expect(js).toContain("lenscart-ai-favorite-icon");
    expect(js).toContain('viewBox="0 0 24 24"');
    expect(js).toContain("lenscart-ai-favorite-heart");
    expect(js).toContain('"Saved to favorites. Favorites are marked with a filled heart in Image Search."');
    expect(js).toContain('"Removed from favorites."');
  });

  it("ships CSS for the modal, cards, favorite button, and PDP block", () => {
    const css = readExtensionFile("assets/lens-cart-ai.css");

    expect(css).toContain(".lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-fab-icon");
    expect(css).toContain("width: 42px");
    expect(css).toContain("height: 42px");
    expect(css).toContain(".lenscart-ai-position-bottom-right .lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-position-bottom-left .lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-position-middle-right .lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-position-middle-left .lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-modal");
    expect(css).toContain(".lenscart-ai-empty-art");
    expect(css).toContain("@keyframes lenscart-ai-scan");
    expect(css).toContain(".lenscart-ai-card");
    expect(css).toContain(".lenscart-ai-card:hover");
    expect(css).toContain("translate3d(0, -3px, 0)");
    expect(css).toContain("will-change: transform");
    expect(css).toContain("place-items: center");
    expect(css).toContain(".lenscart-ai-favorite-icon");
    expect(css).toContain("width: 26px");
    expect(css).toContain("height: 26px");
    expect(css).toContain(".lenscart-ai-favorite-heart");
    expect(css).toContain('aria-pressed="true"');
    expect(css).toContain(".lenscart-ai-favorite");
    expect(css).toContain(".lenscart-ai-card .lenscart-ai-favorite");
    expect(css).toContain(".lenscart-ai-card .lenscart-ai-favorite:hover");
    expect(css).toContain('.lenscart-ai-card .lenscart-ai-favorite[aria-pressed="true"]:hover .lenscart-ai-favorite-heart');
    expect(css).toContain(".lenscart-ai-similar");
  });
});
