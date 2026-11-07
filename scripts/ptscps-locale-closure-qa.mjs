import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chromium } from 'playwright';

const raw = process.env.ENV_FILE || '';
const env = Object.fromEntries([...raw.matchAll(/^\s*(?:export\s+)?(WC_URL|WC_URL_CLIENT)\s*=\s*(.*)$/gm)]
  .map(m => [m[1], m[2].trim().replace(/^['"]|['"]$/g, '')]));
const parseOrigin = value => {
  const url = new URL(value);
  assert(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    (url.pathname === '' || url.pathname === '/') && (!url.port || url.port === '443'), 'Invalid site origin');
  return url.origin;
};
const front = parseOrigin(env.WC_URL_CLIENT);
assert(front !== parseOrigin(env.WC_URL), 'Frontend and WordPress origins must differ');
const artifactDir = 'artifacts/ptscps-locale-closure';
fs.mkdirSync(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
const log = (key, value) => console.log(`LOCALE_CLOSURE_${key}=${JSON.stringify(value)}`);

const scenarios = [
  { path: '/tin-tuc', lang: 'vi', h1: 'Tin tức' },
  { path: '/tin-tuc?lang=en', lang: 'en', h1: 'News', shared: true },
  { path: '/c/tin-tuc/hoat-dong-cua-cong-ty', lang: 'vi', h1: 'Hoạt động của công ty' },
  { path: '/c/tin-tuc/hoat-dong-cua-cong-ty?lang=en', lang: 'en', h1: 'Company Activities', shared: true },
  { path: '/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc?lang=en', lang: 'en', h1: 'Domestic and Regional', shared: true },
  { path: '/thu-moi-chao-gia?lang=en', lang: 'en', h1: 'Invitation for Quotation', shared: true },
  { path: '/tuyen-dung', lang: 'vi', h1: 'Thông tin tuyển dụng' },
  { path: '/search-jobs', lang: 'en', h1: 'Search Jobs', recruitment: true },
];

try {
  for (const test of scenarios) {
    const target = new URL(test.path, front);
    target.searchParams.set('_qa_locale_closure', String(Date.now()));
    const response = await page.goto(target.href, { waitUntil: 'domcontentloaded', timeout: 50000 });
    assert.equal(response?.status(), 200, `${test.path}: HTTP ${response?.status()}`);
    assert.equal(documentLang(await page.locator('html').getAttribute('lang')), test.lang, `${test.path}: html lang`);
    const h1 = String(await page.locator('main h1').first().textContent() || '').trim().replace(/\s+/g, ' ');
    assert.equal(h1, test.h1, `${test.path}: H1 mismatch`);

    const mainText = String(await page.locator('main').innerText() || '');
    if (test.lang === 'en') {
      for (const forbidden of ['HOẠT ĐỘNG CỦA CÔNG TY', 'DẦU KHÍ TRONG NƯỚC VÀ KHU VỰC', 'Thư mời chào giá']) {
        assert(!mainText.includes(forbidden), `${test.path}: LOCALE_MIXED_CONTENT main=${forbidden}`);
      }
      assert(!/Trang\s+\d+\s*\/\s*\d+\s*\(Tổng\s+\d+\s+bài viết\)/i.test(mainText), `${test.path}: Vietnamese pagination leaked`);
      const viAria = await page.locator('[aria-label^="Mở "], [aria-label^="Đóng "], [aria-label^="Gọi "], [aria-label="Điều hướng chính"], [aria-label="Điều hướng di động"], [aria-label="Về trang chủ"]').count();
      assert.equal(viAria, 0, `${test.path}: Vietnamese Header/Menu ARIA leaked count=${viAria}`);
      const footerText = String(await page.locator('#footer-contact').innerText().catch(() => '') || '');
      assert(!footerText.includes('Tầng 16, Khách sạn Dầu khí'), `${test.path}: Vietnamese footer address leaked`);
      assert(!footerText.includes('VP HN:'), `${test.path}: Vietnamese footer office label leaked`);
      assert.equal(await page.locator('#footer-contact [aria-label="Xem thông tin xác nhận Bộ Công Thương"]').count(), 0,
        `${test.path}: Vietnamese footer ARIA leaked`);
    }

    if (test.shared) {
      const canonical = await page.locator('link[rel="canonical"]').getAttribute('href');
      assert(canonical, `${test.path}: canonical missing`);
      const canonicalUrl = new URL(canonical);
      assert.equal(canonicalUrl.pathname, new URL(test.path, front).pathname, `${test.path}: canonical identity mismatch`);
      assert.equal(canonicalUrl.searchParams.get('lang'), 'en', `${test.path}: EN canonical lost lang`);
      const links = await page.locator('[data-header-language] a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
      const pathname = new URL(test.path, front).pathname;
      assert(links.some(href => href === pathname), `${test.path}: VI switch must preserve identity without lang; actual=${links}`);
      assert(links.some(href => href === `${pathname}?lang=en`), `${test.path}: EN switch must preserve identity with lang; actual=${links}`);
    }
    if (test.recruitment) {
      const links = await page.locator('[data-header-language] a[href]').evaluateAll(nodes => nodes.map(n => n.getAttribute('href')));
      assert(links.includes('/tuyen-dung'), `${test.path}: VI recruitment switch missing`);
      assert(links.includes('/search-jobs'), `${test.path}: EN recruitment switch missing`);
    }
    if (test.lang === 'en') {
      await page.screenshot({ path: `${artifactDir}/${safeName(test.path)}.png`, fullPage: true, timeout: 20000 });
    }
    log('PASS', { path: test.path, lang: test.lang, h1 });
  }
  log('RESULT', 'PASS');
} finally {
  await context.close();
  await browser.close();
}

function safeName(value) {
  return value.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
}
function documentLang(value) {
  return String(value || '').trim().toLowerCase().split('-')[0];
}
