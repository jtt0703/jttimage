import type { PrismaClient } from "@prisma/client";
import { createImageUrlHash } from "../lib/image-search/hash.server";
import { logger } from "../lib/logger.server";

export const IMAGE_SEARCH_PRODUCTS_QUERY = `#graphql
query ImageSearchProducts($query: String!, $first: Int!, $after: String, $mediaFirst: Int!, $variantsFirst: Int!) {
  shop {
    myshopifyDomain
    currencyCode
  }
  products(first: $first, after: $after, query: $query) {
    pageInfo {
      hasNextPage
      endCursor
    }
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
      media(first: $mediaFirst) {
        pageInfo {
          hasNextPage
          endCursor
        }
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
      variants(first: $variantsFirst) {
        pageInfo {
          hasNextPage
          endCursor
        }
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

type ShopifyConnection<T> = {
  nodes: T[];
  pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
};

type ShopifyMediaNode = {
  id: string;
  image?: {
    id?: string | null;
    url?: string | null;
    altText?: string | null;
    width?: number | null;
    height?: number | null;
  } | null;
};

type ShopifyVariantNode = {
  id: string;
  legacyResourceId: string | number;
  title: string;
  sku?: string | null;
  price?: string | null;
  compareAtPrice?: string | null;
  availableForSale?: boolean | null;
  inventoryQuantity?: number | null;
};

type ShopifyProductNode = {
  id: string;
  title: string;
  handle: string;
  status: string;
  vendor?: string | null;
  productType?: string | null;
  tags?: string[] | null;
  featuredMedia?: ShopifyMediaNode | null;
  media: ShopifyConnection<ShopifyMediaNode>;
  variants: ShopifyConnection<ShopifyVariantNode>;
};

type MappedVariant = {
  shopDomain: string;
  shopifyProductGid: string;
  shopifyVariantGid: string;
  shopifyVariantNumericId: string;
  title: string;
  sku: string | null;
  price: string | null;
  compareAtPrice: string | null;
  availableForSale: boolean;
  inventoryQuantity: number | null;
  rawShopifyPayload: ShopifyVariantNode;
};

type MappedImage = {
  shopDomain: string;
  shopifyProductGid: string;
  shopifyMediaGid: string;
  shopifyImageGid: string | null;
  imageUrl: string;
  altText: string | null;
  position: number;
  width: number | null;
  height: number | null;
  isFeatured: boolean;
  imageUrlHash: string;
};

export function mapShopifyProductNode(input: {
  shopDomain: string;
  currencyCode: string;
  product: ShopifyProductNode;
}) {
  const variants: MappedVariant[] = input.product.variants.nodes.map((variant) => ({
    shopDomain: input.shopDomain,
    shopifyProductGid: input.product.id,
    shopifyVariantGid: variant.id,
    shopifyVariantNumericId: String(variant.legacyResourceId),
    title: variant.title,
    sku: variant.sku ?? null,
    price: variant.price ?? null,
    compareAtPrice: variant.compareAtPrice ?? null,
    availableForSale: Boolean(variant.availableForSale),
    inventoryQuantity: variant.inventoryQuantity ?? null,
    rawShopifyPayload: variant,
  }));

  const prices = variants.map((variant) => Number.parseFloat(variant.price ?? "0")).filter(Number.isFinite);
  const minPrice = prices.length > 0 ? Math.min(...prices).toFixed(2) : null;
  const totalInventory = variants.reduce((sum, variant) => sum + (variant.inventoryQuantity ?? 0), 0);
  const availableForSale = variants.some((variant) => variant.availableForSale);
  const featuredMediaId = input.product.featuredMedia?.id ?? null;

  if (input.product.media?.pageInfo?.hasNextPage) {
    logger.warn(
      {
        event: "shopify_sync.pagination_warning",
        shopDomain: input.shopDomain,
        shopifyProductGid: input.product.id,
        connection: "media",
      },
      "shopify product has additional media pages not fetched by current query",
    );
  }
  if (input.product.variants?.pageInfo?.hasNextPage) {
    logger.warn(
      {
        event: "shopify_sync.pagination_warning",
        shopDomain: input.shopDomain,
        shopifyProductGid: input.product.id,
        connection: "variants",
      },
      "shopify product has additional variant pages not fetched by current query",
    );
  }

  const imageMedia = input.product.media.nodes.filter(
    (media): media is ShopifyMediaNode & { image: NonNullable<ShopifyMediaNode["image"]> & { url: string } } =>
      Boolean(media?.image?.url),
  );
  const images: MappedImage[] = imageMedia.map((media, index) => ({
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
  mediaFirst?: number;
  variantsFirst?: number;
}) {
  let after: string | null = null;
  let shopDomain: string | null = null;
  let currencyCode: string | null = null;
  const products: ShopifyProductNode[] = [];

  do {
    logger.info(
      {
        event: "shopify_sync.page_fetch_started",
        query: input.query,
        first: input.first,
        after,
      },
      "fetching shopify products page",
    );
    const response = await input.admin.graphql(IMAGE_SEARCH_PRODUCTS_QUERY, {
      variables: {
        query: input.query,
        first: input.first,
        after,
        mediaFirst: input.mediaFirst ?? 25,
        variantsFirst: input.variantsFirst ?? 50,
      },
    });
    const body = await response.json();
    if (body.errors) {
      throw new Error(`Shopify Admin GraphQL failed: ${JSON.stringify(body.errors)}`);
    }

    shopDomain = body.data.shop.myshopifyDomain as string;
    currencyCode = body.data.shop.currencyCode as string;
    const page = body.data.products;
    products.push(...(page.nodes as ShopifyProductNode[]));
    logger.info(
      {
        event: "shopify_sync.page_fetch_completed",
        shopDomain,
        fetchedCount: page.nodes.length,
        totalFetched: products.length,
        hasNextPage: page.pageInfo.hasNextPage,
      },
      "shopify products page fetched",
    );
    after = page.pageInfo.hasNextPage ? page.pageInfo.endCursor : null;
  } while (after);

  return {
    shopDomain: shopDomain as string,
    currencyCode: currencyCode as string,
    products,
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

  logger.info(
    {
      event: "shopify_sync.product_upserted",
      shopDomain: input.mapped.product.shopDomain,
      shopifyProductGid: input.mapped.product.shopifyProductGid,
      variantsCount: input.mapped.variants.length,
      imagesCount: input.mapped.images.length,
    },
    "shopify product upserted",
  );

  return product;
}
