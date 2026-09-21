const products = window.PRODUCTS || [];
const state = { query: "", category: "Усі", sort: "featured" };
const money = new Intl.NumberFormat("uk-UA");
const grid = document.getElementById("catalogGrid");
const filters = document.getElementById("categoryFilters");
const count = document.getElementById("resultsCount");
const search = document.getElementById("searchInput");
const clearSearch = document.getElementById("searchClear");
const sortSelect = document.getElementById("sortSelect");
const modal = document.getElementById("productModal");
const productDetail = document.getElementById("productDetail");
const imageLightbox = document.getElementById("imageLightbox");
const lightboxImage = document.getElementById("lightboxImage");
const menuButton = document.querySelector(".menu-button");
const mobileMenu = document.getElementById("mobileMenu");
const cartDrawer = document.getElementById("cartDrawer");
const cartItems = document.getElementById("cartItems");
const cartEmpty = document.getElementById("cartEmpty");
const cartCheckout = document.getElementById("cartCheckout");
const cartCount = document.getElementById("cartCount");
const cartTotal = document.getElementById("cartTotal");
const checkoutForm = document.getElementById("checkoutForm");
const reviewsTrack = document.getElementById("reviewsTrack");
const initialReviews = window.STORE_REVIEWS || [];
const cartToast = document.getElementById("cartToast");
const supportedStatusBadges = new Set(["Хіт", "Новинка", "Акція"]);
let lastFocusedElement = null;
let cart = {};
let toastTimer = null;

try {
  cart = JSON.parse(localStorage.getItem("intim-store-cart") || "{}");
  if (!cart || Array.isArray(cart) || typeof cart !== "object") cart = {};
} catch {
  cart = {};
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[character]);
}

function renderReviews() {
  const reviewCard = (review, duplicate = false) => {
    const rating = Math.max(1, Math.min(5, Number(review.rating) || 5));
    return `<article class="store-review"${duplicate ? ' aria-hidden="true"' : ""}>
      <div class="review-meta"><span class="review-avatar">${escapeHtml(review.name).charAt(0).toUpperCase()}</span><div><strong>${escapeHtml(review.name)}</strong><small>З товарної сторінки</small></div><span class="review-stars" aria-label="Оцінка ${rating} з 5">${"★".repeat(rating)}${"☆".repeat(5 - rating)}</span></div>
      <p>“${escapeHtml(review.text)}”</p>
      ${duplicate ? `<span class="review-product">${escapeHtml(review.product)}</span>` : `<button type="button" class="review-product" data-review-product="${escapeHtml(review.product)}">${escapeHtml(review.product)}</button>`}
    </article>`;
  };
  reviewsTrack.innerHTML = `${initialReviews.map((review) => reviewCard(review)).join("")}${initialReviews.map((review) => reviewCard(review, true)).join("")}`;
}

function productCard(product) {
  const oldPrice = product.oldPrice ? `<del>${money.format(product.oldPrice)} ₴</del>` : "";
  const discount = product.discount ? `<span class="discount-badge">−${product.discount}%</span>` : "";
  const statusBadge = supportedStatusBadges.has(product.badge) ? `<span class="card-badge">${product.badge}</span>` : "";
  return `<article class="product-card">
    <button class="product-image" type="button" data-product="${product.slug}" aria-label="Відкрити ${product.name}">
      <img src="${product.images[0]}" alt="${product.name}" loading="lazy" decoding="async"><span class="card-badges">${statusBadge}${discount}</span>
    </button>
    <div class="product-card-body"><p class="product-category">${product.category}</p><h3>${product.name}</h3><p class="product-short">${product.short}</p>
      <div class="price-row"><span><strong>${money.format(product.price)} ₴</strong>${oldPrice}</span></div>
      <div class="card-actions"><button type="button" data-product="${product.slug}">Докладніше</button><button class="add-cart-button" type="button" data-add-cart="${product.slug}">Додати</button></div>
    </div>
  </article>`;
}

