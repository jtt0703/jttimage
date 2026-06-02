import { describe, expect, it } from "vitest";
import {
  assertAllowedImageUpload,
  normalizeLimit,
  parseBooleanParam,
  validateIdentity,
  validateShopDomain,
} from "./validation.server";

describe("image search validation", () => {
  it("accepts valid myshopify domains", () => {
    expect(validateShopDomain("demo-shop.myshopify.com")).toBe("demo-shop.myshopify.com");
  });

  it("rejects invalid shop domains", () => {
    expect(() => validateShopDomain("https://demo-shop.myshopify.com")).toThrow("Invalid shop domain");
    expect(() => validateShopDomain("demo.example.com")).toThrow("Invalid shop domain");
  });

  it("normalizes limit with defaults and max", () => {
    expect(normalizeLimit(null, 12, 48)).toBe(12);
    expect(normalizeLimit("9", 12, 48)).toBe(9);
    expect(normalizeLimit("999", 12, 48)).toBe(48);
    expect(normalizeLimit("abc", 12, 48)).toBe(12);
  });

  it("parses boolean params", () => {
    expect(parseBooleanParam(null, true)).toBe(true);
    expect(parseBooleanParam("true", false)).toBe(true);
    expect(parseBooleanParam("false", true)).toBe(false);
  });

  it("validates anonymous identity", () => {
    expect(
      validateIdentity({ identityType: "anonymous", identityId: "9f4030f7-8528-4e44-badf-6a8fd59ca7c9" }),
    ).toEqual({ identityType: "anonymous", identityId: "9f4030f7-8528-4e44-badf-6a8fd59ca7c9" });
  });

  it("rejects unsupported image uploads", () => {
    expect(() => assertAllowedImageUpload({ contentType: "image/gif", byteSize: 100 })).toThrow(
      "Please upload a JPG, PNG, or WebP image.",
    );
    expect(() => assertAllowedImageUpload({ contentType: "image/jpeg", byteSize: 5 * 1024 * 1024 + 1 })).toThrow(
      "Image is too large. Please upload a smaller image.",
    );
  });
});
