import { validateHeaderValue } from "node:http";
import { describe, expect, it } from "vitest";
import { buildS3OriginalFilenameMetadata } from "./upload-storage.server";

describe("buildS3OriginalFilenameMetadata", () => {
  it("encodes uploaded filenames into header-safe S3 metadata", () => {
    const filename = "测试 image 😀\n.png";

    const metadata = buildS3OriginalFilenameMetadata(filename);

    expect(metadata).toEqual({
      originalFilenameBase64: Buffer.from(filename, "utf8").toString("base64url"),
    });
    expect(metadata?.originalFilenameBase64).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(() => validateHeaderValue("x-amz-meta-originalfilenamebase64", metadata!.originalFilenameBase64)).not.toThrow();
  });
});
