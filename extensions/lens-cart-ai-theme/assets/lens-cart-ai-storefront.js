(function () {
  const keys = {
    anonymousId: "lensCartAi.v1.anonymousId",
    recentUploads: (shop) => `lensCartAi.v1.recentUploads.${shop}`,
    favorites: (shop) => `lensCartAi.v1.favoriteProducts.${shop}`,
    favoriteProductCards: (shop) => `lensCartAi.v1.favoriteProductCards.${shop}`,
    imageSearchState: (shop) => `lensCartAi.v1.imageSearchState.${shop}`,
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

  function favoriteIdentity(element) {
    const customerGid = element && element.dataset ? element.dataset.customerGid : "";
    if (customerGid) return { identityType: "customer", identityId: customerGid };
    return { identityType: "anonymous", identityId: getAnonymousId() };
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

  function readSessionJson(key, fallback) {
    try {
      return JSON.parse(sessionStorage.getItem(key) || JSON.stringify(fallback));
    } catch (_error) {
      return fallback;
    }
  }

  function normalizeProductForCache(product) {
    return {
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
      similarityScore: product.similarityScore ?? null,
      isFavorited: true,
    };
  }

  function favoriteProductsFromCache(shop) {
    const favorites = readJson(keys.favorites(shop), []);
    const cards = readJson(keys.favoriteProductCards(shop), {});
    return favorites.map((productGid) => cards[productGid]).filter((product) => product && product.handle);
  }

  function cacheFavoriteProduct(shop, product) {
    if (!product || !product.productGid) return;
    const cards = readJson(keys.favoriteProductCards(shop), {});
    cards[product.productGid] = normalizeProductForCache(product);
    writeJson(keys.favoriteProductCards(shop), cards);
  }

  function cacheFavoriteProducts(shop, products) {
    products.forEach((product) => {
      if (product && product.productGid) cacheFavoriteProduct(shop, { ...product, isFavorited: true });
    });
  }

  function removeCachedFavoriteProduct(shop, productGid) {
    if (!productGid) return;
    const cards = readJson(keys.favoriteProductCards(shop), {});
    delete cards[productGid];
    writeJson(keys.favoriteProductCards(shop), cards);
  }

  function saveImageSearchState(shop, state) {
    try {
      sessionStorage.setItem(keys.imageSearchState(shop), JSON.stringify({ ...state, savedAt: Date.now() }));
    } catch (_error) {
      // Session storage can be unavailable in strict privacy contexts.
    }
  }

  function restoreImageSearchState(root) {
    const shop = root.dataset.shopDomain;
    const state = readSessionJson(keys.imageSearchState(shop), null);
    if (!state || !state.modalOpen || !Array.isArray(state.products)) return null;
    if (state.savedAt && Date.now() - state.savedAt > 30 * 60 * 1000) return null;
    return state;
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

  function errorMessageFromResponse(response, body, fallback) {
    if (response.status === 402) return body.error || "Lens Search is not active for this store.";
    return body.error || fallback;
  }

  function responseErrorFromResponse(response, body, fallback) {
    const error = new Error(errorMessageFromResponse(response, body, fallback));
    error.status = response.status;
    return error;
  }

  async function loadWishlistProducts(shop, apiBaseUrl, identity) {
    const cachedProducts = favoriteProductsFromCache(shop);
    try {
      const params = new URLSearchParams({
        shop,
        identityType: identity.identityType,
        identityId: identity.identityId,
      });
      const response = await fetch(`${apiBaseUrl}/favorites?${params}`);
      const body = await readJsonResponse(response);
      if (!response.ok) throw responseErrorFromResponse(response, body, "Wishlist unavailable.");
      const products = Array.isArray(body.products) ? body.products : [];
      const wishlistProducts = products.length ? products : cachedProducts;
      writeJson(keys.favorites(shop), body.favorites && body.favorites.length ? body.favorites : wishlistProducts.map((product) => product.productGid));
      cacheFavoriteProducts(shop, products);
      return { products: wishlistProducts, unavailable: false };
    } catch (error) {
      if (error && error.status === 402) throw error;
      return { products: cachedProducts, unavailable: !cachedProducts.length };
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

  function productUrl(product) {
    const root = (window.Shopify && window.Shopify.routes && window.Shopify.routes.root) || "/";
    return `${root.replace(/\/$/, "")}/products/${product.handle}`;
  }

  function isThemeEditorPreview() {
    return Boolean(window.Shopify && window.Shopify.designMode);
  }

  function navigateToProduct(url) {
    if (isThemeEditorPreview() && window.top && window.top !== window.self) {
      try {
        window.top.location.assign(new URL(url, window.location.href).toString());
        return;
      } catch (_error) {
        window.location.assign(url);
        return;
      }
    }
    window.location.assign(url);
  }

  function openProduct(product, status) {
    if (!product.handle) {
      status.textContent = "Product details are unavailable.";
      return;
    }
    navigateToProduct(productUrl(product));
  }

  function renderFavoriteIcon(isFavorited) {
    return `
      <svg class="lenscart-ai-favorite-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path class="lenscart-ai-favorite-heart" d="M20.8 4.9c-2.1-2-5.4-1.7-7.2.5L12 7.2l-1.6-1.8C8.6 3.2 5.3 2.9 3.2 4.9.8 7.2.7 11 3 13.4l9 8.2 9-8.2c2.3-2.4 2.2-6.2-.2-8.5Z"></path>
      </svg>
      <span class="lenscart-ai-sr-only">${isFavorited ? "Remove from favorites" : "Save to favorites"}</span>
    `;
  }

  function favoriteStatusMessage(status, isFavorited, wishlistUrl) {
    status.textContent = isFavorited ? "Saved to favorites." : "Removed from favorites.";
    if (!isFavorited || !wishlistUrl) return;
    status.appendChild(document.createTextNode(" "));
    const link = document.createElement("a");
    link.href = wishlistUrl;
    link.setAttribute("data-lenscart-wishlist-link", "");
    link.textContent = "View wishlist";
    status.appendChild(link);
  }

  function renderProducts(container, products, status, shop, apiBaseUrl, sourceSurface, onFindSimilar, wishlistUrl, identity, onFavoriteChange) {
    const favoritesKey = keys.favorites(shop);
    const favorites = new Set(readJson(favoritesKey, []));
    const favoriteOwner = identity || { identityType: "anonymous", identityId: getAnonymousId() };
    container.innerHTML = "";
    products.forEach((product) => {
      const card = document.createElement("article");
      card.className = "lenscart-ai-card";
      card.tabIndex = 0;
      card.addEventListener("click", () => openProduct(product, status));

      const imageLink = document.createElement("a");
      imageLink.className = "lenscart-ai-product-image-link";
      imageLink.href = productUrl(product);
      imageLink.setAttribute("aria-label", product.title);
      imageLink.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProduct(product, status);
      });
      const image = document.createElement("img");
      image.src = product.imageUrl || "";
      image.alt = product.title;
      imageLink.appendChild(image);
      card.appendChild(imageLink);

      const favorite = document.createElement("button");
      favorite.type = "button";
      favorite.className = "lenscart-ai-favorite";
      if (product.isFavorited || favorites.has(product.productGid)) {
        favorites.add(product.productGid);
        cacheFavoriteProduct(shop, product);
      }
      const initialFavorited = favorites.has(product.productGid);
      favorite.setAttribute("aria-pressed", initialFavorited ? "true" : "false");
      favorite.setAttribute("aria-label", initialFavorited ? "Remove from favorites" : "Save to favorites");
      favorite.innerHTML = renderFavoriteIcon(initialFavorited);
      favorite.addEventListener("click", async (event) => {
        event.stopPropagation();
        const isFavorited = favorites.has(product.productGid);
        if (isFavorited) favorites.delete(product.productGid); else favorites.add(product.productGid);
        writeJson(favoritesKey, Array.from(favorites));
        if (isFavorited) removeCachedFavoriteProduct(shop, product.productGid); else cacheFavoriteProduct(shop, product);
        favorite.setAttribute("aria-pressed", isFavorited ? "false" : "true");
        favorite.setAttribute("aria-label", isFavorited ? "Save to favorites" : "Remove from favorites");
        favorite.innerHTML = renderFavoriteIcon(!isFavorited);
        favoriteStatusMessage(status, !isFavorited, wishlistUrl);
        const path = isFavorited ? "/favorites/delete" : "/favorites";
        try {
          const response = await fetch(`${apiBaseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              shop,
              identityType: favoriteOwner.identityType,
              identityId: favoriteOwner.identityId,
              shopifyProductGid: product.productGid,
              shopifyVariantGid: product.variantGid,
              sourceSurface,
            }),
          });
          const body = await readJsonResponse(response);
          if (!response.ok) throw responseErrorFromResponse(response, body, "Favorite saved locally. Sync will retry next time.");
          if (onFavoriteChange) onFavoriteChange(product, !isFavorited, card);
        } catch (error) {
          status.textContent = error && error.status === 402 && error.message ? error.message : "Favorite saved locally. Sync will retry next time.";
        }
      });
      card.appendChild(favorite);

      const title = document.createElement("h3");
      const titleLink = document.createElement("a");
      titleLink.className = "lenscart-ai-product-title-link";
      titleLink.href = productUrl(product);
      titleLink.textContent = product.title;
      titleLink.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openProduct(product, status);
      });
      title.appendChild(titleLink);
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
    const wishlistUrl = root.dataset.wishlistUrl || "/apps/lens-cart-ai/wishlist";
    const identity = favoriteIdentity(root);
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

    function currentPreviewImageUrl() {
      const image = preview.querySelector("img");
      return image ? image.src : "";
    }

    function saveCurrentImageSearchState(products) {
      saveImageSearchState(shop, {
        modalOpen: !modal.hidden,
        previewImageUrl: currentPreviewImageUrl(),
        statusText: status.textContent,
        statusState: status.dataset.state || "",
        products,
      });
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
      if (identity.identityType === "customer") form.append("customerGid", identity.identityId);
      form.append("limit", "9");
      form.append("availableOnly", availableOnly.checked ? "true" : "false");
      form.append("sort", "most_relevant");

      const response = await fetch(`${apiBaseUrl}/image-search/search`, { method: "POST", body: form });
      const body = await readJsonResponse(response);
      if (!response.ok) throw responseErrorFromResponse(response, body, "Something went wrong. Please try again.");
      const searchResults = Array.isArray(body.results) ? body.results : [];
      setModalStatus(searchResults.length ? "" : "No similar products found.");
      renderProducts(results, searchResults, status, shop, apiBaseUrl, "image_search", findSimilarProducts, wishlistUrl, identity);
      renderRecent(body.recentUploads || []);
      writeJson(keys.favorites(shop), body.favorites || readJson(keys.favorites(shop), []));
      saveCurrentImageSearchState(searchResults);
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
        if (!response.ok) throw responseErrorFromResponse(response, body, "Similar products unavailable.");
        const similarResults = Array.isArray(body.results) ? body.results : [];
        setModalStatus(similarResults.length ? `Showing products similar to ${product.title}.` : "No similar products found.");
        renderProducts(results, similarResults, status, shop, apiBaseUrl, "image_search", findSimilarProducts, wishlistUrl, identity);
        saveCurrentImageSearchState(similarResults);
      } catch (error) {
        setModalStatus(error && error.message ? error.message : "Similar products unavailable.");
      }
    }

    async function renderWishlistProducts() {
      try {
        modal.hidden = false;
        setModalStatus("Loading saved products…", "loading");
        results.innerHTML = "";
        const { products } = await loadWishlistProducts(shop, apiBaseUrl, identity);
        setModalStatus(products.length ? "Showing saved products." : "No saved products yet.");
        renderProducts(
          results,
          products,
          status,
          shop,
          apiBaseUrl,
          "wishlist",
          null,
          wishlistUrl,
          identity,
          (_product, isFavorited, card) => {
            if (isFavorited) return;
            card.remove();
            if (!results.children.length) setModalStatus("No saved products yet.");
          },
        );
      } catch (error) {
        setModalStatus(error && error.message ? error.message : "Wishlist unavailable.");
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

    root.addEventListener("click", (event) => {
      const target = event.target;
      const wishlistLink = target && target.closest ? target.closest("[data-lenscart-wishlist-link]") : null;
      if (!wishlistLink || !root.contains(wishlistLink)) return;
      event.preventDefault();
      renderWishlistProducts();
    });
    open.addEventListener("click", () => {
      modal.hidden = false;
      const restoredProducts = Array.from(results.children).length ? null : restoreImageSearchState(root);
      if (!restoredProducts) return;
      if (restoredProducts.previewImageUrl) {
        preview.innerHTML = "";
        const img = document.createElement("img");
        img.src = restoredProducts.previewImageUrl;
        img.alt = "Uploaded image preview";
        preview.appendChild(img);
      }
      setModalStatus(restoredProducts.statusText || "", restoredProducts.statusState || undefined);
      renderProducts(results, restoredProducts.products, status, shop, apiBaseUrl, "image_search", findSimilarProducts, wishlistUrl, identity);
    });
    closes.forEach((button) => button.addEventListener("click", () => {
      modal.hidden = true;
      saveImageSearchState(shop, { modalOpen: false, products: [] });
    }));
    renderRecent(readJson(keys.recentUploads(shop), []));
    const restoredState = restoreImageSearchState(root);
    if (restoredState) {
      modal.hidden = false;
      if (restoredState.previewImageUrl) {
        preview.innerHTML = "";
        const img = document.createElement("img");
        img.src = restoredState.previewImageUrl;
        img.alt = "Uploaded image preview";
        preview.appendChild(img);
      }
      setModalStatus(restoredState.statusText || "", restoredState.statusState || undefined);
      renderProducts(results, restoredState.products, status, shop, apiBaseUrl, "image_search", findSimilarProducts, wishlistUrl, identity);
    }

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
    const wishlistUrl = section.dataset.wishlistUrl || "/apps/lens-cart-ai/wishlist";
    const identity = favoriteIdentity(section);
    const limit = section.dataset.limit || "8";
    const status = section.querySelector("[data-lenscart-similar-status]");
    const results = section.querySelector("[data-lenscart-similar-results]");
    async function findSimilarProducts(product) {
      try {
        status.textContent = "Finding similar products…";
        const params = new URLSearchParams({ shop, productGid: product.productGid, anonymousId: getAnonymousId(), limit, availableOnly: "true" });
        const response = await fetch(`${apiBaseUrl}/recommendations/similar-products?${params}`);
        const body = await readJsonResponse(response);
        if (!response.ok) throw responseErrorFromResponse(response, body, "Similar products unavailable.");
        const similarResults = Array.isArray(body.results) ? body.results : [];
        status.textContent = similarResults.length ? "" : "Similar products unavailable.";
        renderProducts(results, similarResults, status, shop, apiBaseUrl, "pdp_similar_products", findSimilarProducts, wishlistUrl, identity);
      } catch (error) {
        status.textContent = error && error.message ? error.message : "Similar products unavailable.";
      }
    }

    try {
      const params = new URLSearchParams({ shop, productGid, anonymousId: getAnonymousId(), limit, availableOnly: "true" });
      const response = await fetch(`${apiBaseUrl}/recommendations/similar-products?${params}`);
      const body = await readJsonResponse(response);
      if (!response.ok) throw responseErrorFromResponse(response, body, "Similar products unavailable.");
      const similarResults = Array.isArray(body.results) ? body.results : [];
      if (!similarResults.length) {
        section.hidden = true;
        return;
      }
      status.textContent = "";
      renderProducts(results, similarResults, status, shop, apiBaseUrl, "pdp_similar_products", findSimilarProducts, wishlistUrl, identity);
    } catch (error) {
      status.textContent = error && error.message ? error.message : "Similar products unavailable.";
    }
  }

  async function initWishlist(section) {
    const shop = section.dataset.shopDomain;
    const apiBaseUrl = section.dataset.apiBaseUrl || "/apps/lens-cart-ai";
    const wishlistUrl = section.dataset.wishlistUrl || "/apps/lens-cart-ai/wishlist";
    const identity = favoriteIdentity(section);
    const status = section.querySelector("[data-lenscart-wishlist-status]");
    const results = section.querySelector("[data-lenscart-wishlist-results]");

    function setWishlistStatus(message, state) {
      status.textContent = message;
      if (state) {
        status.dataset.state = state;
      } else {
        delete status.dataset.state;
      }
    }

    try {
      setWishlistStatus("Loading saved products…", "loading");
      const { products } = await loadWishlistProducts(shop, apiBaseUrl, identity);
      setWishlistStatus(products.length ? "" : "No saved products yet.");
      renderProducts(
        results,
        products,
        status,
        shop,
        apiBaseUrl,
        "wishlist",
        null,
        wishlistUrl,
        identity,
        (_product, isFavorited, card) => {
          if (isFavorited) return;
          card.remove();
          if (!results.children.length) setWishlistStatus("No saved products yet.");
        },
      );
    } catch (error) {
      setWishlistStatus(error && error.message ? error.message : "No saved products yet.");
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-lenscart-open]").forEach((button) => initImageSearch(button.closest("[data-shop-domain]")));
    document.querySelectorAll("[data-lenscart-similar]").forEach(initSimilarProducts);
    document.querySelectorAll("[data-lenscart-wishlist]").forEach(initWishlist);
  });
})();
