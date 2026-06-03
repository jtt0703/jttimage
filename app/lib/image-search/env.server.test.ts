import { afterEach, describe, expect, it, vi } from "vitest";
import { getImageSearchConfig } from "./env.server";

describe("getImageSearchConfig", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults the image search minimum similarity score", () => {
    vi.stubEnv("IMAGE_SEARCH_MIN_SIMILARITY_SCORE", "");

    expect(getImageSearchConfig().imageSearchMinSimilarityScore).toBe(0.25);
  });

  it("reads the image search minimum similarity score from env", () => {
    vi.stubEnv("IMAGE_SEARCH_MIN_SIMILARITY_SCORE", "0.42");

    expect(getImageSearchConfig().imageSearchMinSimilarityScore).toBe(0.42);
  });
});
