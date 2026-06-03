(function () {
  const keys = {
    anonymousId: "lensCartAi.v1.anonymousId",
    recentUploads: (shop) => `lensCartAi.v1.recentUploads.${shop}`,
    favorites: (shop) => `lensCartAi.v1.favoriteProducts.${shop}`,
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

  function readJson(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key) || JSON.stringify(fallback));
    } catch (_error) {
      return fallback;
    }
  }

  function writeJson(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
  }

  function money(product) {
    return product.price && product.currencyCode ? `${product.currencyCode} ${product.price}` : "";
  }

  function storefrontAssetUrl(url, apiBaseUrl) {
    if (!url) return "";
    if (url.startsWith("/storage/uploads/")) return `${apiBaseUrl}${url}`;
    return url;
  }

  async function readJsonResponse(response) {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch (_error) {
      throw new Error("Something went wrong. Please try again.");
    }
  }

  async function addToCart(product, button, status) {
    if (!product.availableForSale || !product.variantId) return;
    button.textContent = "Adding…";
    button.disabled = true;
    try {
      const response = await fetch("/cart/add.js", {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ id: product.variantId, quantity: 1 }),
      });
      if (!response.ok) throw new Error("cart failed");
      button.textContent = "Added";
      status.textContent = "";
    } catch (_error) {
      button.textContent = "Add to Cart";
      button.disabled = false;
      status.textContent = "Unable to add item to cart. Please try again.";
    }
  }

  function renderProducts(container, products, status, shop, apiBaseUrl, sourceSurface) {
    const favoritesKey = keys.favorites(shop);
    const favorites = new Set(readJson(favoritesKey, []));
    container.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "lenscart-ai-card";
      card.tabIndex = 0;
      card.addEventListener("click", () => { window.location.href = `/products/${product.handle}`; });

      const image = document.createElement("img");
      image.src = product.imageUrl || "";
      image.alt = product.title;
      card.appendChild(image);

      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "lenscart-ai-favorite";
      favorite.textContent = favorites.has(product.productGid) || product.isFavorited ? "♥" : "♡";
      favorite.addEventListener("click", async (event) => {
        event.stopPropagation();
        const isFavorited = favorites.has(product.productGid);
        if (isFavorited) favorites.delete(product.productGid); else favorites.add(product.productGid);
        writeJson(favoritesKey, Array.from(favorites));
        favorite.textContent = isFavorited ? "♡" : "♥";
        const path = isFavorited ? "/favorites/delete" : "/favorites";
        try {
          await fetch(`${apiBaseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop,
              identityType: "anonymous",
              identityId: getAnonymousId(),
              shopifyProductGid: product.productGid,
              shopifyVariantGid: product.variantGid,
              sourceSurface,
            }),
          });
        } catch (_error) {
          status.textContent = "Favorite saved locally. Sync will retry next time.";
        }
      });
      card.appendChild(favorite);

      const title = document.createElement("h3");
      title.textContent = product.title;
      card.appendChild(title);

      const variant = document.createElement("p");
      variant.textContent = product.variantTitle || "";
      card.appendChild(variant);

      const price = document.createElement("p");
      price.textContent = money(product);
      card.appendChild(price);

      const similar = document.createElement("button");
      similar.type = "button";
      similar.textContent = "Find Similar";
      similar.addEventListener("click", (event) => event.stopPropagation());
      card.appendChild(similar);

      const cart = document.createElement("button");
      cart.type = "button";
      cart.textContent = product.availableForSale ? "Add to Cart" : "Sold out";
      cart.disabled = !product.availableForSale;
      cart.addEventListener("click", (event) => {
        event.stopPropagation();
        addToCart(product, cart, status);
      });
      card.appendChild(cart);

      container.appendChild(card);
    });
  }

  function initImageSearch(root) {
    const shop = root.dataset.shopDomain;
    const apiBaseUrl = root.dataset.apiBaseUrl || "/apps/lens-cart-ai";
    const modal = root.querySelector("[data-lenscart-modal]");
    const open = root.querySelector("[data-lenscart-open]");
    const closes = root.querySelectorAll("[data-lenscart-close]");
    const fileInput = root.querySelector("[data-lenscart-file]");
    const preview = root.querySelector("[data-lenscart-preview]");
    const status = root.querySelector("[data-lenscart-status]");
    const results = root.querySelector("[data-lenscart-results]");
    const recent = root.querySelector("[data-lenscart-recent]");
    const availableOnly = root.querySelector("[data-lenscart-available-only]");

    function renderRecent(items) {
      writeJson(keys.recentUploads(shop), items);
      recent.innerHTML = "";
      items.forEach((item) => {
        const img = document.createElement("img");
        img.src = storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl);
        img.alt = "Recent upload";
        recent.appendChild(img);
      });
    }

    open.addEventListener("click", () => { modal.hidden = false; });
    closes.forEach((button) => button.addEventListener("click", () => { modal.hidden = true; }));
    renderRecent(readJson(keys.recentUploads(shop), []));

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        status.textContent = "Please upload a JPG, PNG, or WebP image.";
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        status.textContent = "Image is too large. Please upload a smaller image.";
        return;
      }
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = URL.createObjectURL(file);
      img.alt = "Uploaded image preview";
      preview.appendChild(img);
      status.textContent = "Searching…";
      results.innerHTML = "";

      const form = new FormData();
      form.append("image", file);
      form.append("shop", shop);
      form.append("anonymousId", getAnonymousId());
      form.append("limit", "12");
      form.append("availableOnly", availableOnly.checked ? "true" : "false");
      form.append("sort", "most_relevant");

      try {
        const response = await fetch(`${apiBaseUrl}/image-search/search`, { method: "POST", body: form });
        const body = await readJsonResponse(response);
        if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
        const searchResults = Array.isArray(body.results) ? body.results : [];
        status.textContent = searchResults.length ? "" : "No similar products found.";
        renderProducts(results, searchResults, status, shop, apiBaseUrl, "image_search");
        renderRecent(body.recentUploads || []);
        writeJson(keys.favorites(shop), body.favorites || readJson(keys.favorites(shop), []));
      } catch (error) {
        status.textContent = error && error.message ? error.message : "Something went wrong. Please try again.";
      }
    });
  }

  async function initSimilarProducts(section) {
    const shop = section.dataset.shopDomain;
    const productGid = section.dataset.productGid;
    const apiBaseUrl = section.dataset.apiBaseUrl || "/apps/lens-cart-ai";
    const limit = section.dataset.limit || "8";
    const status = section.querySelector("[data-lenscart-similar-status]");
    const results = section.querySelector("[data-lenscart-similar-results]");
    try {
      const params = new URLSearchParams({ shop, productGid, anonymousId: getAnonymousId(), limit, availableOnly: "true" });
      const response = await fetch(`${apiBaseUrl}/recommendations/similar-products?${params}`);
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body.error || "Similar products unavailable.");
      const similarResults = Array.isArray(body.results) ? body.results : [];
      if (!similarResults.length) {
        section.hidden = true;
        return;
      }
      status.textContent = "";
      renderProducts(results, similarResults, status, shop, apiBaseUrl, "pdp_similar_products");
    } catch (_error) {
      status.textContent = "Similar products unavailable.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lenscart-open]").forEach((button) => initImageSearch(button.closest("[data-shop-domain]")));
    document.querySelectorAll("[data-lenscart-similar]").forEach(initSimilarProducts);
  });
})();