function visibleProducts() {
  const query = state.query.trim().toLocaleLowerCase("uk-UA");
  const visible = products.filter((product) => {
    const categoryMatch = state.category === "Усі" || product.category === state.category;
    const text = `${product.name} ${product.category} ${product.short}`.toLocaleLowerCase("uk-UA");
    return categoryMatch && text.includes(query);
  });

  return visible.sort((a, b) => {
    if (state.sort === "price-asc") return a.price - b.price;
    if (state.sort === "price-desc") return b.price - a.price;
    if (state.sort === "name") return a.name.localeCompare(b.name, "uk");
    return a.id - b.id;
  });
}

function renderCatalog() {
  const visible = visibleProducts();
  grid.innerHTML = visible.length ? visible.map(productCard).join("") : `<div class="empty-state"><strong>Нічого не знайдено</strong><span>Змініть запит або оберіть іншу категорію.</span></div>`;
  count.textContent = `${visible.length} ${visible.length === 1 ? "товар" : "товарів"}`;
}

function renderFilters() {
  const categories = ["Усі", ...new Set(products.map((product) => product.category))];
  filters.innerHTML = categories.map((category) => `<button type="button" data-category="${category}" class="${category === state.category ? "active" : ""}">${category}</button>`).join("");
}

function detailTemplate(product) {
  const images = Array.isArray(product.images) ? product.images : [];
  const media = images.map((image, index) => `<button type="button" class="media-slide zoom-image" data-full-image="${image}" aria-label="Відкрити фото ${index + 1} на весь екран"><img src="${image}" alt="${product.name}, фото ${index + 1}" loading="${index === 0 ? "eager" : "lazy"}" decoding="async"><span class="zoom-hint">Натисніть, щоб збільшити</span></button>`).join("");
  const localVideo = product.video ? `<div class="media-slide media-video"><video controls preload="none" playsinline><source src="${product.video}" type="video/mp4">Ваш браузер не підтримує відео.</video><span class="video-label">Відеоогляд</span></div>` : "";
  const embeddedVideo = product.videoEmbed ? `<div class="media-slide media-video media-video-embed"><div class="embedded-video"><iframe data-video-src="${escapeHtml(product.videoEmbed)}" title="Відеоогляд ${escapeHtml(product.name)}" loading="lazy" allow="autoplay; fullscreen; picture-in-picture" allowfullscreen></iframe><span>Відео завантажиться під час перегляду</span></div><span class="video-label">Відеоогляд</span></div>` : "";
  const hasVideo = Boolean(product.video || product.videoEmbed);
  const mediaCount = images.length + (hasVideo ? 1 : 0);
  const specs = (product.characteristics || product.specs || []).map(([label, value]) => `<div><dt>${label}</dt><dd>${value}</dd></div>`).join("");
  const details = (product.details || []).map((paragraph) => `<p>${paragraph}</p>`).join("");
  const oldPrice = product.oldPrice ? `<del>${money.format(product.oldPrice)} ₴</del>` : "";
  const savings = product.oldPrice ? `<span>Економія ${money.format(product.oldPrice - product.price)} ₴</span>` : "";
  const discount = product.discount ? `<b class="detail-discount">−${product.discount}%</b>` : "";
  const statusBadge = supportedStatusBadges.has(product.badge) ? `<span class="detail-status">${product.badge}</span>` : "";
  return `<div class="product-detail">
    <div class="detail-media"><div class="media-carousel-shell"><div class="media-carousel" aria-label="Фото та відео товару">${media}${localVideo}${embeddedVideo}</div><button class="gallery-arrow gallery-arrow-prev" type="button" data-gallery-direction="-1" aria-label="Попереднє фото"><span>‹</span></button><button class="gallery-arrow gallery-arrow-next" type="button" data-gallery-direction="1" aria-label="Наступне фото"><span>›</span></button><span class="gallery-counter" data-gallery-counter>1 / ${mediaCount}</span></div><div class="media-help"><span>Гортайте фото або натискайте стрілки</span><span>${hasVideo ? "Відео — наприкінці галереї" : `${images.length} фото`}</span></div></div>
    <div class="detail-copy"><div class="detail-labels"><p class="product-category">${product.category}</p>${statusBadge}</div><h2 id="modalTitle">${product.name}</h2><p class="detail-intro">${product.short}</p>
      <div class="detail-price">${discount}<strong>${money.format(product.price)} ₴</strong>${oldPrice}${savings}</div>
      <p class="detail-description">${product.description}</p><ul class="detail-features">${product.features.map((feature) => `<li>${feature}</li>`).join("")}</ul>
      <div class="detail-actions"><button class="button detail-cart-button" type="button" data-add-cart="${product.slug}">Додати в кошик</button><button class="button button-primary detail-buy-button" type="button" data-buy-now="${product.slug}">Купити зараз · ${money.format(product.price)} ₴</button></div>
      <section class="full-description"><h3>Детальніше про товар</h3>${details}</section>
      <section class="characteristics"><h3>Повні характеристики</h3><dl>${specs}</dl></section>
      <div class="detail-trust"><span>Нейтральне пакування</span><span>Оплата при отриманні</span></div>
    </div>
  </div>`;
}

