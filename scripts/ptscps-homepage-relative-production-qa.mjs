import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const admin = process.env.WP_ORIGIN;
const client = process.env.CLIENT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert.ok(admin && client && user && password, 'Production QA configuration incomplete');
const adminHost = new URL(admin).hostname;
const target = 'FPSO-PTSC-LAM-SON';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const status = { tables: 0, images: 0, adminAbsolute: 0, targetCms: [], targetProduction: 0 };

const getJson = async url => {
  const response = await page.request.get(url, { timeout: 25000 });
  assert.ok(response.ok(), `HTTP ${response.status()} ${new URL(url).pathname}`);
  return response.json();
};

try {
  await page.goto(`${admin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(password);
  await Promise.all([
    page.waitForURL(/\/wp-admin\//, { timeout: 45000 }),
    page.locator('#wp-submit').click(),
  ]);
  console.log('RELATIVE_PRODUCTION_QA_AUTH=PASS');

  const listing = await getJson(`${admin}/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1`);
  assert.ok(Array.isArray(listing), 'Unexpected TablePress list');
  const ids = listing.map(x => String(x?.id || ''))
    .filter(id => /^home_\d{2}(?:_[a-z]{2,})?$/i.test(id));
  assert.ok(ids.length >= 16, 'Homepage table count unexpectedly decreased');
  for (const id of ids) {
    const table = await getJson(`${admin}/wp-json/tablepress/v1/table/${encodeURIComponent(id)}`);
    assert.equal(table.id, id, 'Table ID mismatch');
    assert.ok(Array.isArray(table.items), 'Table data invalid');
    status.tables++;
    for (const [row, item] of table.items.entries()) {
      for (const [field, cell] of Object.entries(item || {})) {
        if (typeof cell !== 'string') continue;
        for (const tag of cell.match(/<img\b[^>]*>/gi) || []) {
          status.images++;
          const src = tag.match(/(?:^|\s)src\s*=\s*["']([^"']+)["']/i)?.[1] || '';
          const alt = tag.match(/(?:^|\s)alt\s*=\s*["']([^"']*)["']/i);
          assert.ok(src && alt, `Invalid native ESC image at ${id}:${row}:${field}`);
          const parsed = new URL(src, admin);
          if (/^(?:https?:)?\/\//i.test(src) && parsed.hostname === adminHost && parsed.pathname.startsWith('/wp-content/')) {
            status.adminAbsolute++;
          }
          if (decodeURIComponent(parsed.pathname).includes(target)) {
            status.targetCms.push({ id, row, field, relative: src.startsWith('/wp-content/') });
          }
        }
      }
    }
  }
  assert.equal(status.adminAbsolute, 0, 'Admin absolute image URL persists in ESC Table');
  assert.equal(status.targetCms.length, 2, 'Expected one Lam Son image per locale in CMS');
  assert.ok(status.targetCms.every(x => x.row === 0 && x.relative && /^(home_04|home_04_en)$/.test(x.id)),
    'Lam Son mapping or URL convention incorrect');
  console.log('RELATIVE_PRODUCTION_QA_CMS=' + JSON.stringify(status));

  const response = await page.goto(client + '/', { waitUntil: 'domcontentloaded', timeout: 50000 });
  assert.ok(response?.ok(), 'Production homepage unavailable');
  await page.waitForTimeout(1300);
  const before = await page.evaluate((needle) => Array.from(document.images).filter(img =>
    [img.currentSrc, img.getAttribute('src'), img.getAttribute('srcset')].filter(Boolean)
      .some(src => String(src).toLowerCase().includes(needle.toLowerCase()))
    || String(img.alt || '').toLowerCase().includes('fpso ptsc lam son')
  ).map(img => ({ src: img.currentSrc || img.getAttribute('src'), alt: img.alt, htmlSrc: img.getAttribute('src') })), target);
  assert.equal(before.length, 1, 'Production homepage does not have exactly one Lam Son image');
  const result = await page.evaluate(async needle => {
    const matches = Array.from(document.images).filter(img =>
      [img.currentSrc, img.getAttribute('src'), img.getAttribute('srcset')].filter(Boolean)
        .some(src => String(src).toLowerCase().includes(needle.toLowerCase()))
      || String(img.alt || '').toLowerCase().includes('fpso ptsc lam son')
    );
    if (matches.length !== 1) return { count: matches.length };
    const el = matches[0];
    el.scrollIntoView({ block: 'center' });
    try { await el.decode(); } catch { /* assert naturalWidth below */ }
    const resolved = new URL(el.currentSrc || el.src, location.href);
    return { count: 1, src: resolved.href, naturalWidth: el.naturalWidth, alt: el.alt,
      heading: el.closest('article')?.querySelector('h2,h3,h4')?.textContent?.trim() || '' };
  }, target);
  status.targetProduction = result.count;
  assert.equal(result.count, 1, 'Lam Son image count changed on production');
  assert.ok(result.naturalWidth > 0, 'Lam Son production image did not load');
  const url = new URL(result.src);
  assert.equal(url.origin, client, 'Lam Son image not served by production origin');
  assert.ok(url.pathname.startsWith('/images/') && url.pathname.toLowerCase().includes(target.toLowerCase()),
    'Lam Son image was not optimized into local production assets');
  console.log('RELATIVE_PRODUCTION_QA_IMAGE=' + JSON.stringify(result));
  console.log('RELATIVE_PRODUCTION_QA=PASS; CMS_SAME_ORIGIN_ABSOLUTE=0; PRODUCTION_IMAGE_LOCAL=YES; TARGET_COUNT=1');
} finally {
  await browser.close();
}
