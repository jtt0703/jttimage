import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("app index copy", () => {
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
});
