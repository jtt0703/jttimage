import { describe, expect, it } from "vitest";
import { loader } from "./routes/api.wishlist";

function loaderArgs(requestUrl: string) {
  const url = new URL(requestUrl);
  return {
    request: new Request(url),
    url,
    pattern: "/api/wishlist",
    params: {},
    context: {},
  };
}

describe("wishlist app proxy route", () => {
  it("serves a storefront wishlist page that can fetch favorite product details", async () => {
    const response = await loader(loaderArgs("http://localhost/api/wishlist?shop=demo-shop.myshopify.com"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    const html = await response.text();
    expect(html).toContain("LensCart Wishlist");
    expect(html).toContain('data-shop-domain="demo-shop.myshopify.com"');
    expect(html).toContain('data-api-base-url="/apps/lens-cart-ai"');
    expect(html).toContain("lensCartAi.v1.anonymousId");
    expect(html).toContain("lensCartAi.v1.favoriteProductCards.");
    expect(html).toContain('apiBaseUrl + "/favorites?" + params');
    expect(html).toContain("body.products");
    expect(html).toContain("favoriteProductsFromCache()");
    expect(html).toContain("body.favorites && body.favorites.length ? body.favorites : products.map");
    expect(html).toContain('status.textContent = products.length ? "" : "No saved products yet."');
    expect(html).toContain('link.href = productUrl(product)');
  });
});
