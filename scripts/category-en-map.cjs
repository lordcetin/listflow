const CATEGORY_EN_BY_SLUG = {
  "tig-isi": "Crochet",
  "punch-needle": "Punch Needle",
  "3d-baski": "3D Printing",
  pod: "POD (Print On Demand)",
  "gumus-taki": "Silver Jewelry",
  "cam-baski": "Glass Printing",
  "metal-kesim": "Metal Cutting",
  "ahsap-kesim": "Wood Cutting",
  aliexpress: "AliExpress Automation",
  "kendi-urunlerin": "Your Products (Telegram)",
};

const PRODUCT_EN_BY_TR = {
  "Anahtarlık": "Keychain",
  Amigurumi: "Amigurumi",
  "Dönence": "Baby Mobile",
  "Kapı Süsü": "Door Ornament",
  "4’lü Bardak Altlığı": "Set of 4 Coasters",
  "4'lü Bardak Altlığı": "Set of 4 Coasters",
  "Punch Tablo": "Punch Wall Art",
  "4’lü Anahtarlık": "Set of 4 Keychains",
  "4'lü Anahtarlık": "Set of 4 Keychains",
  "Figür": "Figurine",
  "3D Tablo": "3D Wall Art",
  "Tişört": "T-Shirt",
  "Canvas Tablo": "Canvas Wall Art",
  "Pin / Rozet": "Pin / Badge",
  "Kolye": "Necklace",
  "Yüzük": "Ring",
  "Bilezik": "Bracelet",
  "Cam Saat": "Glass Clock",
  "Cam Tablo": "Glass Wall Art",
  "Masa Saati": "Desk Clock",
  "Metal Tablo": "Metal Wall Art",
  "Bardak Altlığı": "Coaster",
  "Ahşap Tablo": "Wooden Wall Art",
  "Ürün Listeleme": "Product Listing",
  "Telegram Entegrasyonu": "Telegram Integration",
};

const normalizeText = (value) => {
  return String(value || "")
    .trim()
    .replace(/\u2019/g, "'")
    .replace(/\s+/g, " ");
};

const normalizeSlug = (value) => {
  return String(value || "")
    .toLowerCase()
    .replace(/ç/g, "c")
    .replace(/ğ/g, "g")
    .replace(/ı/g, "i")
    .replace(/ö/g, "o")
    .replace(/ş/g, "s")
    .replace(/ü/g, "u")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
};

const toCategoryEnglish = (slug, titleTr) => {
  const normalizedSlug = normalizeSlug(slug || titleTr);
  if (normalizedSlug && CATEGORY_EN_BY_SLUG[normalizedSlug]) {
    return CATEGORY_EN_BY_SLUG[normalizedSlug];
  }

  return "";
};

const toProductEnglish = (titleTr) => {
  const normalized = normalizeText(titleTr);
  if (!normalized) {
    return "";
  }

  if (PRODUCT_EN_BY_TR[normalized]) {
    return PRODUCT_EN_BY_TR[normalized];
  }

  return "";
};

module.exports = {
  toCategoryEnglish,
  toProductEnglish,
  normalizeText,
};
