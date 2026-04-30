const state = {
  allListings: [],
  currentListings: [],
  pagedListings: [],
  provincesLoaded: false,
  sourcesLoaded: false,
  view: "list",
  page: 1,
  pageSize: 20
};

const provinceFilter = document.querySelector("#districtFilter");
const searchInput = document.querySelector("#searchInput");
const priceFilter = document.querySelector("#priceFilter");
const areaFilter = document.querySelector("#areaFilter");
const sourceFilter = document.querySelector("#sourceFilter");
const propertyTypeFilter = document.querySelector("#propertyTypeFilter");
const listingsEl = document.querySelector("#listings");
const paginationEl = document.querySelector("#pagination");
const mapSurface = document.querySelector("#mapSurface");
const resultsLayout = document.querySelector("#resultsLayout");
const statusEl = document.querySelector("#status");
const totalCountEl = document.querySelector("#totalCount");
const scanNowButton = document.querySelector("#scanNow");
const viewButtons = document.querySelectorAll("[data-view]");
const listingModal = document.querySelector("#listingModal");
const modalBody = document.querySelector("#modalBody");
const modalClose = document.querySelector("#modalClose");

function formatDate(value) {
  if (!value) return "chưa rõ";
  return new Intl.DateTimeFormat("vi-VN", {
    dateStyle: "short",
    timeStyle: "short"
  }).format(new Date(value));
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function cleanTitle(listing) {
  const raw = String(listing.title || "").replace(/\s+/g, " ").trim();
  const splitPatterns = [
    /\s+\d+(?:[.,]\d+)?\s*(?:tỷ|triệu)\b\s*·/i,
    /\s+Giá\s+/i,
    /\s+Q\.\s+/i,
    /\s+H\.\s+/i,
    /\s+P\.\s+/i
  ];
  const indexes = splitPatterns
    .map((pattern) => raw.search(pattern))
    .filter((index) => index > 18);
  const cutIndex = indexes.length ? Math.min(...indexes) : -1;
  const title = cutIndex > -1 ? raw.slice(0, cutIndex).trim() : raw;
  return title.length > 120 ? `${title.slice(0, 117).trim()}...` : title;
}

function cleanSummary(listing) {
  const title = String(listing.title || "").trim();
  const summary = String(listing.summary || "").trim();
  if (!summary) return title;
  return summary;
}

function getImages(listing) {
  const images = Array.isArray(listing.images) ? [...listing.images] : [];
  if (listing.image) images.unshift(listing.image);
  return [...new Set(images.filter(Boolean))];
}

function parseNumber(value) {
  const normalized = String(value || "").replace(",", ".").match(/\d+(?:\.\d+)?/);
  return normalized ? Number(normalized[0]) : null;
}

function getPriceInBillions(listing) {
  const price = String(listing.price || listing.title || "").toLowerCase();
  const value = parseNumber(price);
  if (value === null) return null;
  if (price.includes("triệu")) return value / 1000;
  return value;
}

function getArea(listing) {
  return parseNumber(listing.area || listing.title);
}

function matchesRange(value, rangeValue) {
  if (!rangeValue) return true;
  if (value === null) return false;
  const [min, max] = rangeValue.split("-").map(Number);
  return value >= min && value < max;
}

function getPropertyType(listing) {
  const text = `${listing.title || ""} ${listing.summary || ""} ${listing.url || ""}`.toLowerCase();
  if (/(chung cư|chung cu|căn hộ|can ho|apartment|condo)/i.test(text)) return "apartment";
  if (/(nhà đất|nha dat|nhà riêng|nha rieng|nhà phố|nha pho|đất nền|dat nen|biệt thự|biet thu|liền kề|lien ke)/i.test(text)) {
    return "house_land";
  }
  return "";
}

function imageTemplate(listing) {
  const images = getImages(listing);
  if (!images.length) {
    return `
      <div class="listing-gallery placeholder" aria-label="Tin chưa có ảnh">
        <span>Chưa có ảnh</span>
      </div>
    `;
  }

  const slides = images.map((image, index) => `
    <button class="gallery-slide${index === 0 ? " active" : ""}" type="button" data-open-listing="${escapeHtml(listing.id)}" data-slide="${index}">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" loading="lazy" referrerpolicy="no-referrer">
    </button>
  `).join("");
  const controls = images.length > 1 ? `
    <button class="gallery-nav prev" type="button" data-gallery-action="prev" aria-label="Ảnh trước">‹</button>
    <button class="gallery-nav next" type="button" data-gallery-action="next" aria-label="Ảnh sau">›</button>
    <span class="gallery-count"><span data-gallery-current>1</span>/${images.length}</span>
  ` : "";

  return `
    <div class="listing-gallery" data-gallery data-gallery-index="0" data-gallery-total="${images.length}">
      ${slides}
      ${controls}
    </div>
  `;
}

function listingTemplate(listing) {
  const price = listing.price || "Chưa tách được giá";
  const area = listing.area || "Chưa tách được diện tích";
  const district = listing.district || "";
  const displayTitle = cleanTitle(listing);
  const displaySummary = cleanSummary(listing);

  return `
    <article class="listing" data-open-listing="${escapeHtml(listing.id)}">
      ${imageTemplate(listing)}
      <div class="listing-main">
        <div class="listing-meta">
          <span>${escapeHtml(district)}</span>
          <span>${escapeHtml(listing.sourceName)}</span>
          <span>Cập nhật ${formatDate(listing.lastSeenAt)}</span>
        </div>
        <button class="listing-title" type="button" data-open-listing="${escapeHtml(listing.id)}">${escapeHtml(displayTitle)}</button>
        <p>${escapeHtml(displaySummary)}</p>
      </div>
      <dl class="facts">
        <div>
          <dt>Giá</dt>
          <dd>${escapeHtml(price)}</dd>
        </div>
        <div>
          <dt>Diện tích</dt>
          <dd>${escapeHtml(area)}</dd>
        </div>
      </dl>
    </article>
  `;
}

function modalGalleryTemplate(listing) {
  const images = getImages(listing);
  if (!images.length) {
    return `<div class="modal-hero placeholder"><span>Chưa có ảnh</span></div>`;
  }

  const thumbs = images.map((image, index) => `
    <button class="modal-thumb${index === 0 ? " active" : ""}" type="button" data-modal-image="${escapeHtml(image)}" aria-label="Xem ảnh ${index + 1}">
      <img src="${escapeHtml(image)}" alt="${escapeHtml(listing.title)}" loading="lazy" referrerpolicy="no-referrer">
    </button>
  `).join("");

  return `
    <div class="modal-gallery">
      <img class="modal-hero" id="modalHeroImage" src="${escapeHtml(images[0])}" alt="${escapeHtml(listing.title)}" referrerpolicy="no-referrer">
      <div class="modal-thumbs">${thumbs}</div>
    </div>
  `;
}

function buildFullDescription(listing) {
  return cleanSummary(listing) || "Chưa có mô tả chi tiết.";
}

function openListingModal(listingId) {
  const listing = state.currentListings.find((item) => item.id === listingId)
    || state.allListings.find((item) => item.id === listingId);
  if (!listing) return;

  const price = listing.price || "Chưa tách được giá";
  const area = listing.area || "Chưa tách được diện tích";
  const district = listing.district || "";
  const displayTitle = cleanTitle(listing);
  const description = buildFullDescription(listing);
  const isLongDescription = description.length > 520;

  modalBody.innerHTML = `
    ${modalGalleryTemplate(listing)}
    <div class="modal-content">
      <div class="modal-heading">
        <div class="listing-meta">
          <span>${escapeHtml(district)}</span>
          <span>${escapeHtml(listing.sourceName)}</span>
          <span>Cập nhật ${formatDate(listing.lastSeenAt)}</span>
        </div>
        <h2 id="modalTitle">${escapeHtml(displayTitle)}</h2>
      </div>
      <dl class="modal-facts">
        <div><dt>Giá</dt><dd>${escapeHtml(price)}</dd></div>
        <div><dt>Diện tích</dt><dd>${escapeHtml(area)}</dd></div>
        <div><dt>Khu vực</dt><dd>${escapeHtml(district)}</dd></div>
        <div><dt>Nguồn</dt><dd>${escapeHtml(listing.sourceName)}</dd></div>
      </dl>
      <section class="modal-detail-section">
        <h3>Thông tin chi tiết</h3>
        <div class="modal-description${isLongDescription ? " collapsed" : ""}" id="modalDescription">
          ${escapeHtml(description).replace(/\n/g, "<br>")}
        </div>
        ${isLongDescription ? `<button class="read-more-button" type="button" id="readMoreButton">Xem thêm</button>` : ""}
      </section>
      <a class="source-link" href="${escapeHtml(listing.url)}" target="_blank" rel="noopener noreferrer">Mở trang nguồn</a>
    </div>
  `;
  listingModal.classList.add("open");
  listingModal.setAttribute("aria-hidden", "false");
  document.body.classList.add("modal-open");
}

function closeListingModal() {
  listingModal.classList.remove("open");
  listingModal.setAttribute("aria-hidden", "true");
  document.body.classList.remove("modal-open");
}

function showGallerySlide(gallery, nextIndex) {
  const total = Number(gallery.dataset.galleryTotal || 0);
  if (total <= 1) return;

  const index = (nextIndex + total) % total;
  gallery.dataset.galleryIndex = String(index);
  for (const slide of gallery.querySelectorAll(".gallery-slide")) {
    slide.classList.toggle("active", Number(slide.dataset.slide) === index);
  }

  const current = gallery.querySelector("[data-gallery-current]");
  if (current) current.textContent = String(index + 1);
}

function populateSources(listings) {
  if (state.sourcesLoaded) return;
  const sources = [...new Set(listings.map((listing) => listing.sourceName).filter(Boolean))].sort();
  for (const source of sources) {
    const option = document.createElement("option");
    option.value = source;
    option.textContent = source;
    sourceFilter.append(option);
  }
  state.sourcesLoaded = true;
}

function applySecondaryFilters() {
  const source = sourceFilter.value;
  const priceRange = priceFilter.value;
  const areaRange = areaFilter.value;
  const propertyType = propertyTypeFilter.value;

  state.currentListings = state.allListings.filter((listing) => {
    if (source && listing.sourceName !== source) return false;
    if (propertyType && getPropertyType(listing) !== propertyType) return false;
    if (!matchesRange(getPriceInBillions(listing), priceRange)) return false;
    if (!matchesRange(getArea(listing), areaRange)) return false;
    return true;
  });

  state.page = 1;
  renderResults();
}

function renderResults() {
  const totalPages = Math.max(1, Math.ceil(state.currentListings.length / state.pageSize));
  state.page = Math.min(Math.max(1, state.page), totalPages);
  const start = (state.page - 1) * state.pageSize;
  state.pagedListings = state.currentListings.slice(start, start + state.pageSize);

  totalCountEl.textContent = state.currentListings.length.toLocaleString("vi-VN");
  listingsEl.innerHTML = state.pagedListings.length
    ? state.pagedListings.map(listingTemplate).join("")
    : `<div class="empty">Chưa có tin phù hợp với bộ lọc hiện tại.</div>`;
  renderPagination(totalPages);
  renderMap();
}

function renderPagination(totalPages) {
  if (state.currentListings.length <= state.pageSize) {
    paginationEl.innerHTML = "";
    return;
  }

  const pages = [];
  const from = Math.max(1, state.page - 2);
  const to = Math.min(totalPages, state.page + 2);
  for (let page = from; page <= to; page += 1) {
    pages.push(`
      <button class="page-button${page === state.page ? " active" : ""}" type="button" data-page="${page}">
        ${page}
      </button>
    `);
  }

  paginationEl.innerHTML = `
    <button class="page-button" type="button" data-page="${state.page - 1}" ${state.page === 1 ? "disabled" : ""}>Trước</button>
    ${from > 1 ? `<button class="page-button" type="button" data-page="1">1</button><span>...</span>` : ""}
    ${pages.join("")}
    ${to < totalPages ? `<span>...</span><button class="page-button" type="button" data-page="${totalPages}">${totalPages}</button>` : ""}
    <button class="page-button" type="button" data-page="${state.page + 1}" ${state.page === totalPages ? "disabled" : ""}>Sau</button>
  `;
}

function renderMap() {
  const groups = new Map();
  for (const listing of state.currentListings) {
    const province = listing.district || "Khác";
    const items = groups.get(province) || [];
    items.push(listing);
    groups.set(province, items);
  }

  const sorted = [...groups.entries()].sort((a, b) => b[1].length - a[1].length);
  const cards = sorted.map(([province, listings]) => `
    <button class="map-region-card" type="button" data-map-district="${escapeHtml(province)}">
      <strong>${escapeHtml(province)}</strong>
      <span>${listings.length} tin</span>
    </button>
  `).join("");

  const summary = state.currentListings.length
    ? `${state.currentListings.length.toLocaleString("vi-VN")} tin theo khu vực`
    : "Không có tin phù hợp";

  mapSurface.innerHTML = `
    <div class="map-title">
      <strong>Phân bố theo tỉnh/thành</strong>
      <span>${summary}</span>
    </div>
    <div class="map-region-grid">${cards}</div>
  `;
}

function setView(view) {
  state.view = view;
  resultsLayout.classList.toggle("map-mode", view === "map");
  for (const button of viewButtons) {
    button.classList.toggle("active", button.dataset.view === view);
  }
}

async function loadListings() {
  const params = new URLSearchParams();
  if (provinceFilter.value) params.set("province", provinceFilter.value);
  if (searchInput.value.trim()) params.set("q", searchInput.value.trim());

  const response = await fetch(`/api/listings?${params.toString()}`);
  const data = await response.json();

  if (!state.provincesLoaded && data.provinces) {
    for (const province of data.provinces) {
      const option = document.createElement("option");
      option.value = province;
      option.textContent = province;
      provinceFilter.append(option);
    }
    state.provincesLoaded = true;
  }

  state.allListings = data.listings || [];
  populateSources(state.allListings);
  statusEl.textContent = data.lastRun
    ? `Lần quét gần nhất: ${formatDate(data.lastRun.finishedAt)}. Tìm thấy ${data.lastRun.found} kết quả, thêm mới ${data.lastRun.inserted}.`
    : "Chưa có lần quét nào.";
  applySecondaryFilters();
}

async function scanNow() {
  scanNowButton.disabled = true;
  scanNowButton.textContent = "Đang quét...";
  statusEl.textContent = "Đang quét nguồn dữ liệu...";
  try {
    const response = await fetch("/api/scan", { method: "POST" });
    if (!response.ok) throw new Error("Scan failed");
    await loadListings();
  } catch (error) {
    statusEl.textContent = "Không quét được lúc này. Kiểm tra kết nối mạng hoặc log container.";
  } finally {
    scanNowButton.disabled = false;
    scanNowButton.textContent = "Quét ngay";
  }
}

provinceFilter.addEventListener("change", loadListings);
searchInput.addEventListener("input", () => {
  clearTimeout(searchInput.searchTimer);
  searchInput.searchTimer = setTimeout(loadListings, 250);
});
priceFilter.addEventListener("change", applySecondaryFilters);
areaFilter.addEventListener("change", applySecondaryFilters);
sourceFilter.addEventListener("change", applySecondaryFilters);
propertyTypeFilter.addEventListener("change", applySecondaryFilters);
scanNowButton.addEventListener("click", scanNow);
for (const button of viewButtons) {
  button.addEventListener("click", () => setView(button.dataset.view));
}
listingsEl.addEventListener("click", (event) => {
  const nav = event.target.closest("[data-gallery-action]");
  if (nav) {
    event.stopPropagation();
    const gallery = nav.closest("[data-gallery]");
    const currentIndex = Number(gallery.dataset.galleryIndex || 0);
    const direction = nav.dataset.galleryAction === "next" ? 1 : -1;
    showGallerySlide(gallery, currentIndex + direction);
    return;
  }

  const opener = event.target.closest("[data-open-listing]");
  if (opener) openListingModal(opener.dataset.openListing);
});
paginationEl.addEventListener("click", (event) => {
  const button = event.target.closest("[data-page]");
  if (!button || button.disabled) return;
  state.page = Number(button.dataset.page);
  renderResults();
  window.scrollTo({ top: 0, behavior: "smooth" });
});
mapSurface.addEventListener("click", (event) => {
  const pin = event.target.closest("[data-map-district]");
  if (!pin) return;

  provinceFilter.value = pin.dataset.mapDistrict;
  loadListings();
});
modalClose.addEventListener("click", closeListingModal);
listingModal.addEventListener("click", (event) => {
  const readMore = event.target.closest("#readMoreButton");
  if (readMore) {
    const description = document.querySelector("#modalDescription");
    description?.classList.remove("collapsed");
    readMore.remove();
    return;
  }

  const thumb = event.target.closest("[data-modal-image]");
  if (thumb) {
    const hero = document.querySelector("#modalHeroImage");
    if (hero) hero.src = thumb.dataset.modalImage;
    for (const item of listingModal.querySelectorAll(".modal-thumb")) {
      item.classList.toggle("active", item === thumb);
    }
    return;
  }

  if (event.target === listingModal) closeListingModal();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeListingModal();
});

loadListings();
setInterval(loadListings, 60_000);
