import type { ProductCardDTO } from "./types";

type DecimalLike = { toString(): string } | string | number | null | undefined;

interface ProductLike {
  shopifyProductGid: string;
  title: string;
  handle: string;
  featuredImageUrl: string | null;
  minPrice: DecimalLike;
  currencyCode: string | null;
  availableForSale: boolean;
}

interface VariantLike {
  shopifyVariantGid: string;
  shopifyVariantNumericId: string;
  title: string;
  price: DecimalLike;
  compareAtPrice: DecimalLike;
  availableForSale: boolean;
}

function decimalToString(value: DecimalLike): string | null {
  if (value === null || value === undefined) return null;
  return value.toString();
}

export function buildProductCardDTO(input: {
  product: ProductLike;
  variants: VariantLike[];
  imageUrl?: string | null;
  similarityScore: number | null;
  isFavorited: boolean;
}): ProductCardDTO {
  const variant = input.variants.find((item) => item.availableForSale) ?? input.variants[0] ?? null;

  return {
    productGid: input.product.shopifyProductGid,
    variantGid: variant?.shopifyVariantGid ?? null,
    variantId: variant?.shopifyVariantNumericId ?? null,
    title: input.product.title,
    handle: input.product.handle,
    imageUrl: input.imageUrl ?? input.product.featuredImageUrl,
    price: decimalToString(variant?.price ?? input.product.minPrice),
    compareAtPrice: decimalToString(variant?.compareAtPrice),
    currencyCode: input.product.currencyCode,
    availableForSale: input.product.availableForSale && Boolean(variant?.availableForSale),
    variantTitle: variant?.title ?? null,
    similarityScore: input.similarityScore,
    isFavorited: input.isFavorited,
  };
}
