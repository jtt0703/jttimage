import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MilvusUnavailableError } from "./services/milvus-client.server";
import { action } from "./routes/api.image-search.search";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  requireBillingAccess: vi.fn(),
  runImageSearch: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {
    session: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("./services/image-search.server", () => ({
  runImageSearch: mocks.runImageSearch,
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

function actionArgs(request: Request) {
  const url = new URL(request.url);
  return {
    request,
    url,
    pattern: "/api/image-search/search",
    params: {},
    context: {},
  };
}

describe("image search route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.requireBillingAccess.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("returns a 503 json response when Milvus is unavailable", async () => {
    const formData = new FormData();
    formData.set("shop", "demo-shop.myshopify.com");
    formData.set("anonymousId", "anon-1");
    formData.set("image", new File([Buffer.from("webp")], "query.webp", { type: "image/webp" }));
    mocks.runImageSearch.mockRejectedValue(new MilvusUnavailableError("Milvus search is unavailable"));

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/image-search/search", {
          method: "POST",
          body: formData,
        }),
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      error: "Image search is temporarily unavailable. Please try again later.",
    });
  });

  it("allows configured storefront origins when returning search results", async () => {
    vi.stubEnv("STOREFRONT_CORS_ORIGINS", "https://test-klaehgez.myshopify.com");
    const formData = new FormData();
    formData.set("shop", "demo-shop.myshopify.com");
    formData.set("anonymousId", "anon-1");
    formData.set("image", new File([Buffer.from("webp")], "query.webp", { type: "image/webp" }));
    mocks.runImageSearch.mockResolvedValue({
      uploadId: "upload-1",
      results: [],
      favorites: [],
      recentUploads: [],
      queryMeta: {},
    });

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/image-search/search", {
          method: "POST",
          headers: { Origin: "https://test-klaehgez.myshopify.com" },
          body: formData,
        }),
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("access-control-allow-origin")).toBe("https://test-klaehgez.myshopify.com");
  });

  it("returns 402 when shop is installed but billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());
    const formData = new FormData();
    formData.set("shop", "demo-shop.myshopify.com");
    formData.set("anonymousId", "anon-1");
    formData.set("image", new File([Buffer.from("webp")], "query.webp", { type: "image/webp" }));

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/image-search/search", {
          method: "POST",
          body: formData,
        }),
      ),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search billing is not active for this store.",
      code: "billing_required",
      reason: "billing_inactive",
      plan: "Starter",
    });
    expect(mocks.runImageSearch).not.toHaveBeenCalled();
  });

  it("returns a json 500 response when the pre-search checks fail unexpectedly", async () => {
    mocks.requireBillingAccess.mockRejectedValue(new Error("Billing lookup failed"));
    const formData = new FormData();
    formData.set("shop", "demo-shop.myshopify.com");
    formData.set("anonymousId", "anon-1");
    formData.set("image", new File([Buffer.from("webp")], "query.webp", { type: "image/webp" }));

    const response = await action(
      actionArgs(
        new Request("http://localhost/api/image-search/search", {
          method: "POST",
          body: formData,
        }),
      ),
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Something went wrong. Please try again.",
    });
    expect(mocks.runImageSearch).not.toHaveBeenCalled();
  });
});
