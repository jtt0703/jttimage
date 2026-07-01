import { describe, expect, it } from "vitest";
import { loader } from "./routes/api.health";

describe("api health route", () => {
  it("returns ok json", async () => {
    const response = await loader();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "lens-cart-ai",
    });
  });
});
