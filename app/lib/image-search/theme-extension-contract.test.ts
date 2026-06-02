import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const extensionRoot = join(process.cwd(), "extensions/lens-cart-ai-theme");

function readExtensionFile(relativePath: string): string {
  return readFileSync(join(extensionRoot, relativePath), "utf8");
}

describe("LensCart AI theme extension contract", () => {
  it("declares a Shopify theme extension", () => {
    const toml = readExtensionFile("shopify.extension.toml");

    expect(toml).toContain('name = "LensCart AI Storefront"');
    expect(toml).toContain('type = "theme"');
  });

  it("defines the image search app embed hooks and settings", () => {
    const liquid = readExtensionFile("blocks/image-search-app-embed.liquid");

    expect(liquid).toContain('"target": "body"');
    expect(liquid).toContain('data-shop-domain="{{ shop.permanent_domain | escape }}"');
    expect(liquid).toContain('data-api-base-url="{{ block.settings.api_base_url | escape }}"');
    expect(liquid).toContain("data-lenscart-open");
    expect(liquid).toContain("data-lenscart-file");
    expect(liquid).toContain("data-lenscart-available-only");
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
    expect(js).toContain("/api/image-search/search");
    expect(js).toContain("/api/recommendations/similar-products");
    expect(js).toContain("/api/favorites/delete");
    expect(js).toContain("/api/favorites");
  });

  it("uses Shopify Ajax Cart with the numeric variant id and prevents button navigation", () => {
    const js = readExtensionFile("assets/lens-cart-ai-storefront.js");

    expect(js).toContain("/cart/add.js");
    expect(js).toContain("id: product.variantId");
    expect(js).toContain("quantity: 1");
    expect(js).toContain("event.stopPropagation()");
    expect(js).toContain('window.location.href = `/products/${product.handle}`');
  });

  it("ships CSS for the modal, cards, favorite button, and PDP block", () => {
    const css = readExtensionFile("assets/lens-cart-ai.css");

    expect(css).toContain(".lenscart-ai-fab");
    expect(css).toContain(".lenscart-ai-modal");
    expect(css).toContain(".lenscart-ai-card");
    expect(css).toContain(".lenscart-ai-favorite");
    expect(css).toContain(".lenscart-ai-similar");
  });
});
