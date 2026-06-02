import type { PrismaClient } from "@prisma/client";
import { createImageUrlHash } from "../lib/image-search/hash.server";

export const IMAGE_SEARCH_PRODUCTS_QUERY = `#graphql
query ImageSearchProducts($query: String!, $first: Int!) {
  shop {
    myshopifyDomain
    currencyCode
  }
  products(first: $first, query: $query) {
    nodes {
      id
      title
      handle
      status
      vendor
      productType
      tags
      featuredMedia {
        ... on MediaImage {
          id
          image {
            id
            url
            altText
            width
            height
          }
        }
      }
      media(first: 10) {
        nodes {
          ... on MediaImage {
            id
            image {
              id
              url
              altText
              width
              height
            }
          }
        }
      }
      variants(first: 10) {
        nodes {
          id
          legacyResourceId
          title
          sku
          price
          compareAtPrice
          availableForSale
          inventoryQuantity
        }
      }
    }
  }
}`;

type ShopifyProductNode = Record<string, any>;

export function mapShopifyProductNode(input: {
  shopDomain: string;
  currencyCode: string;
  product: ShopifyProductNode;
}) {
  const variants = input.product.variants.nodes.map((variant: Record<string, any>) => ({
    shopDomain: input.shopDomain,
    shopifyProductGid: input.product.id,
    shopifyVariantGid: variant.id,
    shopifyVariantNumericId: String(variant.legacyResourceId),
    title: variant.title,
    sku: variant.sku,
    price: variant.price,
    compareAtPrice: variant.compareAtPrice,
    availableForSale: Boolean(variant.availableForSale),
    inventoryQuantity: variant.inventoryQuantity,
    rawShopifyPayload: variant,
  }));

  const prices = variants
    .map((variant: { price: string | null }) => Number.parseFloat(variant.price ?? "0"))
    .filter(Number.isFinite);
  const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : null;
  const totalInventory = variants.reduce(
    (sum: number, variant: { inventoryQuantity: number | null }) => sum + (variant.inventoryQuantity ?? 0),
    0,
  );
  const availableForSale = variants.some((variant: { availableForSale: boolean }) => variant.availableForSale);
  const featuredMediaId = input.product.featuredMedia?.id ?? null;

  const images = input.product.media.nodes
    .filter((media: Record<string, any>) => media?.image?.url)
    .map((media: Record<string, any>, index: number) => ({
      shopDomain: input.shopDomain,
      shopifyProductGid: input.product.id,
      shopifyMediaGid: media.id,
      shopifyImageGid: media.image.id ?? null,
      imageUrl: media.image.url,
      altText: media.image.altText ?? null,
      position: index + 1,
      width: media.image.width ?? null,
      height: media.image.height ?? null,
      isFeatured: media.id === featuredMediaId,
      imageUrlHash: createImageUrlHash(media.image.url),
    }));

  return {
    product: {
      shopDomain: input.shopDomain,
      shopifyProductGid: input.product.id,
      title: input.product.title,
      handle: input.product.handle,
      status: input.product.status,
      vendor: input.product.vendor ?? null,
      productType: input.product.productType ?? null,
      tags: input.product.tags ?? [],
      featuredImageUrl: input.product.featuredMedia?.image?.url ?? images[0]?.imageUrl ?? null,
      minPrice,
      currencyCode: input.currencyCode,
      totalInventory,
      availableForSale,
      rawShopifyPayload: input.product,
      lastSyncedAt: new Date(),
    },
    variants,
    images,
  };
}

export async function fetchShopifyProductsForIndex(input: {
  admin: { graphql(query: string, options: unknown): Promise<Response> };
  query: string;
  first: number;
}) {
  const response = await input.admin.graphql(IMAGE_SEARCH_PRODUCTS_QUERY, {
    variables: { query: input.query, first: input.first },
  });
  const body = await response.json();
  if (body.errors) {
    throw new Error(`Shopify Admin GraphQL failed: ${JSON.stringify(body.errors)}`);
  }
  return {
    shopDomain: body.data.shop.myshopifyDomain as string,
    currencyCode: body.data.shop.currencyCode as string,
    products: body.data.products.nodes as ShopifyProductNode[],
  };
}

export async function upsertMappedProduct(input: {
  prisma: PrismaClient;
  mapped: ReturnType<typeof mapShopifyProductNode>;
}) {
  const product = await input.prisma.shopProduct.upsert({
    where: {
      shopDomain_shopifyProductGid: {
        shopDomain: input.mapped.product.shopDomain,
        shopifyProductGid: input.mapped.product.shopifyProductGid,
      },
    },
    update: input.mapped.product,
    create: input.mapped.product,
  });

  for (const variant of input.mapped.variants) {
    await input.prisma.shopProductVariant.upsert({
      where: {
        shopDomain_shopifyVariantGid: {
          shopDomain: variant.shopDomain,
          shopifyVariantGid: variant.shopifyVariantGid,
        },
      },
      update: { ...variant, productId: product.id },
      create: { ...variant, productId: product.id },
    });
  }

  for (const image of input.mapped.images) {
    const existing = await input.prisma.shopProductImage.findUnique({
      where: {
        shopDomain_shopifyMediaGid: {
          shopDomain: image.shopDomain,
          shopifyMediaGid: image.shopifyMediaGid,
        },
      },
    });

    const shouldResetEmbedding = !existing || existing.imageUrlHash !== image.imageUrlHash;
    await input.prisma.shopProductImage.upsert({
      where: {
        shopDomain_shopifyMediaGid: {
          shopDomain: image.shopDomain,
          shopifyMediaGid: image.shopifyMediaGid,
        },
      },
      update: {
        ...image,
        productId: product.id,
        ...(shouldResetEmbedding ? { embeddingStatus: "pending", embeddingError: null } : {}),
      },
      create: { ...image, productId: product.id, embeddingStatus: "pending" },
    });
  }

  return product;
}
