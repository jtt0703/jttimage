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
      status.textContent = "Added to cart. ";
      const cartLink = document.createElement("a");
      cartLink.href = "/cart";
      cartLink.textContent = "View cart";
      status.appendChild(cartLink);
    } catch (_error) {
      button.textContent = "Add to Cart";
      button.disabled = false;
      status.textContent = "Unable to add item to cart. Please try again.";
    }
  }

  function isThemeEditorPreview() {
    return Boolean(window.Shopify && window.Shopify.designMode);
  }

  function openProduct(product, status) {
    if (isThemeEditorPreview()) {
      status.textContent = "Product detail links are disabled inside the theme editor preview.";
      return;
    }
    window.location.assign(`/products/${product.handle}`);
  }

  function renderFavoriteIcon(isFavorited) {
    return `
      <svg class="lenscart-ai-favorite-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path class="lenscart-ai-favorite-heart" d="M20.8 4.9c-2.1-2-5.4-1.7-7.2.5L12 7.2l-1.6-1.8C8.6 3.2 5.3 2.9 3.2 4.9.8 7.2.7 11 3 13.4l9 8.2 9-8.2c2.3-2.4 2.2-6.2-.2-8.5Z"></path>
      </svg>
      <span class="lenscart-ai-sr-only">${isFavorited ? "Remove from favorites" : "Save to favorites"}</span>
    `;
  }

  function renderProducts(container, products, status, shop, apiBaseUrl, sourceSurface, onFindSimilar) {
    const favoritesKey = keys.favorites(shop);
    const favorites = new Set(readJson(favoritesKey, []));
    container.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "lenscart-ai-card";
      card.tabIndex = 0;
      card.addEventListener("click", () => openProduct(product, status));

      const image = document.createElement("img");
      image.src = product.imageUrl || "";
      image.alt = product.title;
      card.appendChild(image);

      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "lenscart-ai-favorite";
      const initialFavorited = favorites.has(product.productGid) || product.isFavorited;
      favorite.setAttribute("aria-pressed", initialFavorited ? "true" : "false");
      favorite.setAttribute("aria-label", initialFavorited ? "Remove from favorites" : "Save to favorites");
      favorite.innerHTML = renderFavoriteIcon(initialFavorited);
      favorite.addEventListener("click", async (event) => {
        event.stopPropagation();
        const isFavorited = favorites.has(product.productGid);
        if (isFavorited) favorites.delete(product.productGid); else favorites.add(product.productGid);
        writeJson(favoritesKey, Array.from(favorites));
        favorite.setAttribute("aria-pressed", isFavorited ? "false" : "true");
        favorite.setAttribute("aria-label", isFavorited ? "Save to favorites" : "Remove from favorites");
        favorite.innerHTML = renderFavoriteIcon(!isFavorited);
        status.textContent = isFavorited
          ? "Removed from favorites."
          : "Saved to favorites. Favorites are marked with a filled heart in Image Search.";
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
      similar.addEventListener("click", (event) => {
        event.stopPropagation();
        if (onFindSimilar) onFindSimilar(product);
      });
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

    function setModalStatus(message, state) {
      status.textContent = message;
      if (state) {
        status.dataset.state = state;
      } else {
        delete status.dataset.state;
      }
    }

    async function searchByFile(file, previewUrl) {
      preview.innerHTML = "";
      const img = document.createElement("img");
      img.src = previewUrl || URL.createObjectURL(file);
      img.alt = "Uploaded image preview";
      preview.appendChild(img);
      setModalStatus("Scanning image and matching products…", "loading");
      results.innerHTML = "";

      const form = new FormData();
      form.append("image", file);
      form.append("shop", shop);
      form.append("anonymousId", getAnonymousId());
      form.append("limit", "9");
      form.append("availableOnly", availableOnly.checked ? "true" : "false");
      form.append("sort", "most_relevant");

      const response = await fetch(`${apiBaseUrl}/image-search/search`, { method: "POST", body: form });
      const body = await readJsonResponse(response);
      if (!response.ok) throw new Error(body.error || "Something went wrong. Please try again.");
      const searchResults = Array.isArray(body.results) ? body.results : [];
      setModalStatus(searchResults.length ? "" : "No similar products found.");
      renderProducts(results, searchResults, status, shop, apiBaseUrl, "image_search", findSimilarProducts);
      renderRecent(body.recentUploads || []);
      writeJson(keys.favorites(shop), body.favorites || readJson(keys.favorites(shop), []));
    }

    async function searchRecentUpload(item) {
      try {
        setModalStatus("Scanning this recent image…", "loading");
        const thumbnailUrl = storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl);
        const response = await fetch(storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl));
        if (!response.ok) throw new Error("Recent upload unavailable.");
        const blob = await response.blob();
        const file = new File([blob], "recent-upload.webp", { type: blob.type || "image/webp" });
        await searchByFile(file, thumbnailUrl);
      } catch (error) {
        setModalStatus(error && error.message ? error.message : "Recent upload unavailable.");
      }
    }

    async function findSimilarProducts(product) {
      try {
        setModalStatus("Finding products with a similar look…", "loading");
        const params = new URLSearchParams({
          shop,
          productGid: product.productGid,
          anonymousId: getAnonymousId(),
          limit: "9",
          availableOnly: availableOnly.checked ? "true" : "false",
        });
        const response = await fetch(`${apiBaseUrl}/recommendations/similar-products?${params}`);
        const body = await readJsonResponse(response);
        if (!response.ok) throw new Error(body.error || "Similar products unavailable.");
        const similarResults = Array.isArray(body.results) ? body.results : [];
        setModalStatus(similarResults.length ? `Showing products similar to ${product.title}.` : "No similar products found.");
        renderProducts(results, similarResults, status, shop, apiBaseUrl, "image_search", findSimilarProducts);
      } catch (_error) {
        setModalStatus("Similar products unavailable.");
      }
    }

    function renderRecent(items) {
      writeJson(keys.recentUploads(shop), items);
      recent.innerHTML = "";
      items.forEach((item) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "lenscart-ai-recent-item";
        button.addEventListener("click", () => searchRecentUpload(item));
        const img = document.createElement("img");
        img.src = storefrontAssetUrl(item.thumbnailUrl, apiBaseUrl);
        img.alt = "Recent upload";
        button.appendChild(img);
        recent.appendChild(button);
      });
    }

    open.addEventListener("click", () => { modal.hidden = false; });
    closes.forEach((button) => button.addEventListener("click", () => { modal.hidden = true; }));
    renderRecent(readJson(keys.recentUploads(shop), []));

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
        setModalStatus("Please upload a JPG, PNG, or WebP image.");
        return;
      }
      if (file.size > 5 * 1024 * 1024) {
        setModalStatus("Image is too large. Please upload a smaller image.");
        return;
      }
      try {
        await searchByFile(file);
      } catch (error) {
        setModalStatus(error && error.message ? error.message : "Something went wrong. Please try again.");
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
    async function findSimilarProducts(product) {
      try {
        status.textContent = "Finding similar products…";
        const params = new URLSearchParams({ shop, productGid: product.productGid, anonymousId: getAnonymousId(), limit, availableOnly: "true" });
        const response = await fetch(`${apiBaseUrl}/recommendations/similar-products?${params}`);
        const body = await readJsonResponse(response);
        if (!response.ok) throw new Error(body.error || "Similar products unavailable.");
        const similarResults = Array.isArray(body.results) ? body.results : [];
        status.textContent = similarResults.length ? "" : "Similar products unavailable.";
        renderProducts(results, similarResults, status, shop, apiBaseUrl, "pdp_similar_products", findSimilarProducts);
      } catch (_error) {
        status.textContent = "Similar products unavailable.";
      }
    }

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
      renderProducts(results, similarResults, status, shop, apiBaseUrl, "pdp_similar_products", findSimilarProducts);
    } catch (_error) {
      status.textContent = "Similar products unavailable.";
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lenscart-open]").forEach((button) => initImageSearch(button.closest("[data-shop-domain]")));
    document.querySelectorAll("[data-lenscart-similar]").forEach(initSimilarProducts);
  });
})();
