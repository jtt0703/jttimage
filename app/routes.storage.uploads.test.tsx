import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loader } from "./routes/storage.uploads.$";

const uploadRoot = "storage/test-uploads-route";
const outsideUploadRoot = "storage/test-uploads-route-outside";

function loaderArgs(requestUrl: string, storageKey: string) {
  const url = new URL(requestUrl);
  return {
    request: new Request(url),
    url,
    pattern: "/storage/uploads/*",
    params: { "*": storageKey },
    context: {},
  };
}

describe("storage uploads route", () => {
  beforeEach(async () => {
    vi.stubEnv("UPLOAD_STORAGE_LOCAL_DIR", uploadRoot);
    await mkdir(path.join(process.cwd(), uploadRoot, "demo-shop.myshopify.com", "upload-1"), { recursive: true });
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await rm(path.join(process.cwd(), uploadRoot), { recursive: true, force: true });
    await rm(path.join(process.cwd(), outsideUploadRoot), { recursive: true, force: true });
  });

  it("serves a local uploaded thumbnail with the correct content type", async () => {
    await writeFile(
      path.join(process.cwd(), uploadRoot, "demo-shop.myshopify.com", "upload-1", "thumbnail.webp"),
      Buffer.from("webp-bytes"),
    );

    const response = await loader(
      loaderArgs(
        "http://localhost/storage/uploads/demo-shop.myshopify.com/upload-1/thumbnail.webp",
        "demo-shop.myshopify.com/upload-1/thumbnail.webp",
      ),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("image/webp");
    expect(await response.text()).toBe("webp-bytes");
  });

  it("returns not found when the upload does not exist", async () => {
    const response = await loader(
      loaderArgs(
        "http://localhost/storage/uploads/demo-shop.myshopify.com/missing/thumbnail.webp",
        "demo-shop.myshopify.com/missing/thumbnail.webp",
      ),
    );

    expect(response.status).toBe(404);
  });

  it("blocks path traversal outside the upload directory", async () => {
    await mkdir(path.join(process.cwd(), outsideUploadRoot), { recursive: true });
    await writeFile(path.join(process.cwd(), outsideUploadRoot, "secret.webp"), Buffer.from("secret"));

    const response = await loader(
      loaderArgs(
        "http://localhost/storage/uploads/../test-uploads-route-outside/secret.webp",
        "../test-uploads-route-outside/secret.webp",
      ),
    );

    expect(response.status).toBe(404);
  });
});
