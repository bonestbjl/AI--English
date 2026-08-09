const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const source = readFileSync(path.join(root, "src/app.jsx"), "utf8");
const index = readFileSync(path.join(root, "index.html"), "utf8");
const deployIndex = readFileSync(path.join(root, "deploy-cn/index.html"), "utf8");

const moreWordThemes = [
  "zoo",
  "fruitShop",
  "campus",
  "cafe",
  "airport",
  "office",
  "hotel",
  "restaurant",
  "supermarket",
  "metro",
  "clinic",
  "bank",
  "apartment",
];

test("mobile More Words uses one shared inline detail component with stable ids", () => {
  assert.match(source, /function MobileMoreWordInlineDetails\(/);
  assert.match(source, /const \[activeMoreWordId, setActiveMoreWordId\] = useState\(null\)/);
  assert.match(source, /const stableId = `\$\{themeId\}:\$\{item\.id\}`/);
  assert.match(source, /MOBILE_MORE_WORD_MEDIA_QUERY = "\(max-width: 768px\), \(max-width: 950px\) and \(orientation: landscape\) and \(max-height: 520px\)"/);
  assert.match(source, /activeMoreWordId === stableId/);
  assert.match(source, /setActiveMoreWordId\(null\);\s*setSelected\(null\);\s*return;/);
  assert.equal((source.match(/renderMobileMoreWordDetails\(/g) || []).length, moreWordThemes.length + 1);
  for (const themeId of moreWordThemes) {
    assert.match(source, new RegExp("activeMoreWordId === `" + themeId + ":\\$\\{"));
  }
});

test("mobile details scroll locally and reuse existing audio and word book actions", () => {
  assert.match(source, /scrollIntoView\(\{ behavior: "smooth", block: "nearest" \}\)/);
  assert.match(source, /speakEnglish\(item\.word, 0\.9, `\$\{audioKey\}-normal`\)/);
  assert.match(source, /speakEnglish\(item\.word, 0\.65, `\$\{audioKey\}-slow`\)/);
  assert.match(source, /speakEnglish\(item\.example, 0\.86, `\$\{audioKey\}-sentence`\)/);
  assert.match(source, /onClick=\{saved \? onRemove : onSave\}/);
});

test("page and More Words lifecycle changes clear the expanded mobile item", () => {
  for (const stateName of [
    "moreAnimalsPageIndex",
    "moreFruitsPageIndex",
    "moreCampusPageIndex",
    "moreCafePageIndex",
    "moreAirportPageIndex",
    "moreOfficePageIndex",
    "moreHotelPageIndex",
    "moreRestaurantPageIndex",
    "moreSupermarketPageIndex",
    "moreMetroPageIndex",
    "moreClinicPageIndex",
    "moreBankPageIndex",
    "moreApartmentPageIndex",
  ]) {
    assert.match(source, new RegExp("\\b" + stateName + "\\b"));
  }
  assert.match(source, /if \(!anyMoreWordsOpen\) setActiveMoreWordId\(null\)/);
});

test("the 768px rule is mobile-only and keeps desktop detail markup", () => {
  assert.equal(index, deployIndex);
  assert.match(index, /@media \(max-width: 768px\), \(max-width: 950px\) and \(orientation: landscape\) and \(max-height: 520px\)[\s\S]*?\.more-word-grid[\s\S]*?grid-template-columns: minmax\(0, 1fr\) !important/);
  assert.match(index, /\.more-word-desktop-detail,[\s\S]*?display: none !important/);
  assert.match(index, /\.more-word-mobile-detail \{ display: none; \}/);
  assert.equal((source.match(/className="more-word-desktop-detail card-slide-in/g) || []).length, 11);
  assert.equal((source.match(/className="more-word-book-page fixed/g) || []).length, moreWordThemes.length);
  assert.equal((source.match(/className="more-word-grid /g) || []).length, moreWordThemes.length);
});

test("Laundry is not given a fabricated More Words page", () => {
  assert.doesNotMatch(source, /showMoreLaundryBook|selectedMoreLaundryWord|currentMoreLaundryPage/);
});

test("portrait orientation prompt does not cover an open More Words book", () => {
  assert.match(source, /const isMoreWordsBookOpen = \[[\s\S]*?showMoreApartmentBook,[\s\S]*?\]\.some\(Boolean\)/);
  assert.match(source, /shouldShowLandscapePrompt\(viewport\) && !isMoreWordsBookOpen/);
});

test("all More Words books stay above mobile landscape scene panels", () => {
  assert.equal((source.match(/more-word-book-page fixed inset-0 z-50 overflow-auto/g) || []).length, 13);
  assert.match(index, /\.mobile-landscape-mode > \.more-word-book-page \{[\s\S]*?z-index: 70 !important/);
});
