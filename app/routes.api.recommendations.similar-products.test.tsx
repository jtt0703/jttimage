import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.recommendations.similar-products";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  getSimilarProducts: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {
    session: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("./services/recommendations.server", () => ({
  getSimilarProducts: mocks.getSimilarProducts,
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
    pattern: "/api/recommendations/similar-products",
    params: {},
    context: {},
  };
}

describe("similar products route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.getSimilarProducts.mockResolvedValue({ products: [] });
    mocks.requireBillingAccess.mockResolvedValue({});
  });

  it("returns a 503 json response when the recommendations dependency fails", async () => {
    mocks.getSimilarProducts.mockRejectedValue(new Error("Milvus unavailable"));

    const response = await loader(
      loaderArgs(
        "http://localhost/api/recommendations/similar-products?shop=demo-shop.myshopify.com&productGid=gid://shopify/Product/1",
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Similar products are temporarily unavailable. Please try again later.",
    });
  });

  it("returns 402 when shop is installed but billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await loader(
      loaderArgs(
        "http://localhost/api/recommendations/similar-products?shop=demo-shop.myshopify.com&productGid=gid://shopify/Product/1",
      ),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search billing is not active for this store.",
      code: "billing_required",
      reason: "billing_inactive",
      plan: "Starter",
    });
    expect(mocks.getSimilarProducts).not.toHaveBeenCalled();
  });
});
