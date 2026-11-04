import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
assert(front && wp, 'FRONT_ORIGIN/WP_ORIGIN missing');
const frontUrl = new URL(front);
const wpUrl = new URL(wp);
assert(frontUrl.protocol === 'https:' && wpUrl.protocol === 'https:', 'HTTPS origins required');
assert(frontUrl.origin !== wpUrl.origin, 'Frontend and WordPress origins must differ');

const services = [
  { title: 'Vận hành và bảo dưỡng FPSO/FSO/MOPU', slug: 'van-hanh-va-bao-duong-fpso-fso-mopu' },
  { title: 'Dịch vụ thiết kế, mua sắm, gia công, chế tạo', slug: 'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao' },
  { title: 'Cung ứng nhân lực kỹ thuật vận hành và bảo dưỡng', slug: 'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong' },
  { title: 'Dịch vụ sửa chữa bảo dưỡng các thiết bị và công trình công nghiệp', slug: 'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep' },
];
const expectedTitles = services.map((item) => item.title);
const artifactDir = 'artifacts/ptscps-services-readonly-qa';
await mkdir(artifactDir, { recursive: true });
const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
const noAdminOrigin = (html, label) => {
  assert(!html.includes(wpUrl.origin), `${label} WordPress admin origin leaked`);
  assert(!html.includes(wpUrl.hostname), `${label} WordPress admin hostname leaked`);
};

const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 1000 },
    { name: 'mobile', width: 390, height: 844 },
  ]) {
    const context = await browser.newContext({ viewport: { width: viewport.width, height: viewport.height } });
    const page = await context.newPage();
    const response = await page.goto(`${front}/dich-vu?_readonly_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `${viewport.name} /dich-vu HTTP ${response?.status()}`);
    assert(new URL(page.url()).origin === frontUrl.origin, `${viewport.name} redirected outside frontend origin`);

    const cards = page.locator('[data-services-category-grid] a');
    assert.equal(await cards.count(), 4, `${viewport.name} service card count mismatch`);
    const names = (await cards.locator('h2').allTextContents()).map(clean);
    assert.deepEqual(names, expectedTitles, `${viewport.name} category order mismatch`);

    const hrefs = await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('href') || ''));
    assert.deepEqual(hrefs, services.map((item) => `/dich-vu/${item.slug}`), `${viewport.name} category href mismatch`);
    assert((await cards.evaluateAll((nodes) => nodes.map((node) => node.getAttribute('target') || ''))).every((target) => target !== '_blank'), `${viewport.name} category link opens new tab`);

    const images = cards.locator('img');
    assert.equal(await images.count(), 4, `${viewport.name} service image count mismatch`);
    for (let i = 0; i < 4; i += 1) {
      await images.nth(i).scrollIntoViewIfNeeded();
      await page.waitForFunction((index) => {
        const image = document.querySelectorAll('[data-services-category-grid] img')[index];
        return image && image.complete && image.naturalWidth > 0;
      }, i, { timeout: 12000 });
    }
    const srcs = await images.evaluateAll((nodes) => nodes.map((img) => img.getAttribute('src') || ''));
    assert(srcs.every((src) => src.startsWith('/wp-content/uploads/')), `${viewport.name} category images are not relative WordPress uploads`);

    noAdminOrigin(await page.content(), viewport.name);
    const overflow = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    assert(overflow.scroll <= overflow.client + 2, `${viewport.name} horizontal overflow`);
    await page.screenshot({ path: `${artifactDir}/${viewport.name}-dich-vu.png`, fullPage: true });
    console.log(`SERVICES_READONLY_QA_ROUTE=${viewport.name}:PASS`);
    await context.close();
  }

  const requestContext = await browser.newContext();
  try {
    for (const service of services) {
      const response = await requestContext.request.get(`${front}/dich-vu/${service.slug}?_readonly_qa=${Date.now()}`, {
        timeout: 30000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      assert.equal(response.status(), 200, `Category route HTTP ${response.status()} ${service.slug}`);
      const html = await response.text();
      assert(html.includes(service.title), `Category route heading missing ${service.slug}`);
      noAdminOrigin(html, service.slug);
      console.log(`SERVICES_READONLY_QA_CATEGORY=${service.slug}:PASS`);
    }
  } finally {
    await requestContext.close();
  }

  const desktop = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  try {
    const page = await desktop.newPage();
    await page.goto(`${front}/dich-vu?_menu_readonly_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    const serviceButton = page.locator('#header-navrow button').filter({ hasText: 'Dịch vụ' }).first();
    assert(await serviceButton.isVisible(), 'Desktop Dịch vụ menu button missing');
    await serviceButton.click();

    const expectedMenu = [
      { title: 'Tất cả', href: '/dich-vu' },
      ...services.map((service) => ({ title: service.title, href: `/dich-vu/${service.slug}` })),
    ];
    for (const item of expectedMenu) {
      const link = page.locator('#header-navrow a').filter({ hasText: item.title }).first();
      assert(await link.isVisible(), `Desktop service submenu missing ${item.title}`);
      assert.equal(await link.getAttribute('href'), item.href, `Desktop service submenu href mismatch ${item.title}`);
      assert.notEqual(await link.getAttribute('target'), '_blank', `Desktop service submenu opens new tab ${item.title}`);
    }

    const allLink = page.locator('#header-navrow a').filter({ hasText: 'Tất cả' }).first();
    await Promise.all([
      page.waitForURL((url) => url.origin === frontUrl.origin && url.pathname === '/dich-vu', { timeout: 30000 }),
      allLink.click(),
    ]);
    assert(new URL(page.url()).pathname === '/dich-vu', 'Tất cả did not navigate to /dich-vu in the current tab');
    noAdminOrigin(await page.content(), 'desktop-menu-navigation');
    console.log('SERVICES_READONLY_QA_MENU=PASS');
  } finally {
    await desktop.close();
  }

  console.log('SERVICES_READONLY_QA=PASS categories=4 desktop=PASS mobile=PASS menu=PASS admin_origin=HIDDEN');
} finally {
  await browser.close();
}
