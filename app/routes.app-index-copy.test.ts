import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { LoaderFunctionArgs } from "react-router";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  authenticateAdmin: vi.fn(),
  countShopProductImages: vi.fn(),
  findProductIndexJob: vi.fn(),
  requireBillingAccess: vi.fn(),
}));

vi.mock("./shopify.server", () => ({
  authenticate: { admin: mocks.authenticateAdmin },
}));

vi.mock("./db.server", () => ({
  default: {
    productIndexJob: {
      findFirst: mocks.findProductIndexJob,
    },
    shopProductImage: {
      count: mocks.countShopProductImages,
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

function loaderArgs(request: Request): LoaderFunctionArgs {
  const url = new URL(request.url);
  return {
    request,
    url,
    pattern: url.pathname,
    params: {},
    context: {},
  };
}

describe("app index copy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.authenticateAdmin.mockResolvedValue({
      session: { shop: "demo.myshopify.com" },
      admin: {},
    });
    mocks.requireBillingAccess.mockResolvedValue({});
    mocks.findProductIndexJob.mockResolvedValue(null);
    mocks.countShopProductImages.mockResolvedValue(0);
  });

  it("explains manual indexing without mentioning the old development tag filter", () => {
    const source = readFileSync(join(process.cwd(), "app/routes/app._index.tsx"), "utf8");
    const normalizedSource = source.replace(/\s+/g, " ");

    expect(normalizedSource).toContain("Use these buttons to index products from the configured Shopify product query.");
    expect(normalizedSource).toContain(
      "Shopify product create, update, and delete changes are handled automatically by webhooks.",
    );
    expect(normalizedSource).toContain("LensCart AI Overview");
    expect(source).not.toContain("lenscart-test");
  });

  it("uses production public landing copy", () => {
    const source = readFileSync(join(process.cwd(), "app/routes/_index/route.tsx"), "utf8");

    expect(source).toContain("Lens Search");
    expect(source).toContain("AI image search for Shopify storefronts");
    expect(source).toContain("Upload an image, find matching products, and save favorites");
    expect(source).not.toContain("A short heading about [your app]");
    expect(source).not.toContain("A tagline about [your app]");
    expect(source).not.toContain("Product feature");
  });

  it("uses launch-focused app navigation instead of the template additional page", () => {
    const appShell = readFileSync(join(process.cwd(), "app/routes/app.tsx"), "utf8");

    expect(appShell).toContain('href="/app/settings"');
    expect(appShell).toContain(">Settings<");
    expect(appShell).toContain('href="/app/billing"');
    expect(appShell).toContain(">Billing<");
    expect(appShell).not.toContain("/app/additional");
    expect(appShell).not.toContain("Additional page");
    expect(existsSync(join(process.cwd(), "app/routes/app.additional.tsx"))).toBe(false);
  });

  it("keeps the previous completed job visible while a new background job is queued", () => {
    const source = readFileSync(join(process.cwd(), "app/routes/app._index.tsx"), "utf8");
    const normalizedSource = source.replace(/\s+/g, " ");

    expect(normalizedSource).toContain("const currentJob = lastJob;");
    expect(normalizedSource).toContain("Index job queued");
    expect(normalizedSource).toContain("The worker is processing this job in the background.");
    expect(normalizedSource).toContain("Refresh status");
    expect(normalizedSource).toContain("Index job queued. Refresh this page in a moment to see updated counts.");
  });

  it("redirects app index to billing with embedded Shopify query params when billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());
    const { loader } = await import("./routes/app._index");

    try {
      await loader(
        loaderArgs(
          new Request(
            "https://search.pagelumo.com/app?embedded=1&host=encoded-host&shop=demo.myshopify.com&id_token=token",
          ),
        ),
      );
      throw new Error("Expected loader to redirect");
    } catch (error) {
      expect(error).toMatchObject({ status: 302 });
      expect((error as Response).headers.get("location")).toBe(
        "/app/billing?embedded=1&host=encoded-host&shop=demo.myshopify.com&id_token=token",
      );
    }
  });

  it("redirects settings to billing with embedded Shopify query params when billing is inactive", async () => {
    const { BillingAccessError } = await import("./services/billing.server");
    mocks.requireBillingAccess.mockRejectedValue(new BillingAccessError());
    const { loader } = await import("./routes/app.settings");

    try {
      await loader(
        loaderArgs(
          new Request(
            "https://search.pagelumo.com/app/settings?embedded=1&host=encoded-host&shop=demo.myshopify.com&id_token=token",
          ),
        ),
      );
      throw new Error("Expected loader to redirect");
    } catch (error) {
      expect(error).toMatchObject({ status: 302 });
      expect((error as Response).headers.get("location")).toBe(
        "/app/billing?embedded=1&host=encoded-host&shop=demo.myshopify.com&id_token=token",
      );
    }
  });
});
