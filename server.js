import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";
import { URL } from "node:url";

const PORT = Number(process.env.PORT || 5173);
const ROOT = resolve(".");
const PUBLIC_DIR = join(ROOT, "public");
const DATA_DIR = join(ROOT, "data");
const DB_PATH = join(DATA_DIR, "listings.json");
const SCAN_EVERY_MS = 60 * 60 * 1000;

const DISTRICTS = [
  "Ba Đình",
  "Hoàn Kiếm",
  "Tây Hồ",
  "Long Biên",
  "Cầu Giấy",
  "Đống Đa",
  "Hai Bà Trưng",
  "Hoàng Mai",
  "Thanh Xuân",
  "Nam Từ Liêm",
  "Bắc Từ Liêm",
  "Hà Đông",
  "Sơn Tây",
  "Ba Vì",
  "Chương Mỹ",
  "Đan Phượng",
  "Đông Anh",
  "Gia Lâm",
  "Hoài Đức",
  "Mê Linh",
  "Mỹ Đức",
  "Phú Xuyên",
  "Phúc Thọ",
  "Quốc Oai",
  "Sóc Sơn",
  "Thạch Thất",
  "Thanh Oai",
  "Thanh Trì",
  "Thường Tín",
  "Ứng Hòa"
];

const DISTRICT_VI = new Map(DISTRICTS.map((district) => [district, district]));

const MIME_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"]
]);

const SOURCES = [
  {
    id: "alonhadat-hanoi",
    name: "Alonhadat",
    type: "alonhadat",
    urls: [
      "https://alonhadat.com.vn/can-ban-can-ho-chung-cu/ha-noi",
      "https://alonhadat.com.vn/can-ban-can-ho-chung-cu/ha-noi/trang-2"
    ]
  },
  {
    id: "batdongsan-hanoi",
    name: "Batdongsan.com.vn",
    type: "batdongsan",
    urls: [
      "https://batdongsan.com.vn/ban-can-ho-chung-cu-ha-noi",
      "https://batdongsan.com.vn/ban-can-ho-chung-cu-ha-noi/p2"
    ]
  },
  {
    id: "nhatot-hanoi",
    name: "Nhà Tốt",
    type: "nhatot",
    urls: [
      "https://gateway.chotot.com/v1/public/ad-listing?cg=1010&region_v2=12000&limit=20",
      "https://gateway.chotot.com/v1/public/ad-listing?cg=1020&region_v2=12000&limit=20",
      "https://gateway.chotot.com/v1/public/ad-listing?cg=1040&region_v2=12000&limit=20"
    ]
  }
];

function ensureDatabase() {
  mkdirSync(DATA_DIR, { recursive: true });
  if (!existsSync(DB_PATH)) {
    writeDatabase({ listings: [], runs: [] });
  }
}

function readDatabase() {
  ensureDatabase();
  return JSON.parse(readFileSync(DB_PATH, "utf8"));
}

function writeDatabase(db) {
  writeFileSync(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf8");
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function normalizeText(value) {
  return decodeEntities(String(value || ""))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function foldText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

function isBlockedUrl(url) {
  if (/(^|\/\/)(www\.)?(wikipedia\.org|shopee\.vn|muasamcong\.mpi\.gov\.vn|facebook\.com|youtube\.com)/i.test(url)) {
    return true;
  }
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.replace(/^www\./, "");
    if (["alonhadat.com.vn", "batdongsan.com.vn"].includes(hostname) && parsed.pathname === "/") {
      return true;
    }
    return hostname === "batdongsan.com.vn"
      && parsed.pathname.startsWith("/ban-can-ho-chung-cu")
      && !/-pr\d+$/i.test(parsed.pathname);
  } catch {
    return true;
  }
}

function isRelevantListing(listing) {
  const text = foldText(`${listing.title} ${listing.summary} ${listing.url}`);
  const hasApartment = /(chung cu|can ho|apartment|condo)/i.test(text);
  const hasHouseLand = /(nha dat|nha o|nha rieng|nha pho|dat nen|dat tho cu|biet thu|lien ke|mat pho|mat tien)/i.test(text);
  const hasSaleIntent = /(ban|rao ban|mua ban|chuyen nhuong)/i.test(text);
  const isTrustedRealEstateApi = listing.sourceId === "nhatot-hanoi";
  return !isBlockedUrl(listing.url) && (hasApartment || hasHouseLand) && (hasSaleIntent || isTrustedRealEstateApi);
}

function decodeEntities(value) {
  return value
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 10)));
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return normalizeText(match?.[1] || "");
}

