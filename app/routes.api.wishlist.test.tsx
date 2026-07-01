import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.wishlist";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {
    session: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

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
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.requireBillingAccess.mockResolvedValue({});
  });

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

  it("returns a friendly billing unavailable page when unsubscribed", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await loader(loaderArgs("http://localhost/api/wishlist?shop=demo-shop.myshopify.com"));
    const html = await response.text();

    expect(response.status).toBe(402);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(html).toContain("Lens Search billing is not active for this store.");
    expect(html).toContain("The storefront embed may still be loaded; billing/API access is blocked.");
  });
});
