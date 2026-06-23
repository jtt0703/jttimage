import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.upload-history";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
  listRecentUploads: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./db.server", () => ({
  default: {
    session: {
      findFirst: mocks.findSession,
    },
  },
}));

vi.mock("./services/upload-history.server", () => ({
  listRecentUploads: mocks.listRecentUploads,
}));

vi.mock("./services/billing.server", async () => {
  const actual = await vi.importActual<typeof import("./services/billing.server")>("./services/billing.server");
  return {
    ...actual,
    requireBillingAccess: mocks.requireBillingAccess,
  };
});

function loaderArgs(requestUrl: string, init?: RequestInit) {
  const url = new URL(requestUrl);
  return {
    request: new Request(url, init),
    url,
    pattern: "/api/upload-history",
    params: {},
    context: {},
  };
}

describe("upload history route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findSession.mockResolvedValue({ id: "session-1", shop: "demo-shop.myshopify.com" });
    mocks.listRecentUploads.mockResolvedValue([]);
    mocks.requireBillingAccess.mockResolvedValue({});
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("allows configured storefront origins when returning recent uploads", async () => {
    vi.stubEnv("STOREFRONT_CORS_ORIGINS", "https://test-klaehgez.myshopify.com");

    const response = await loader(
      loaderArgs(
        "http://localhost/api/upload-history?shop=demo-shop.myshopify.com&anonymousId=4b77dc6e-2ba1-4bd6-a081-e541eb944f64",
        { headers: { Origin: "https://test-klaehgez.myshopify.com" } },
      ),
    );

    expect(response.headers.get("access-control-allow-origin")).toBe("https://test-klaehgez.myshopify.com");
  });

  it("returns 402 when shop is installed but billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());

    const response = await loader(
      loaderArgs("http://localhost/api/upload-history?shop=demo-shop.myshopify.com&anonymousId=4b77dc6e-2ba1-4bd6-a081-e541eb944f64"),
    );

    expect(response.status).toBe(402);
    await expect(response.json()).resolves.toEqual({
      error: "Lens Search is not active for this store.",
      code: "billing_required",
      plan: "Starter",
    });
    expect(mocks.listRecentUploads).not.toHaveBeenCalled();
  });
});
