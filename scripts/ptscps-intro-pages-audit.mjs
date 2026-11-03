import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert.ok(wp && front && username && password, 'Configured origins/admin audit inputs missing');

const wantedSlugs = new Set([
  'thu-ngo',
  'gioi-thieu-cong-ty',
  'ban-lanh-dao',
  'qua-trinh-phat-trien',
  'dinh-huong-phat-trien',
]);
const fetchJson = async (url) => {
  const response = await fetch(url, { headers: { Accept: 'application/json', 'Cache-Control': 'no-cache' } });
  if (!response.ok) throw new Error(`HTTP ${response.status} ${new URL(url).pathname}`);
  return response.json();
};
const compactItem = (item) => ({
  id: item?.id,
  label: item?.label,
  key: item?.key,
  slug: item?.slug,
  href: item?.href,
  linkType: item?.linkType,
  parent: item?.parent,
  children: Array.isArray(item?.children) ? item.children.map(compactItem) : [],
});

const pages = await fetchJson(`${wp}/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,parent,acf,link`);
const targetPages = pages
  .filter((p) => wantedSlugs.has(String(p?.slug || '')))
  .map((p) => ({
    id: p.id,
    slug: p.slug,
    title: String(p?.title?.rendered || '').replace(/<[^>]*>/g, '').trim(),
    parent: p.parent,
    key: p?.acf?.key || '',
    action: p?.acf?.action || '',
    lang: p?.acf?.product_lang?.value || p?.acf?.product_lang || '',
    link: p.link,
  }));
console.log('INTRO_AUDIT_TARGET_PAGES=' + JSON.stringify(targetPages));

const tables = await fetchJson(`${wp}/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1`);
const introTables = (Array.isArray(tables) ? tables : [])
  .filter((t) => /^(?:about|intro)_/i.test(String(t?.id || '')))
  .map((t) => ({ id: t.id, name: t.name, rows: Array.isArray(t.items) ? t.items.length : null }));
console.log('INTRO_AUDIT_TABLES=' + JSON.stringify(introTables));

const menuPayload = await fetchJson(`${wp}/wp-json/esc-api/v1/menus?_intro_audit=${Date.now()}`);
assert.equal(menuPayload?.success, true, 'ESC menu API contract invalid');
const header = menuPayload?.menus?.Header?.vi || null;
console.log('INTRO_AUDIT_HEADER_VI=' + JSON.stringify(header ? {
  id: header.id,
  code: header.code,
  lang: header.lang,
  type: header.type,
  items: (header.items || []).map(compactItem),
} : null));

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
try {
  await page.goto(wp + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([
    page.waitForURL(/\/wp-admin\//, { timeout: 50000 }),
    page.locator('#wp-submit').click(),
  ]);
  assert.equal(new URL(page.url()).origin, wp, 'Admin audit escaped configured WordPress origin');

  const noncePages = [
    '/wp-admin/nav-menus.php?action=edit&menu=1767&esc_full_admin=1',
    '/wp-admin/post.php?post=82642&action=edit&esc_full_admin=1',
  ];
  let nonce = '';
  for (const path of noncePages) {
    await page.goto(wp + path, { waitUntil: 'domcontentloaded', timeout: 50000 });
    nonce = await page.evaluate(() => typeof globalThis.wpApiSettings?.nonce === 'string' ? globalThis.wpApiSettings.nonce.trim() : '');
    if (nonce) break;
  }
  assert.match(nonce, /^[A-Za-z0-9_-]{8,32}$/, 'Full admin REST nonce unavailable');

  const coreResponse = await page.request.get(
    wp + '/wp-json/wp/v2/menu-items?context=edit&status=publish&menus=1767&per_page=100&orderby=menu_order&order=asc&_fields=id,title,url,status,menus,parent,menu_order,type,target',
    { headers: { 'X-WP-Nonce': nonce, 'Cache-Control': 'no-cache' }, timeout: 30000 }
  );
  assert.ok(coreResponse.ok(), 'Core menu-items audit failed HTTP ' + coreResponse.status());
  const coreItems = await coreResponse.json();
  console.log('INTRO_AUDIT_CORE_HEADER_ITEMS=' + JSON.stringify(coreItems.map((item) => ({
    id: item.id,
    title: String(item?.title?.raw ?? item?.title?.rendered ?? '').replace(/<[^>]*>/g, '').trim(),
    url: item.url,
    status: item.status,
    menus: item.menus,
    parent: item.parent,
    menu_order: item.menu_order,
    type: item.type,
    target: item.target,
  }))));

  const draftsResponse = await page.request.get(
    wp + '/wp-json/wp/v2/menu-items?context=edit&status=draft&per_page=100&_fields=id,title,url,status,menus,parent,menu_order,type,target',
    { headers: { 'X-WP-Nonce': nonce, 'Cache-Control': 'no-cache' }, timeout: 30000 }
  );
  assert.ok(draftsResponse.ok(), 'Draft menu-items audit failed HTTP ' + draftsResponse.status());
  const drafts = await draftsResponse.json();
  const relevantTitles = new Set(['Giới thiệu','Thư ngỏ','Giới thiệu công ty','Ban lãnh đạo','Quá trình phát triển','Định hướng phát triển','Company Brochure']);
  console.log('INTRO_AUDIT_RELEVANT_DRAFTS=' + JSON.stringify(drafts.filter((item) =>
    relevantTitles.has(String(item?.title?.raw ?? item?.title?.rendered ?? '').replace(/<[^>]*>/g, '').trim())
  ).map((item) => ({
    id:item.id,title:String(item?.title?.raw ?? item?.title?.rendered ?? '').replace(/<[^>]*>/g,'').trim(),
    url:item.url,status:item.status,menus:item.menus,parent:item.parent,menu_order:item.menu_order,type:item.type,target:item.target
  }))));
} finally {
  await browser.close();
}

for (const slug of wantedSlugs) {
  const response = await fetch(`${front}/${slug}`, { redirect: 'manual' });
  console.log('INTRO_AUDIT_FRONT_ROUTE=' + JSON.stringify({ slug, status: response.status, location: response.headers.get('location') || '' }));
}
console.log('INTRO_AUDIT=PASS_READ_ONLY');
