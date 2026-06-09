import { beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.recommendations.similar-products";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  getSimilarProducts: vi.fn(),
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
});