function extractClass(block, className) {
  const match = block.match(new RegExp(`<[^>]+class=['"][^'"]*${className}[^'"]*['"][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"));
  return normalizeText(match?.[1] || "");
}

function extractHeadingText(block) {
  const heading = block.match(/<h[1-6]\b[^>]*>([\s\S]*?)<\/h[1-6]>/i)?.[1] || "";
  return normalizeText(heading);
}

function extractAttribute(block, attrName) {
  const match = block.match(new RegExp(`\\s${attrName}=['"]([^'"]+)['"]`, "i"));
  return normalizeText(match?.[1] || "");
}

function extractImageUrl(block, baseUrl) {
  return extractImageUrls(block, baseUrl)[0] || "";
}

function extractImageUrls(block, baseUrl) {
  const imageBlocks = [...String(block || "").matchAll(/<img\b[^>]*>/gi)].map((match) => match[0]);
  const urls = imageBlocks.map((imageBlock) => {
    const srcSet = extractAttribute(imageBlock, "srcset");
    const srcSetUrl = srcSet.split(",")[0]?.trim().split(/\s+/)[0] || "";
    const lazySrcSet = extractAttribute(imageBlock, "data-srcset");
    const lazySrcSetUrl = lazySrcSet.split(",")[0]?.trim().split(/\s+/)[0] || "";
  const rawUrl = extractAttribute(imageBlock, "data-src")
    || extractAttribute(imageBlock, "data-lazy-src")
      || lazySrcSetUrl
      || srcSetUrl
    || extractAttribute(imageBlock, "src");
    return rawUrl ? improveImageUrl(absolutizeUrl(rawUrl, baseUrl)) : "";
  }).filter(Boolean);

  return [...new Set(urls)];
}

function improveImageUrl(url) {
  if (/alonhadat\.com\.vn\/files\/properties\//i.test(url)) {
    return url.replace("/thumbnails/", "/images/");
  }
  if (/file\d*\.batdongsan\.com\.vn\/crop\/\d+x\d+\//i.test(url)) {
    return url.replace(/\/crop\/\d+x\d+\//i, "/resize/745x510/");
  }
  if (/file\d*\.batdongsan\.com\.vn\/resize\/\d+x\d+\//i.test(url)) {
    return url.replace(/\/resize\/\d+x\d+\//i, "/resize/745x510/");
  }
  return url;
}

function absolutizeUrl(url, baseUrl) {
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function toIsoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function inferDistrict(text) {
  const folded = foldText(text);
  return DISTRICTS.find((district) => folded.includes(foldText(district))) || "Hà Nội";
}

function parseRss(xml, source, district) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return items.map((item) => {
    const title = extractTag(item, "title");
    const url = extractTag(item, "link");
    const summary = extractTag(item, "description");
    const publishedAt = extractTag(item, "pubDate");
    const combined = `${title} ${summary}`;

    return {
      id: createHash("sha1").update(url || `${source.id}:${district}:${title}`).digest("hex"),
      title,
      url,
      summary,
      district,
      price: extractPrice(combined),
      area: extractArea(combined),
      image: "",
      images: [],
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: toIsoDate(publishedAt),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }).filter((listing) => listing.title && listing.url && isRelevantListing(listing));
}

async function parseAlonhadat(html, source) {
  const articles = [...html.matchAll(/<article\b[^>]*class=['"][^'"]*property-item[^'"]*['"][\s\S]*?<\/article>/gi)]
    .map((match) => match[0]);

  const listings = articles.map((article) => {
    const anchor = article.match(/<a\b[^>]*itemprop=['"]url['"][\s\S]*?<\/a>/i)?.[0] || "";
    const href = extractAttribute(anchor, "href");
    const url = href.startsWith("http") ? href : `https://alonhadat.com.vn${href}`;
    const title = extractClass(anchor, "property-title");
    const summary = extractClass(article, "brief");
    const oldAddress = extractClass(article, "old-address");
    const newAddress = extractClass(article, "new-address");
    const address = `${newAddress} ${oldAddress}`;
    const price = extractClass(article, "price").replace(/^Giá:\s*/i, "").trim();
    const rawArea = extractClass(article, "area").replace(/^Diện tích:\s*/i, "").trim();
    const area = /^\d+(?:[.,]\d+)?$/.test(rawArea) ? `${rawArea} m2` : rawArea;
    const postedDate = article.match(/<time\b[^>]*datetime=['"]([^'"]+)['"]/i)?.[1] || "";
    const images = extractImageUrls(article, "https://alonhadat.com.vn");
    const image = images[0] || "";

    return {
      id: createHash("sha1").update(url).digest("hex"),
      title,
      url,
      summary,
      district: inferDistrict(`${title} ${summary} ${address}`),
      price: price || extractPrice(`${title} ${summary}`),
      area: area || extractArea(`${title} ${summary}`),
      image,
      images,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: toIsoDate(postedDate),
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }).filter((listing) => listing.title && listing.url && isRelevantListing(listing));

  return enrichAlonhadatListings(listings);
}

async function enrichAlonhadatListings(listings) {
  const enriched = [];

  for (const listing of listings) {
    try {
      enriched.push(await enrichAlonhadatListing(listing));
    } catch {
      enriched.push(listing);
    }
  }

  return enriched;
}

async function enrichAlonhadatListing(listing) {
  const response = await fetch(listing.url, {
    headers: {
      "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "HanoiApartmentListingMonitor/1.0 (+local dashboard)"
    }
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const html = await response.text();
  const detailTitle = extractHeadingText(html)
    || normalizeText(html.match(/<meta\b[^>]*property=['"]og:title['"][^>]*content=['"]([^'"]+)['"]/i)?.[1] || "");
  const imageSection = html.match(/<section\b[^>]*class=['"][^'"]*images[^'"]*['"][\s\S]*?<\/section>/i)?.[0] || "";
  const detailImages = extractImageUrls(imageSection, "https://alonhadat.com.vn");
  const images = [...new Set([...detailImages, ...(listing.images || []), listing.image].filter(Boolean).map(improveImageUrl))];

  const detailSummary = extractAlonhadatDetailSummary(html) || listing.summary;

  return {
    ...listing,
    title: detailTitle || listing.title,
    summary: detailSummary,
    image: images[0] || listing.image,
    images
  };
}

function extractAlonhadatDetailSummary(html) {
  const detailBlock = html.match(/<section\b[^>]*class=['"][^'"]*property-detail[^'"]*['"][\s\S]*?<\/section>/i)?.[0]
    || html.match(/<div\b[^>]*class=['"][^'"]*detail[^'"]*['"][\s\S]*?<\/div>/i)?.[0]
    || "";
  return normalizeText(detailBlock);
}

function parseBatdongsan(html, source) {
  const listings = [
    ...parseBatdongsanJsonLd(html, source),
    ...parseBatdongsanAnchors(html, source)
  ];
  const byId = new Map();

  for (const listing of listings) {
    if (!listing.title || !listing.url || !isRelevantListing(listing)) continue;
    byId.set(listing.id, listing);
  }

  return [...byId.values()];
}

function parseNhatot(jsonText, source) {
  const payload = JSON.parse(jsonText);
  const ads = Array.isArray(payload.ads) ? payload.ads : [];

  return ads.map((ad) => {
    const title = normalizeText(ad.subject || "");
    const summary = normalizeText(ad.body || title);
    const areaName = normalizeText(`${ad.area_name || ""} ${ad.ward_name_v3 || ad.ward_name || ""} ${ad.region_name_v3 || ad.region_name || ""}`);
    const images = normalizeNhatotImages(ad);
    const url = buildNhatotUrl(ad);
    const combined = `${title} ${summary} ${areaName} ${ad.category_name || ""}`;

    return {
      id: createHash("sha1").update(`nhatot:${ad.list_id || ad.ad_id || url}`).digest("hex"),
      title,
      url,
      summary,
      district: inferDistrict(combined),
      price: normalizeText(ad.price_string || formatNhatotPrice(ad.price)),
      area: ad.size ? `${String(ad.size).replace(".", ",")} m2` : extractArea(combined),
      image: images[0] || "",
      images,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: ad.list_time ? new Date(Number(ad.list_time)).toISOString() : null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }).filter((listing) => listing.title && listing.url && isRelevantListing(listing));
}

function normalizeNhatotImages(ad) {
  const fromImages = Array.isArray(ad.images) ? ad.images : [];
  const fromThumbnails = Array.isArray(ad.image_thumbnails)
    ? ad.image_thumbnails.flatMap((item) => [item.image, item.thumbnail])
    : [];
  const allImages = [
    ...fromImages,
    ...fromThumbnails,
    ad.image,
    ad.thumbnail_image,
    ad.webp_image
  ].filter(Boolean).map((url) => String(url).replace("/preset:listing/", "/preset:view/"));

  return [...new Set(allImages)];
}

function buildNhatotUrl(ad) {
  const listId = ad.list_id || ad.ad_id || "";
  const categorySlug = Number(ad.category) === 1010
    ? "mua-ban-can-ho-chung-cu-ha-noi"
    : Number(ad.category) === 1040
      ? "mua-ban-dat-ha-noi"
      : "mua-ban-nha-dat-ha-noi";
  return listId ? `https://www.nhatot.com/${categorySlug}/${listId}.htm` : "https://www.nhatot.com/";
}

function formatNhatotPrice(value) {
  const price = Number(value || 0);
  if (!price) return "";
  if (price >= 1000000000) return `${(price / 1000000000).toLocaleString("vi-VN", { maximumFractionDigits: 2 })} tỷ`;
  if (price >= 1000000) return `${(price / 1000000).toLocaleString("vi-VN", { maximumFractionDigits: 0 })} triệu`;
  return `${price.toLocaleString("vi-VN")} đ`;
}

function parseBatdongsanJsonLd(html, source) {
  const scriptBlocks = [...html.matchAll(/<script\b[^>]*type=['"]application\/ld\+json['"][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => decodeEntities(match[1]).trim())
    .filter(Boolean);
  const listings = [];

  for (const block of scriptBlocks) {
    try {
      collectBatdongsanItems(JSON.parse(block), listings, source);
    } catch {
      // Ignore unrelated or malformed JSON-LD blocks.
    }
  }

  return listings;
}

function collectBatdongsanItems(value, listings, source) {
  if (!value) return;
  if (Array.isArray(value)) {
    for (const item of value) collectBatdongsanItems(item, listings, source);
    return;
  }
  if (typeof value !== "object") return;

  const candidates = [value, value.item, value.mainEntity].filter(Boolean);
  for (const candidate of candidates) {
    const title = normalizeText(candidate.name || candidate.headline || candidate.title || "");
    const url = absolutizeUrl(candidate.url || candidate["@id"] || "", "https://batdongsan.com.vn");
    const summary = normalizeText(candidate.description || "");
    if (title && url && /batdongsan\.com\.vn/i.test(url)) {
      const combined = `${title} ${summary}`;
      listings.push({
        id: createHash("sha1").update(url).digest("hex"),
        title,
        url,
        summary,
        district: inferDistrict(combined),
        price: extractPrice(combined),
        area: extractArea(combined),
        image: normalizeImages(candidate.image)[0] || "",
        images: normalizeImages(candidate.image),
        sourceId: source.id,
        sourceName: source.name,
        publishedAt: toIsoDate(candidate.datePosted || candidate.datePublished || candidate.dateModified),
        firstSeenAt: new Date().toISOString(),
        lastSeenAt: new Date().toISOString()
      });
    }
  }

  collectBatdongsanItems(value["@graph"], listings, source);
  collectBatdongsanItems(value.itemListElement, listings, source);
}

function normalizeImage(value) {
  return normalizeImages(value)[0] || "";
}

function normalizeImages(value) {
  if (!value) return [];
  const rawValues = Array.isArray(value) ? value : [value];
  const urls = rawValues.flatMap((item) => {
    if (!item) return [];
    if (typeof item === "string") return [absolutizeUrl(item, "https://batdongsan.com.vn")];
    if (typeof item === "object") return normalizeImages(item.url || item.contentUrl);
    return [];
  });
  return [...new Set(urls.filter(Boolean))];
}

function parseBatdongsanAnchors(html, source) {
  const anchors = [...html.matchAll(/<a\b[^>]*href=['"]([^'"]+)['"][^>]*>([\s\S]*?)<\/a>/gi)]
    .map((match) => ({
      href: decodeEntities(match[1]),
      text: normalizeText(match[2]),
      heading: extractHeadingText(match[2]),
      images: extractImageUrls(match[2], "https://batdongsan.com.vn")
    }));

  return anchors.map((anchor) => {
    const url = absolutizeUrl(anchor.href, "https://batdongsan.com.vn");
    const title = cleanScrapedTitle(anchor.heading || anchor.text);
    const summary = extractBatdongsanSummary(anchor.text, title);
    const isListingUrl = /batdongsan\.com\.vn\/ban-can-ho-chung-cu-/i.test(url)
      && /-pr\d+$/i.test(new URL(url).pathname);
    if (!isListingUrl || title.length < 20) return null;

    return {
      id: createHash("sha1").update(url).digest("hex"),
      title,
      url,
      summary,
      district: inferDistrict(title),
      price: extractPrice(anchor.text),
      area: extractArea(anchor.text),
      image: anchor.images[0] || "",
      images: anchor.images,
      sourceId: source.id,
      sourceName: source.name,
      publishedAt: null,
      firstSeenAt: new Date().toISOString(),
      lastSeenAt: new Date().toISOString()
    };
  }).filter(Boolean);
}

function cleanScrapedTitle(value) {
  const raw = normalizeText(value).replace(/^\d+\s+/, "").trim();
  const delimiters = [
    /\s+\d+(?:[.,]\d+)?\s*(?:tỷ|triệu)\b\s*·/i,
    /\s+Giá\s+thỏa\s+thuận\b/i,
    /\s+Q\.\s+/i,
    /\s+H\.\s+/i,
    /\s+Đăng\s+\d+\s+ngày/i,
    /\s+Hiện\s+số/i
  ];
  const indexes = delimiters.map((pattern) => raw.search(pattern)).filter((index) => index > 20);
  const cutIndex = indexes.length ? Math.min(...indexes) : -1;
  return (cutIndex > -1 ? raw.slice(0, cutIndex) : raw).trim();
}

function extractBatdongsanSummary(text, title) {
  const raw = normalizeText(text).replace(/^\d+\s+/, "").trim();
  let summary = raw.startsWith(title) ? raw.slice(title.length).trim() : raw;
  summary = summary
    .replace(/^(?:Giá\s+thỏa\s+thuận|\d+(?:[.,]\d+)?\s*(?:tỷ|triệu))\s*·[\s\S]*?(?:Q\.|H\.)\s+[^)]*\)\s*/i, "")
    .replace(/^(?:Giá\s+thỏa\s+thuận|\d+(?:[.,]\d+)?\s*(?:tỷ|triệu|m²|m2|tr\/m²)|·|\s)+/i, "")
    .replace(/^(?:Q\.|H\.|P\.)\s+[^)]*\)\s*/i, "")
    .replace(/\s*[A-ZÀ-Ỹ]\s+‎?[^·]{0,80}Đăng\s+\d+\s+ngày\s+trước[\s\S]*$/i, "")
    .replace(/\s*Hiện\s+số\s*$/i, "")
    .trim();
  return summary || raw || title;
}

function extractPrice(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(tỷ|ty|triệu|trieu|tr|t)(?=\s|$|[.,;:·)])/i);
  if (!match) return "";
  const unit = match[2].toLowerCase();
  const normalizedUnit = unit === "t" || unit === "ty" ? "tỷ" : unit === "tr" || unit === "trieu" ? "triệu" : unit;
  return `${match[1].replace(".", ",")} ${normalizedUnit}`;
}

function extractArea(text) {
  const match = text.match(/(\d+(?:[.,]\d+)?)\s*(m2|m²|met vuong|mét vuông)(?=\s|$|[.,;:·)])/i);
  return match ? `${match[1].replace(".", ",")} m2` : "";
}

async function scanListings() {
  const startedAt = new Date().toISOString();
  const found = [];
  const errors = [];

  for (const source of SOURCES) {
    const urls = source.urls || DISTRICTS.map((district) => source.buildUrl(district));
    for (const url of urls) {
      try {
        const headers = {
          "accept": source.type === "nhatot" ? "application/json, text/plain, */*" : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "user-agent": "Mozilla/5.0 HanoiApartmentListingMonitor/1.0"
        };
        if (source.type === "nhatot") {
          headers.origin = "https://www.nhatot.com";
          headers.referer = "https://www.nhatot.com/";
        }
        const response = await fetch(url, {
          headers
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const body = await response.text();
        if (/cf_chl_|Enable JavaScript and cookies to continue|Just a moment/i.test(body)) {
          throw new Error("Blocked by Cloudflare challenge");
        }
        if (source.type === "alonhadat") {
          found.push(...await parseAlonhadat(body, source));
        } else if (source.type === "batdongsan") {
          found.push(...parseBatdongsan(body, source));
        } else if (source.type === "nhatot") {
          found.push(...parseNhatot(body, source));
        } else {
          const district = DISTRICTS.find((name) => url.includes(encodeURIComponent(name))) || "Hà Nội";
          found.push(...parseRss(body, source, district));
        }
      } catch (error) {
        errors.push({ sourceId: source.id, url, message: error.message });
      }
    }
  }

  const db = readDatabase();
  const byId = new Map(db.listings.map((listing) => [listing.id, listing]));
  let inserted = 0;
  let updated = 0;

  for (const listing of found) {
    const existing = byId.get(listing.id);
    if (existing) {
      byId.set(listing.id, { ...existing, ...listing, firstSeenAt: existing.firstSeenAt });
      updated += 1;
    } else {
      byId.set(listing.id, listing);
      inserted += 1;
    }
  }

  const listings = [...byId.values()].filter(isRelevantListing).sort((a, b) => {
    return new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime();
  });

  db.listings = listings.slice(0, 2000);
  db.runs = [
    {
      startedAt,
      finishedAt: new Date().toISOString(),
      found: found.length,
      inserted,
      updated,
      errors
    },
    ...db.runs
  ].slice(0, 50);

  writeDatabase(db);
  return db.runs[0];
}

function filterListings(requestUrl) {
  const db = readDatabase();
  const district = requestUrl.searchParams.get("district") || "";
  const query = (requestUrl.searchParams.get("q") || "").toLowerCase();

  let listings = db.listings;
  if (district) listings = listings.filter((listing) => listing.district === district);
  if (query) {
    listings = listings.filter((listing) => {
      return `${listing.title} ${listing.summary} ${listing.price} ${listing.area}`.toLowerCase().includes(query);
    });
  }

  return {
    listings: listings.slice(0, 250),
    total: listings.length,
    districts: DISTRICTS,
    districtLabels: Object.fromEntries(DISTRICT_VI),
    lastRun: db.runs[0] || null
  };
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? join(PUBLIC_DIR, "index.html") : join(PUBLIC_DIR, pathname);
  const resolved = resolve(filePath);
  if (!resolved.startsWith(PUBLIC_DIR) || !existsSync(resolved)) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end("Not found");
    return;
  }

  const type = MIME_TYPES.get(extname(resolved)) || "application/octet-stream";
  res.writeHead(200, { "content-type": type });
  res.end(readFileSync(resolved));
}

createServer(async (req, res) => {
  const requestUrl = new URL(req.url || "/", `http://${req.headers.host}`);

  if (requestUrl.pathname === "/api/listings") {
    sendJson(res, 200, filterListings(requestUrl));
    return;
  }

  if (requestUrl.pathname === "/api/scan" && req.method === "POST") {
    try {
      const run = await scanListings();
      sendJson(res, 200, { ok: true, run });
    } catch (error) {
      sendJson(res, 500, { ok: false, error: error.message });
    }
    return;
  }

  serveStatic(req, res, decodeURIComponent(requestUrl.pathname));
}).listen(PORT, () => {
  ensureDatabase();
  console.log(`Dashboard: http://localhost:${PORT}`);
  scanListings().catch((error) => console.error("Initial scan failed:", error));
  setInterval(() => {
    scanListings().catch((error) => console.error("Scheduled scan failed:", error));
  }, SCAN_EVERY_MS);
});
