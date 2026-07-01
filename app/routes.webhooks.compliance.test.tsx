import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateWebhook: vi.fn(),
  deleteFavoriteProducts: vi.fn(),
  deleteImageSearchUploads: vi.fn(),
  deleteProductIndexJobs: vi.fn(),
  deleteShopProducts: vi.fn(),
  deleteSessions: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { webhook: mocks.authenticateWebhook },
}));

vi.mock("./db.server", () => ({
  default: {
    favoriteProduct: { deleteMany: mocks.deleteFavoriteProducts },
    imageSearchUpload: { deleteMany: mocks.deleteImageSearchUploads },
    productIndexJob: { deleteMany: mocks.deleteProductIndexJobs },
    shopProduct: { deleteMany: mocks.deleteShopProducts },
    session: { deleteMany: mocks.deleteSessions },
  },
}));

function args(topic: string): ActionFunctionArgs {
  const url = new URL(`http://localhost/webhooks/${topic}`);
  return {
    request: new Request(url, { method: "POST" }),
    url,
    pattern: `/webhooks/${topic}`,
    params: {},
    context: {},
  };
}

describe("privacy compliance webhooks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acknowledges customers/data_request", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "CUSTOMERS_DATA_REQUEST",
      payload: { shop_domain: "demo.myshopify.com" },
    });
    const { action } = await import("./routes/webhooks.customers.data_request");
    const response = await action(args("customers/data_request"));
    expect(response.status).toBe(200);
  });

  it("acknowledges customers/redact", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "CUSTOMERS_REDACT",
      payload: { shop_domain: "demo.myshopify.com", customer_id: 123 },
    });
    const { action } = await import("./routes/webhooks.customers.redact");
    const response = await action(args("customers/redact"));
    expect(response.status).toBe(200);
    expect(mocks.deleteFavoriteProducts).toHaveBeenCalledWith({
      where: {
        shopDomain: "demo.myshopify.com",
        identityType: "customer",
        identityId: "gid://shopify/Customer/123",
      },
    });
    expect(mocks.deleteImageSearchUploads).toHaveBeenCalledWith({
      where: { shopDomain: "demo.myshopify.com", customerGid: "gid://shopify/Customer/123" },
    });
  });

  it("acknowledges shop/redact", async () => {
    mocks.authenticateWebhook.mockResolvedValueOnce({
      shop: "demo.myshopify.com",
      topic: "SHOP_REDACT",
      payload: { shop_domain: "demo.myshopify.com" },
    });
    const { action } = await import("./routes/webhooks.shop.redact");
    const response = await action(args("shop/redact"));
    expect(response.status).toBe(200);
    expect(mocks.deleteFavoriteProducts).toHaveBeenCalledWith({ where: { shopDomain: "demo.myshopify.com" } });
    expect(mocks.deleteImageSearchUploads).toHaveBeenCalledWith({ where: { shopDomain: "demo.myshopify.com" } });
    expect(mocks.deleteProductIndexJobs).toHaveBeenCalledWith({ where: { shopDomain: "demo.myshopify.com" } });
    expect(mocks.deleteShopProducts).toHaveBeenCalledWith({ where: { shopDomain: "demo.myshopify.com" } });
    expect(mocks.deleteSessions).toHaveBeenCalledWith({ where: { shop: "demo.myshopify.com" } });
  });
});
