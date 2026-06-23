import type { ActionFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { action } from "./routes/api.image-search.index-products";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  createProductIndexJob: vi.fn(),
  enqueueProductImageIndexJob: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./db.server", () => ({
  default: {
    productIndexJob: {
      create: mocks.createProductIndexJob,
    },
  },
}));

vi.mock("./lib/image-search/env.server", () => ({
  getImageSearchConfig: () => ({
    shopifyProductQuery: "status:active",
    shopifyProductsPageSize: 50,
  }),
}));

vi.mock("./services/job-queue.server", () => ({
  enqueueProductImageIndexJob: mocks.enqueueProductImageIndexJob,
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

function actionArgs(request: Request): ActionFunctionArgs {
  return {
    request,
    url: new URL(request.url),
    pattern: "/api/image-search/index-products",
    params: {},
    context: {},
  };
}

describe("image search product indexing route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "demo.myshopify.com" },
      admin: {},
    });
    mocks.createProductIndexJob.mockResolvedValue({
      id: "job-1",
      status: "queued",
      productsSeen: 0,
      variantsSeen: 0,
      imagesSeen: 0,
      imagesIndexed: 0,
      imagesSkipped: 0,
      imagesFailed: 0,
    });
  });

  it("returns 402 when billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/image-search/index-products", {
          method: "POST",
          body: JSON.stringify({ mode: "incremental" }),
        }),
      ),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
    expect(mocks.createProductIndexJob).not.toHaveBeenCalled();
    expect(mocks.enqueueProductImageIndexJob).not.toHaveBeenCalled();
  });
});
