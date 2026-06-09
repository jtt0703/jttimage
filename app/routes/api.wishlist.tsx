import type { LoaderFunctionArgs } from "react-router";
import { validateShopDomain, verifyShopifyProxySignature } from "../lib/image-search/validation.server";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function customerGidFromProxy(url: URL): string {
  const customerId = url.searchParams.get("logged_in_customer_id");
  return customerId && /^\d+$/.test(customerId) ? `gid://shopify/Customer/${customerId}` : "";
}

function wishlistHtml(input: { shopDomain: string; customerGid: string; apiBaseUrl: string }): string {
  const shopDomain = escapeHtml(input.shopDomain);
  const customerGid = escapeHtml(input.customerGid);
  const apiBaseUrl = escapeHtml(input.apiBaseUrl);

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>LensCart Wishlist</title>
    <style>
      :root {
        color: #111827;
        background: #f8fafc;
        font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      }
      body {
        margin: 0;
      }
      .lenscart-page {
        max-width: 1180px;
        margin: 0 auto;
        padding: 32px 20px 56px;
      }
      .lenscart-page-header {
        display: flex;
        align-items: end;
        justify-content: space-between;
        gap: 16px;
        margin-bottom: 22px;
      }
      h1 {
        margin: 0;
        font-size: 34px;
        line-height: 1.12;
        font-weight: 680;
      }
      .lenscart-status {
        min-height: 20px;
        color: #64748b;
        font-size: 14px;
      }
      .lenscart-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(190px, 1fr));
        gap: 16px;
      }
      .lenscart-card {
        display: flex;
        flex-direction: column;
        gap: 8px;
        padding: 10px;
        border: 1px solid #e2e8f0;
        border-radius: 16px;
        background: #fff;
        box-shadow: 0 10px 24px rgba(15, 23, 42, 0.08);
      }
      .lenscart-card img {
        width: 100%;
        aspect-ratio: 1;
        border-radius: 12px;
        background: #f8fafc;
        object-fit: contain;
      }
      .lenscart-card h2 {
        margin: 0;
        font-size: 14px;
        line-height: 1.3;
        font-weight: 650;
      }
      .lenscart-card p {
        margin: 0;
        color: #475569;
        font-size: 13px;
      }
      .lenscart-card a,
      .lenscart-card button,
      .lenscart-back {
        display: block;
        border: 1px solid #111827;
        border-radius: 999px;
        padding: 10px 14px;
        background: #fff;
        color: #111827;
        font: inherit;
        font-size: 14px;
        text-align: center;
        text-decoration: none;
        cursor: pointer;
      }
      .lenscart-card a:hover,
      .lenscart-card button:hover,
      .lenscart-back:hover {
        background: #111827;
        color: #fff;
      }
      .lenscart-card button:disabled {
        cursor: not-allowed;
        border-color: #cbd5e1;
        background: #f1f5f9;
        color: #94a3b8;
      }
      @media (max-width: 680px) {
        .lenscart-page-header {
          align-items: start;
          flex-direction: column;
        }
      }
    </style>
  </head>
  <body>
    <main class="lenscart-page" data-shop-domain="${shopDomain}" data-customer-gid="${customerGid}" data-api-base-url="${apiBaseUrl}">
      <header class="lenscart-page-header">
        <div>
          <h1>Wishlist</h1>
          <div class="lenscart-status" data-lenscart-status>Loading saved products...</div>
        </div>
        <a class="lenscart-back" href="/collections/all">Continue shopping</a>
      </header>
      <section class="lenscart-grid" data-lenscart-products></section>
    </main>
    <script>
      (function () {
        const root = document.querySelector("[data-shop-domain]");
        const status = document.querySelector("[data-lenscart-status]");
        const productsRoot = document.querySelector("[data-lenscart-products]");
        const shop = root.dataset.shopDomain;
        const apiBaseUrl = root.dataset.apiBaseUrl || "/apps/lens-cart-ai";
        const keys = {
          anonymousId: "lensCartAi.v1.anonymousId",
          favorites: (shopDomain) => "lensCartAi.v1.favoriteProducts." + shopDomain,
          favoriteProductCards: (shopDomain) => "lensCartAi.v1.favoriteProductCards." + shopDomain,
        };

        function uuid() {
          if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
          return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (char) {
            const rand = Math.random() * 16 | 0;
            const value = char === "x" ? rand : (rand & 0x3) | 0x8;
            return value.toString(16);
          });
        }

        function getAnonymousId() {
          let value = localStorage.getItem(keys.anonymousId);
          if (!value) {
            value = uuid();
            localStorage.setItem(keys.anonymousId, value);
          }
          return value;
        }

        function favoriteIdentity() {
          if (root.dataset.customerGid) return { identityType: "customer", identityId: root.dataset.customerGid };
          return { identityType: "anonymous", identityId: getAnonymousId() };
        }

        function money(product) {
          return product.price && product.currencyCode ? product.currencyCode + " " + product.price : "";
        }

        function readJson(key, fallback) {
          try {
            return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
          } catch (_error) {
            return fallback;
          }
        }

        function productUrl(product) {
          const rootPath = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
          return rootPath.replace(/\\/$/, "") + "/products/" + product.handle;
        }

        function favoriteProductsFromCache() {
          const favorites = readJson(keys.favorites(shop), []);
          const cards = readJson(keys.favoriteProductCards(shop), {});
          return favorites.map(function (productGid) { return cards[productGid]; }).filter(function (product) {
            return product && product.handle;
          });
        }

        function cacheFavoriteProducts(products) {
          const cards = readJson(keys.favoriteProductCards(shop), {});
          products.forEach(function (product) {
            if (!product || !product.productGid) return;
            cards[product.productGid] = {
              productGid: product.productGid,
              variantGid: product.variantGid || null,
              variantId: product.variantId || null,
              title: product.title || "",
              handle: product.handle || "",
              imageUrl: product.imageUrl || null,
              price: product.price || null,
              compareAtPrice: product.compareAtPrice || null,
              currencyCode: product.currencyCode || null,
              availableForSale: Boolean(product.availableForSale),
              variantTitle: product.variantTitle || null,
              similarityScore: product.similarityScore || null,
              isFavorited: true,
            };
          });
          localStorage.setItem(keys.favoriteProductCards(shop), JSON.stringify(cards));
        }

        async function readJsonResponse(response) {
          const text = await response.text();
          if (!text) return {};
          return JSON.parse(text);
        }

        async function addToCart(product, button) {
          if (!product.availableForSale || !product.variantId) return;
          button.textContent = "Adding...";
          button.disabled = true;
          try {
            const response = await fetch("/cart/add.js", {
              method: "POST",
              headers: { "Content-Type": "application/json", Accept: "application/json" },
              body: JSON.stringify({ id: product.variantId, quantity: 1 }),
            });
            if (!response.ok) throw new Error("cart failed");
            button.textContent = "Added";
          } catch (_error) {
            button.textContent = "Add to Cart";
            button.disabled = false;
            status.textContent = "Unable to add item to cart. Please try again.";
          }
        }

        function renderProducts(products) {
          productsRoot.innerHTML = "";
          products.forEach(function (product) {
            const card = document.createElement("article");
            card.className = "lenscart-card";

            const image = document.createElement("img");
            image.src = product.imageUrl || "";
            image.alt = product.title;
            card.appendChild(image);

            const title = document.createElement("h2");
            title.textContent = product.title;
            card.appendChild(title);

            const variant = document.createElement("p");
            variant.textContent = product.variantTitle || "";
            card.appendChild(variant);

            const price = document.createElement("p");
            price.textContent = money(product);
            card.appendChild(price);

            const link = document.createElement("a");
            link.href = productUrl(product);
            link.textContent = "View product";
            card.appendChild(link);

            const cart = document.createElement("button");
            cart.type = "button";
            cart.textContent = product.availableForSale ? "Add to Cart" : "Sold out";
            cart.disabled = !product.availableForSale;
            cart.addEventListener("click", function () { addToCart(product, cart); });
            card.appendChild(cart);

            productsRoot.appendChild(card);
          });
        }

        async function loadWishlist() {
          const cachedProducts = favoriteProductsFromCache();
          try {
            const identity = favoriteIdentity();
            const params = new URLSearchParams({ shop, identityType: identity.identityType, identityId: identity.identityId });
            const response = await fetch(apiBaseUrl + "/favorites?" + params);
            const body = await readJsonResponse(response);
            if (!response.ok) throw new Error(body.error || "Wishlist unavailable.");
            const apiProducts = Array.isArray(body.products) ? body.products : [];
            cacheFavoriteProducts(apiProducts);
            const products = apiProducts.length ? apiProducts : cachedProducts;
            localStorage.setItem(keys.favorites(shop), JSON.stringify(body.favorites && body.favorites.length ? body.favorites : products.map(function (product) { return product.productGid; })));
            status.textContent = products.length ? "" : "No saved products yet.";
            renderProducts(products);
          } catch (_error) {
            const products = favoriteProductsFromCache();
            status.textContent = products.length ? "" : "No saved products yet.";
            renderProducts(products);
          }
        }

        loadWishlist();
      })();
    </script>
  </body>
</html>`;
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);
  if (process.env.NODE_ENV === "production" && !verifyShopifyProxySignature(url, process.env.SHOPIFY_API_SECRET ?? "")) {
    return Response.json({ error: "Invalid app proxy signature" }, { status: 401 });
  }

  let shopDomain: string;
  try {
    shopDomain = validateShopDomain(url.searchParams.get("shop"));
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Invalid wishlist request" }, { status: 400 });
  }

  const apiBaseUrl = url.searchParams.get("path_prefix") || "/apps/lens-cart-ai";
  return new Response(wishlistHtml({ shopDomain, customerGid: customerGidFromProxy(url), apiBaseUrl }), {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
};
