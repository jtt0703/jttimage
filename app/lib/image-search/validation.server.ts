import { createHmac, timingSafeEqual } from "node:crypto";
import type { IdentityType } from "./types";

const SHOP_DOMAIN_RE = /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CUSTOMER_GID_RE = /^gid:\/\/shopify\/Customer\/\d+$/;
const PRODUCT_GID_RE = /^gid:\/\/shopify\/Product\/\d+$/;
const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function validateShopDomain(shop: string | null | undefined): string {
  if (!shop || !SHOP_DOMAIN_RE.test(shop)) {
    throw new Error("Invalid shop domain");
  }
  return shop;
}

export function normalizeLimit(raw: string | null, defaultLimit: number, maxLimit: number): number {
  const parsed = raw ? Number.parseInt(raw, 10) : defaultLimit;
  if (!Number.isFinite(parsed) || parsed < 1) return defaultLimit;
  return Math.min(parsed, maxLimit);
}

export function parseBooleanParam(raw: string | null, fallback: boolean): boolean {
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function validateIdentity(input: { identityType?: string | null; identityId?: string | null }): {
  identityType: IdentityType;
  identityId: string;
} {
  const identityType = input.identityType ?? "anonymous";
  const identityId = input.identityId ?? "";

  if (identityType === "anonymous" && UUID_RE.test(identityId)) {
    return { identityType, identityId };
  }

  if (identityType === "customer" && CUSTOMER_GID_RE.test(identityId)) {
    return { identityType, identityId };
  }

  throw new Error("Invalid identity");
}

export function validateShopifyProductGid(productGid: string | null | undefined): string {
  if (!productGid || !PRODUCT_GID_RE.test(productGid)) {
    throw new Error("Invalid productGid");
  }
  return productGid;
}

export function assertAllowedImageUpload(input: { contentType: string; byteSize: number }): void {
  if (!ALLOWED_IMAGE_TYPES.has(input.contentType)) {
    throw new Error("Please upload a JPG, PNG, or WebP image.");
  }
  if (input.byteSize > MAX_UPLOAD_BYTES) {
    throw new Error("Image is too large. Please upload a smaller image.");
  }
}

export function verifyShopifyProxySignature(url: URL, secret: string): boolean {
  const signature = url.searchParams.get("signature");
  if (!signature || !secret) return false;

  const pairs: string[] = [];
  for (const [key, value] of url.searchParams.entries()) {
    if (key === "signature") continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const digest = createHmac("sha256", secret).update(pairs.join("")).digest("hex");
  const expected = Buffer.from(digest, "utf8");
  const actual = Buffer.from(signature, "utf8");

  if (expected.length !== actual.length) return false;
  return timingSafeEqual(expected, actual);
}