function openProduct(slug, updateHistory = true) {
  const product = products.find((item) => item.slug === slug);
  if (!product) return;
  lastFocusedElement = document.activeElement;
  productDetail.innerHTML = detailTemplate(product);
  const carousel = productDetail.querySelector(".media-carousel");
  const counter = productDetail.querySelector("[data-gallery-counter]");
  let counterFrame = null;
  carousel.addEventListener("scroll", () => {
    if (counterFrame) cancelAnimationFrame(counterFrame);
    counterFrame = requestAnimationFrame(() => {
      const slides = [...carousel.querySelectorAll(".media-slide")];
      const current = slides.reduce((closest, slide, index) => Math.abs(slide.offsetLeft - carousel.scrollLeft) < Math.abs(slides[closest].offsetLeft - carousel.scrollLeft) ? index : closest, 0);
      counter.textContent = `${current + 1} / ${slides.length}`;
      const iframe = slides[current].querySelector("iframe[data-video-src]");
      if (iframe && !iframe.src) iframe.src = iframe.dataset.videoSrc;
    });
  }, { passive: true });
  modal.hidden = false;
  document.body.classList.add("modal-open");
  modal.querySelector(".modal-close").focus();
  if (updateHistory) history.pushState({ product: slug }, "", `?product=${encodeURIComponent(slug)}`);
}

function closeProduct(updateHistory = true) {
  if (modal.hidden) return;
  modal.querySelectorAll("video").forEach((video) => video.pause());
  modal.querySelectorAll("iframe[data-video-src]").forEach((iframe) => iframe.removeAttribute("src"));
  modal.hidden = true;
  document.body.classList.remove("modal-open");
  if (updateHistory) history.pushState({}, "", `${location.pathname}${location.hash || "#catalog"}`);
  if (lastFocusedElement) lastFocusedElement.focus();
}

function openLightbox(src, alt) {
  lightboxImage.src = src;
  lightboxImage.alt = alt || "Фото товару";
  imageLightbox.hidden = false;
  imageLightbox.querySelector(".lightbox-close").focus();
}

function closeLightbox() {
  imageLightbox.hidden = true;
  lightboxImage.src = "";
}

function saveCart() {
  localStorage.setItem("intim-store-cart", JSON.stringify(cart));
}

function cartEntries() {
  return Object.entries(cart).map(([slug, quantity]) => ({ product: products.find((item) => item.slug === slug), quantity })).filter((item) => item.product && item.quantity > 0);
}

function renderCart() {
  const entries = cartEntries();
  const quantity = entries.reduce((sum, item) => sum + item.quantity, 0);
  const total = entries.reduce((sum, item) => sum + item.product.price * item.quantity, 0);
  cartCount.textContent = quantity;
  cartCount.hidden = quantity === 0;
  cartEmpty.hidden = entries.length > 0;
  cartCheckout.hidden = entries.length === 0;
  cartTotal.textContent = `${money.format(total)} ₴`;
  cartItems.innerHTML = entries.map(({ product, quantity: itemQuantity }) => `<article class="cart-item"><img src="${product.images[0]}" alt="${product.name}" loading="lazy" decoding="async"><div><h3>${product.name}</h3><strong>${money.format(product.price)} ₴</strong><div class="quantity-control"><button type="button" data-cart-minus="${product.slug}" aria-label="Зменшити кількість">−</button><span>${itemQuantity}</span><button type="button" data-cart-plus="${product.slug}" aria-label="Збільшити кількість">+</button><button class="remove-item" type="button" data-cart-remove="${product.slug}">Видалити</button></div></div></article>`).join("");
}

