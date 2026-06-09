import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/api.storage.uploads.$";

const uploadRoot = "storage/test-api-uploads-route";

function loaderArgs(requestUrl: string, storageKey: string) {
  const url = new URL(requestUrl);
  return {
    request: new Request(url),
    url,
    pattern: "/api/storage/uploads/*",
    params: { "*": storageKey },
    context: {},
  };
}

describe("api storage uploads route", () => {
  beforeEach(async () => {
    vi.stubEnv("UPLOAD_STORAGE_PROVIDER", "local");
    vi.stubEnv("UPLOAD_STORAGE_LOCAL_DIR", uploadRoot);
    await mkdir(path.join(process.cwd(), uploadRoot, "demo-shop.myshopify.com", "upload-1"), { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(path.join(process.cwd(), uploadRoot), { recursive: true, force: true });
  });

  it("serves uploaded thumbnails through the app proxy API path", async () => {
    await writeFile(
      path.join(process.cwd(), uploadRoot, "demo-shop.myshopify.com", "upload-1", "thumbnail.webp"),
      Buffer.from("webp-bytes"),
    );

    const response = await loader(
      loaderArgs(
        "http://localhost/api/storage/uploads/demo-shop.myshopify.com/upload-1/thumbnail.webp",
        "demo-shop.myshopify.com/upload-1/thumbnail.webp",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(await response.text()).toBe("webp-bytes");
  });
});
