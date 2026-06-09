import { beforeEach, describe, expect, it, vi } from "vitest";
import { MilvusUnavailableError } from "./services/milvus-client.server";
import { action } from "./routes/api.image-search.search";

const mocks = vi.hoisted(() => ({
  findSession: vi.fn(),
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
});