function showCartToast(product) {
  clearTimeout(toastTimer);
  cartToast.innerHTML = `<strong>Додано до кошика</strong><span>${escapeHtml(product.name)}</span>`;
  cartToast.hidden = false;
  requestAnimationFrame(() => cartToast.classList.add("visible"));
  toastTimer = setTimeout(() => {
    cartToast.classList.remove("visible");
    setTimeout(() => { cartToast.hidden = true; }, 220);
  }, 2400);
}

function addToCart(slug, openCheckout = false) {
  const product = products.find((item) => item.slug === slug);
  if (!product) return;
  cart[slug] = (cart[slug] || 0) + 1;
  saveCart(); renderCart();
  if (openCheckout) {
    closeProduct();
    openCart(true);
  } else {
    showCartToast(product);
  }
}

function openCart(focusCheckout = false) {
  lastFocusedElement = document.activeElement;
  cartDrawer.hidden = false;
  document.body.classList.add("modal-open");
  if (focusCheckout) {
    requestAnimationFrame(() => {
      checkoutForm.scrollIntoView({ block: "start", behavior: "smooth" });
      checkoutForm.elements.firstName.focus({ preventScroll: true });
    });
  } else {
    cartDrawer.querySelector(".cart-header [data-close-cart]").focus();
  }
}

function closeCart() {
  cartDrawer.hidden = true;
  document.body.classList.remove("modal-open");
  if (lastFocusedElement) lastFocusedElement.focus();
}

search.addEventListener("input", () => { state.query = search.value; clearSearch.hidden = !state.query; renderCatalog(); });
clearSearch.addEventListener("click", () => { search.value = ""; state.query = ""; clearSearch.hidden = true; renderCatalog(); search.focus(); });
document.querySelector(".header-search").addEventListener("submit", (event) => { event.preventDefault(); document.getElementById("catalog").scrollIntoView(); });
filters.addEventListener("click", (event) => { const button = event.target.closest("[data-category]"); if (!button) return; state.category = button.dataset.category; renderFilters(); renderCatalog(); });
sortSelect.addEventListener("change", () => { state.sort = sortSelect.value; renderCatalog(); });

document.addEventListener("click", (event) => {
  const galleryArrow = event.target.closest("[data-gallery-direction]");
  if (galleryArrow) {
    const carousel = galleryArrow.closest(".media-carousel-shell").querySelector(".media-carousel");
    const slides = [...carousel.querySelectorAll(".media-slide")];
    const current = slides.reduce((closest, slide, index) => Math.abs(slide.offsetLeft - carousel.scrollLeft) < Math.abs(slides[closest].offsetLeft - carousel.scrollLeft) ? index : closest, 0);
    const next = (current + Number(galleryArrow.dataset.galleryDirection) + slides.length) % slides.length;
    carousel.scrollTo({ left: slides[next].offsetLeft, behavior: "smooth" });
  }
  const productButton = event.target.closest("[data-product]");
  if (productButton) openProduct(productButton.dataset.product);
  const addButton = event.target.closest("[data-add-cart]");
  if (addButton) addToCart(addButton.dataset.addCart, false);
  const buyButton = event.target.closest("[data-buy-now]");
  if (buyButton) addToCart(buyButton.dataset.buyNow, true);
  if (event.target.closest("[data-close-modal]")) closeProduct();
  if (event.target.closest("[data-close-lightbox]")) closeLightbox();
  if (event.target.closest("[data-close-cart]")) closeCart();

  const minus = event.target.closest("[data-cart-minus]");
  const plus = event.target.closest("[data-cart-plus]");
  const remove = event.target.closest("[data-cart-remove]");
  if (minus) { const slug = minus.dataset.cartMinus; cart[slug] = Math.max(0, (cart[slug] || 0) - 1); if (!cart[slug]) delete cart[slug]; saveCart(); renderCart(); }
  if (plus) { const slug = plus.dataset.cartPlus; cart[slug] = (cart[slug] || 0) + 1; saveCart(); renderCart(); }
  if (remove) { delete cart[remove.dataset.cartRemove]; saveCart(); renderCart(); }

  const zoomImage = event.target.closest("[data-full-image]");
  if (zoomImage) openLightbox(zoomImage.dataset.fullImage, zoomImage.querySelector("img")?.alt);

  const reviewedProduct = event.target.closest("[data-review-product]");
  if (reviewedProduct) {
    const product = products.find((item) => item.name === reviewedProduct.dataset.reviewProduct);
    if (product) openProduct(product.slug);
  }

});

function checkoutError(field) {
  const value = field.value.trim();
  if (!value) return "Заповніть це поле.";
  if (["firstName", "lastName", "city"].includes(field.name) && value.length < 2) return "Введіть щонайменше 2 символи.";
  if (field.name === "phone" && value.replace(/\D/g, "").length < 10) return "Введіть коректний номер телефону.";
  if (field.name === "email" && !field.validity.valid) return "Перевірте адресу електронної пошти.";
  return "";
}

function validateCheckoutField(field) {
  field.setCustomValidity("");
  const message = checkoutError(field);
  field.setCustomValidity(message);
  const label = field.closest("label");
  const error = label?.querySelector(".field-error");
  if (error) error.textContent = message;
  label?.classList.toggle("field-invalid", Boolean(message));
  return !message;
}

checkoutForm.querySelectorAll("input").forEach((field) => {
  field.addEventListener("blur", () => validateCheckoutField(field));
  field.addEventListener("input", () => { if (field.closest("label").classList.contains("field-invalid")) validateCheckoutField(field); });
});

async function saveOrderDraft(orderDraft) {
  // CRM/API integration point: replace this local adapter when a real endpoint is connected.
  localStorage.setItem("intim-store-last-order", JSON.stringify(orderDraft));
  return { delivered: false, storage: "local" };
}

checkoutForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const fields = [...checkoutForm.querySelectorAll("input")];
  const valid = fields.map(validateCheckoutField).every(Boolean);
  if (!valid) {
    fields.find((field) => !field.validity.valid)?.focus();
    document.getElementById("checkoutMessage").textContent = "Перевірте виділені поля.";
    return;
  }
  const orderDraft = Object.fromEntries(new FormData(checkoutForm));
  orderDraft.items = cartEntries().map(({ product, quantity }) => ({ slug: product.slug, name: product.name, price: product.price, quantity }));
  orderDraft.total = orderDraft.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  orderDraft.createdAt = new Date().toISOString();
  await saveOrderDraft(orderDraft);
  document.getElementById("checkoutMessage").textContent = "Чернетку збережено лише у цьому браузері. Замовлення не відправлено: CRM/API ще не підключено.";
});

document.getElementById("cartButton").addEventListener("click", openCart);
document.querySelectorAll("[data-category-jump]").forEach((button) => button.addEventListener("click", () => { state.category = button.dataset.categoryJump; renderFilters(); renderCatalog(); document.getElementById("catalog").scrollIntoView(); }));

menuButton.addEventListener("click", () => {
  const open = menuButton.getAttribute("aria-expanded") === "true";
  menuButton.setAttribute("aria-expanded", String(!open));
  menuButton.setAttribute("aria-label", open ? "Відкрити меню" : "Закрити меню");
  mobileMenu.classList.toggle("open", !open);
  mobileMenu.setAttribute("aria-hidden", String(open));
});
mobileMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", () => { mobileMenu.classList.remove("open"); mobileMenu.setAttribute("aria-hidden", "true"); menuButton.setAttribute("aria-expanded", "false"); }));
document.addEventListener("keydown", (event) => { if (event.key === "Escape") { if (!imageLightbox.hidden) closeLightbox(); else if (!cartDrawer.hidden) closeCart(); else closeProduct(); mobileMenu.classList.remove("open"); menuButton.setAttribute("aria-expanded", "false"); } });
window.addEventListener("popstate", () => { const slug = new URLSearchParams(location.search).get("product"); if (slug) openProduct(slug, false); else closeProduct(false); });

renderFilters();
renderCatalog();
renderCart();
renderReviews();
const initialProduct = new URLSearchParams(location.search).get("product");
if (initialProduct) openProduct(initialProduct, false);
