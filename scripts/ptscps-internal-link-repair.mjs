import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
const githubToken = String(process.env.GITHUB_TOKEN || '').trim();
// Only the explicitly labelled one-off homepage source release forces a build
// when WordPress has no pending content updates. Ordinary QA remains no-op.
const releaseEvent = process.env.GITHUB_EVENT_PATH
  ? JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
const forceBuild = /\[home-release\]/.test(String(releaseEvent.head_commit?.message || ''));
assert(wp.startsWith('https://') && front.startsWith('https://') && wp !== front && user && pass,
  'Missing validated PTSCPS origins or WordPress credentials');

const artifactDir = 'artifacts/ptscps-internal-link-repair';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => wp + path;
const acfValue = value => String(value?.value ?? value?.ID ?? value?.id ?? value ?? '').trim();
const log = (key, value) => console.log(`PTSCPS_LINK_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
let writes = 0;
const repairs = [];
const ambiguities = [];
const routeMap = new Map();
const ambiguousRoutes = new Set();

async function login() {
  await page.goto(uri('/wp-login.php'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForLoadState('domcontentloaded'), page.locator('#wp-submit').click()]);
  if (new URL(page.url()).searchParams.get('action') === 'confirm_admin_email') {
    const skip = page.locator('a.skip-confirmation-button').first();
    const confirm = page.locator('#correct-admin-email').first();
    if (await skip.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), skip.click()]);
    else if (await confirm.count()) await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), confirm.click()]);
  }
  if (!/\/wp-admin\//.test(page.url())) await page.waitForURL(/\/wp-admin\//, { timeout: 50000 });
  assert(new URL(page.url()).origin === wp, 'WordPress login escaped configured origin');
  log('AUTH', 'PASS');
}

async function nonce() {
  const candidates = [
    '/wp-admin/edit.php?post_type=page&esc_full_admin=1',
    '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1',
  ];
  for (const path of candidates) {
    await page.goto(uri(path), { waitUntil: 'domcontentloaded', timeout: 50000 });
    const value = await page.evaluate(() => String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(value)) return value;
  }
  const fallback = await page.request.post(uri('/wp-admin/admin-ajax.php'), {
    form: { action: 'rest-nonce' }, timeout: 30000,
  }).catch(() => null);
  const value = fallback?.ok() ? (await fallback.text()).trim() : '';
  assert(/^[A-Za-z0-9_-]{8,32}$/.test(value), 'Authenticated REST nonce unavailable');
  return value;
}

async function api(method, path, n, data, timeout = 60000) {
  const response = await page.request.fetch(uri(path), {
    method, timeout,
    headers: { 'X-WP-Nonce': n, 'Cache-Control': 'no-cache' },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function collect(collection, n, fields, extra = '') {
  const rows = [];
  for (let p = 1; p <= 40; p++) {
    const { response, body } = await api('GET',
      `/wp-json/wp/v2/${collection}?context=edit&status=any&per_page=100&page=${p}&_fields=${encodeURIComponent(fields)}${extra}`, n);
    if (response.status() === 400 && p > 1) break;
    assert(response.ok() && Array.isArray(body), `${collection} inventory failed HTTP=${response.status()} page=${p}`);
    rows.push(...body);
    const max = Number(response.headers()['x-wp-totalpages'] || 1);
    if (p >= max || body.length < 100) break;
  }
  return rows;
}

async function listProductCategories(n) {
  const rows = [];
  for (let p = 1; p <= 10; p++) {
    const { response, body } = await api('GET',
      `/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&per_page=100&page=${p}&_fields=id,name,slug,parent,description`, n);
    if (response.status() === 400 && p > 1) break;
    assert(response.ok() && Array.isArray(body), `product_cat inventory failed HTTP=${response.status()} page=${p}`);
    rows.push(...body);
    const max = Number(response.headers()['x-wp-totalpages'] || 1);
    if (p >= max || body.length < 100) break;
  }
  return rows;
}

const productCategoryIds = product => Array.isArray(product?.product_categories)
  ? product.product_categories.map(item => Number(item?.id || item)).filter(Boolean)
  : Array.isArray(product?.product_cat) ? product.product_cat.map(Number).filter(Boolean) : [];

function pathKey(value) {
  try {
    const url = new URL(String(value || ''), 'https://ptscps.local');
    let path = String(url.pathname || '/').replace(/\/{2,}/g, '/');
    if (path.length > 1) path = path.replace(/\/+$/, '');
    return path || '/';
  } catch { return ''; }
}

function registerRoute(from, to, owner) {
  const key = pathKey(from);
  const target = pathKey(to);
  if (!key || !target || key === target || ambiguousRoutes.has(key)) return;
  const existing = routeMap.get(key);
  if (existing && existing !== target) {
    routeMap.delete(key);
    ambiguousRoutes.add(key);
    ambiguities.push({ from: key, first: existing, second: target, owner });
    return;
  }
  routeMap.set(key, target);
}

function isDescendantTerm(row, rootId, byId) {
  let current = row;
  const seen = new Set();
  while (current && Number(current.id) > 0 && !seen.has(Number(current.id))) {
    if (Number(current.id) === Number(rootId)) return true;
    seen.add(Number(current.id));
    current = byId.get(Number(current.parent || 0));
  }
  return false;
}

function prepareRoutes(pages, categories, products) {
  routeMap.clear();
  ambiguousRoutes.clear();
  ambiguities.length = 0;
  const byId = new Map(categories.map(item => [Number(item.id), item]));
  const roots = [
    { slug: 'dich-vu', lang: 'vi' },
    { slug: 'services', lang: 'en' },
  ].map(spec => ({ ...spec, row: categories.find(item => item.slug === spec.slug && Number(item.parent || 0) === 0) }))
    .filter(item => item.row);

  for (const root of roots) {
    for (const term of categories.filter(item => isDescendantTerm(item, Number(root.row.id), byId))) {
      const route = Number(term.id) === Number(root.row.id) ? `/${root.slug}` : `/${root.slug}/${term.slug}`;
      if (Number(term.id) !== Number(root.row.id)) registerRoute(`/${term.slug}`, route, `product_cat:${term.id}`);
      if (root.lang === 'en') registerRoute(`/e/${term.slug}`, route, `product_cat:${term.id}`);
    }
  }

  for (const item of pages) {
    const slug = String(item.slug || '').trim();
    const lang = acfValue(item.acf?.product_lang).toLowerCase();
    const key = acfValue(item.acf?.key);
    if (!slug) continue;
    if (key.startsWith('hseq-') && slug !== 'hseq' && slug !== 'hseq-en') {
      registerRoute(`/${slug}`, `/hseq/${slug}`, `page:${item.id}`);
      if (lang === 'en') registerRoute(`/e/${slug}`, `/hseq/${slug}`, `page:${item.id}`);
    } else if (lang === 'en') {
      registerRoute(`/e/${slug}`, `/${slug}`, `page:${item.id}`);
    }
  }

  registerRoute('/hseq/hseq', '/hseq', 'repair:legacy-hseq-root');
  registerRoute('/hseq/hseq-en', '/hseq-en', 'repair:legacy-hseq-en-root');

  const legacyAliases = new Map([
    ['/job/vi-tri-3-3-2-2-2', '/search-jobs'],
    ['/job/vi-tri-3-3-2-2', '/search-jobs'],
    ['/job/vi-tri-3-3-2', '/search-jobs'],
    ['/job/vi-tri-3-3', '/search-jobs'],
    ['/job/vi-tri-3-2', '/search-jobs'],
    ['/job/vi-tri-1-2-2', '/search-jobs'],
    ['/job/category-2', '/search-jobs'],
    ['/job/category-1', '/search-jobs'],
    ['/cac-du-an-tieu-bieu', '/dich-vu'],
    ['/careers', '/search-jobs'],
    ['/careers/careers-contacts', '/contact'],
    ['/careers/pps-benefits-culture', '/search-jobs'],
    ['/careers/search-jobs', '/search-jobs'],
    ['/dich-vu/dich-vu-thiet-ke-mua-sam-gia-cong-che-tao%E2%80%8B', '/dich-vu'],
    ['/dich-vu/van-hanh-va-bao-duong-cac-cong-trinh-co-dinh-tren-bien-hoac-tren-bo', '/dich-vu'],
    ['/hseq-en/hseq-certification', '/hseq/hseq-certification'],
    ['/hseq-en/hseq-management-system', '/hseq/hseq-management-system'],
    ['/hseq-en/hseq-policy', '/hseq/hseq-policy-4'],
    ['/hseq/hseq-policy', '/hseq/hseq-policy-4'],
    ['/hseq-en/hseq-target', '/hseq/hseq-target'],
    ['/services/engineering-procurement-construction-and-installation-epci', '/services'],
    ['/services/providing-qualified-personnel-for-om-of-fpso-fso-and-offshore-floating-unit%E2%80%8B', '/services'],
    ['/tuyen-dung/lien-he-tuyen-dung', '/lien-he'],
    ['/tuyen-dung/thong-tin-tuyen-dung', '/tuyen-dung'],
    ['/tuyen-dung/van-hoa-doanh-nghiep', '/tuyen-dung'],
    ['/track-record', '/services'],
    ['/c/about-us', '/top-message'],
    ['/about-us', '/top-message'],
    ['/c/du-an', '/dich-vu'],
    ['/c/du-an/cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong', '/dich-vu/cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong'],
    ['/c/du-an/van-hanh-va-bao-duong-fpso-fso-mopu', '/dich-vu/van-hanh-va-bao-duong-fpso-fso-mopu'],
    ['/c/gioi-thieu', '/thu-ngo'],
    ['/gioi-thieu', '/thu-ngo'],
    ['/c/news', '/news'],
    ['/c/news/activity-of-the-company', '/c/news/company-activities'],
    ['/c/news/event', '/news'],
    ['/c/thu-moi-chao-gia', '/thu-moi-chao-gia'],
    ['/c/thu-vien', '/thu-vien-pps'],
    ['/c/tin-tuc', '/tin-tuc'],
    ['/c/tin-tuc/su-kien', '/tin-tuc'],
    ['/c/track-record', '/services'],
    ['/c/track-record/fpso-fso-om-services', '/services/fpso-fso-om-services'],
    ['/c/track-record/manpower-supply', '/services/manpower-supply'],
    ['/c/tuyen-dung', '/tuyen-dung'],
    ['/c/uncategorized-vi', '/tin-tuc'],
  ]);
  for (const [from, to] of legacyAliases) registerRoute(from, to, 'repair:legacy-content-link');

  for (const item of products) {
    const slug = String(item.slug || '').trim();
    if (!slug) continue;
    const category = byId.get(Number(productCategoryIds(item)[0] || 0));
    if (!category) continue;
    const root = roots.find(candidate => isDescendantTerm(category, Number(candidate.row.id), byId));
    if (!root) continue;
    const route = `/${root.slug}/${category.slug}/${slug}`;
    registerRoute(`/${slug}`, route, `product:${item.id}`);
    registerRoute(`/${slug}.htm`, route, `product:${item.id}:legacy-htm`);
    if (root.lang === 'en') registerRoute(`/e/${slug}`, route, `product:${item.id}`);
  }
  log('ROUTES', { mapped: routeMap.size, ambiguous: ambiguousRoutes.size });
}

function rewriteHref(raw) {
  const value = String(raw || '').trim();
  if (!value || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(value)) return value;
  let url;
  try { url = new URL(value, front + '/'); } catch { return value; }
  const legacyHost = /(?:^|\.)ptscps\.com\.vn$/i.test(url.hostname);
  const currentHost = url.origin === new URL(front).origin || url.origin === new URL(wp).origin;
  const rootRelative = value.startsWith('/');
  if (!legacyHost && !currentHost && !rootRelative) return value;

  let key = pathKey(url.pathname);
  const mapped = routeMap.get(key);
  if (mapped) key = mapped;
  else if (key.startsWith('/e/')) key = '/' + key.slice(3);

  return `${key}${url.search}${url.hash}`;
}

function rewriteHtml(html, owner) {
  let changed = 0;
  const next = String(html || '').replace(/\bhref\s*=\s*(["'])([^"']+)\1/gi, (full, quote, href) => {
    const fixed = rewriteHref(href);
    if (fixed === href) return full;
    changed++;
    repairs.push({ owner, from: href, to: fixed });
    return `href=${quote}${fixed}${quote}`;
  });
  return { next, changed };
}

async function repairContent(n, pages, categories, products) {
  for (const item of pages) {
    const current = String(item.content?.raw ?? item.content?.rendered ?? '');
    const { next, changed } = rewriteHtml(current, `page:${item.id}:${item.slug}`);
    if (!changed) continue;
    const saved = await api('POST', `/wp-json/wp/v2/pages/${item.id}`, n, { content: next }, 90000);
    assert(saved.response.ok(), `Page link repair failed id=${item.id} HTTP=${saved.response.status()}`);
    item.content = { ...(item.content || {}), raw: next, rendered: next };
    writes++;
  }

  for (const item of categories) {
    const current = String(item.description?.raw ?? item.description ?? '');
    // Historical duplicate project text links are owned by these two service
    // category descriptions. Keep image anchors and dynamically rendered cards.
    const duplicateProjectSlugs = {
      'manpower-supply': ['5454', 'fpso-thai-binh-vn-2', 'fso-orkid-2', 'upstream-plant-long-son-petrochemical-complex'],
      'fpso-fso-om-services': ['fso-pps-01-e-translation', 'fso-golden-star-2', '648', 'fso-ptsc-bien-dong-01-2', 'fpso-ruby-ii-2', 'fso-ptsc-bach-ho-2', 'fpso-ruby-princess-2'],
    };
    const duplicateSlugs = new Set(duplicateProjectSlugs[String(item.slug || '')] || []);
    let removedTextLinks = 0;
    const withoutDuplicateText = duplicateSlugs.size ? current.replace(
      /<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>[\s\S]*?<\/a>/gi,
      (anchor, _quote, href) => {
        let slug = '';
        try { slug = new URL(href, front).pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1)?.replace(/\.html?$/i, '') || ''; }
        catch { return anchor; }
        if (!duplicateSlugs.has(slug) || /<(?:img|picture|svg|video)\b/i.test(anchor)) return anchor;
        removedTextLinks++;
        return '';
      },
    ).replace(/<(p|li|div|ul|ol)\b[^>]*>(?:\s|&nbsp;|&#160;|<br\s*\/?>)*<\/\1>/gi, '') : current;
    const { next, changed } = rewriteHtml(withoutDuplicateText, `product_cat:${item.id}:${item.slug}`);
    if (!changed && !removedTextLinks) continue;
    if (removedTextLinks) {
      repairs.push({ owner: `product_cat:${item.id}:${item.slug}:project-text`, removed: removedTextLinks });
      log('PROJECT_TEXT_REMOVED', { slug: item.slug, links: removedTextLinks });
    }
    const saved = await api('POST', `/wp-json/wp/v2/product_cat/${item.id}`, n, { description: next }, 90000);
    assert(saved.response.ok(), `Product category link repair failed id=${item.id} HTTP=${saved.response.status()}`);
    item.description = next;
    writes++;
  }

  for (const item of products) {
    const content = String(item.content?.raw ?? item.content?.rendered ?? '');
    const excerpt = String(item.excerpt?.raw ?? item.excerpt?.rendered ?? '');
    const contentFixed = rewriteHtml(content, `product:${item.id}:${item.slug}:content`);
    const excerptFixed = rewriteHtml(excerpt, `product:${item.id}:${item.slug}:excerpt`);
    if (!contentFixed.changed && !excerptFixed.changed) continue;
    const saved = await api('POST', `/wp-json/wp/v2/product/${item.id}`, n, {
      ...(contentFixed.changed ? { content: contentFixed.next } : {}),
      ...(excerptFixed.changed ? { excerpt: excerptFixed.next } : {}),
    }, 90000);
    assert(saved.response.ok(), `Product link repair failed id=${item.id} HTTP=${saved.response.status()}`);
    if (contentFixed.changed) item.content = { ...(item.content || {}), raw: contentFixed.next, rendered: contentFixed.next };
    if (excerptFixed.changed) item.excerpt = { ...(item.excerpt || {}), raw: excerptFixed.next, rendered: excerptFixed.next };
    writes++;
  }
}

function hrefsFromHtml(html) {
  return [...String(html || '').matchAll(/\bhref\s*=\s*["']([^"']+)["']/gi)].map(match => String(match[1] || '').trim()).filter(Boolean);
}

function collectStrings(value, out = []) {
  if (typeof value === 'string') out.push(value);
  else if (Array.isArray(value)) value.forEach(item => collectStrings(item, out));
  else if (value && typeof value === 'object') Object.values(value).forEach(item => collectStrings(item, out));
  return out;
}

async function readTable(id) {
  const response = await page.request.get(uri(`/wp-json/tablepress/v1/table/${encodeURIComponent(id)}?_link_qa=${Date.now()}`), {
    timeout: 30000, headers: { 'Cache-Control': 'no-cache' },
  });
  if (response.status() === 404) return null;
  assert(response.ok(), `ESC Table read failed ${id}: HTTP ${response.status()}`);
  return response.json();
}

const tableIds = html => [...String(html || '').matchAll(/\[(?:table|esc_table)\s+id\s*=\s*["']?([^\s\]"']+)/gi)].map(match => match[1]);

function qaTarget(raw) {
  const value = String(raw || '').trim();
  if (!value || /^(?:#|mailto:|tel:|javascript:|data:)/i.test(value)) return null;
  let url;
  try { url = new URL(value, front + '/'); } catch { return null; }
  const frontOrigin = new URL(front).origin;
  const wpOrigin = new URL(wp).origin;
  const legacyHost = /(?:^|\.)ptscps\.com\.vn$/i.test(url.hostname);
  const isRelative = !/^[a-z][a-z0-9+.-]*:/i.test(value) && !/^\/\//.test(value);
  if (!legacyHost && url.origin !== frontOrigin && url.origin !== wpOrigin && !isRelative) return null;
  if (/^\/(?:wp-content|wp-admin|wp-json)\//.test(url.pathname)) return null;
  return `${url.pathname}${url.search}`;
}

async function collectLinkRecords(pages, categories, products) {
  const records = [];
  const add = (owner, html) => {
    for (const href of hrefsFromHtml(html)) {
      const target = qaTarget(href);
      if (target) records.push({ owner, href, target });
    }
  };
  for (const item of pages) add(`page:${item.id}:${item.slug}`, item.content?.raw ?? item.content?.rendered ?? '');
  for (const item of categories) add(`product_cat:${item.id}:${item.slug}`, item.description?.raw ?? item.description ?? '');
  for (const item of products) {
    add(`product:${item.id}:${item.slug}:content`, item.content?.raw ?? item.content?.rendered ?? '');
    add(`product:${item.id}:${item.slug}:excerpt`, item.excerpt?.raw ?? item.excerpt?.rendered ?? '');
  }

  const ids = [...new Set([
    ...pages.flatMap(item => tableIds(item.content?.raw ?? item.content?.rendered ?? '')),
    ...categories.flatMap(item => tableIds(item.description?.raw ?? item.description ?? '')),
    ...products.flatMap(item => [
      ...tableIds(item.content?.raw ?? item.content?.rendered ?? ''),
      ...tableIds(item.excerpt?.raw ?? item.excerpt?.rendered ?? ''),
    ]),
  ])];
  for (const id of ids) {
    const table = await readTable(id);
    if (!table) continue;
    for (const text of collectStrings(table)) add(`table:${id}`, text);
  }
  return records;
}

// Homepage links are WordPress ESC Table data, not Astro constants. Use the
// native TablePress save contract; preserve every untouched cell and option.
const legacyHomeUrl = /https?:\/\/(?:www\.)?ptscps\.com\.vn(?:\/[\w\-./%?=&+#~:]*)?/gi;
const legacyLinkHost = /(?:^|\.)ptscps\.com\.vn$/i;
const homeLinkAudit = [];

function homepageLinkTarget(value, locale, pages, translatedNews) {
  let url;
  try { url = new URL(value); } catch { return null; }
  if (!legacyLinkHost.test(url.hostname)) return null;
  if (/\/(?:wp-content\/uploads|wp-json|wp-admin)\//.test(url.pathname) || /\.(?:pdf|png|jpe?g|gif|webp|svg|zip|docx?|xlsx?)$/i.test(url.pathname)) return null;
  let target = rewriteHref(value);
  const path = new URL(target, front).pathname;
  const slug = decodeURIComponent(url.pathname).split('/').filter(Boolean).at(-1)?.replace(/\.html?$/i, '') || '';
  const source = pages.find(p => String(p.slug || '') === slug);
  const sourceKey = source ? acfValue(source.acf?.key) : '';
  const counterpart = sourceKey ? pages.find(p => acfValue(p.acf?.key) === sourceKey && acfValue(p.acf?.product_lang) === locale && p.status === 'publish') : null;
  if (/\.html?$/i.test(url.pathname)) {
    // Legacy .htm URLs are not public routes on the new Astro site.
    // For pages, resolve the real localized Page identity by ACF key.
    if (source && acfValue(source.acf?.product_lang) === locale) target = '/' + source.slug + url.search + url.hash;
    else if (source && counterpart) target = '/' + counterpart.slug + url.search + url.hash;
    else if (locale === 'en') target = translatedNews.get(slug) || '/news';
    else target = '/' + slug + url.search + url.hash;
  }
  if (source && acfValue(source.acf?.product_lang) !== locale && counterpart) {
    const newPath = '/' + String(counterpart.slug).replace(/^\/+/, '');
    target = newPath + url.search + url.hash;
  }
  // English homepage service cards must not send visitors into Vietnamese categories.
  const serviceEN = new Map([
    ['/dich-vu/van-hanh-va-bao-duong-fpso-fso-mopu', '/services/fpso-fso-om-services'],
    ['/dich-vu/cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong', '/services/manpower-supply'],
    ['/dich-vu/dich-vu-thiet-ke-mua-sam-gia-cong-che-tao%E2%80%8B', '/services'],
    ['/dich-vu/dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep', '/services/repairs-maintenance-services'],
    ['/c/tuyen-dung', '/search-jobs'],
  ]);
  if (locale === 'en') {
    const redirect = serviceEN.get(url.pathname);
    if (redirect) target = redirect + url.search + url.hash;
  }
  return { target, path, sourceKey, locale };
}

async function readNativeHomeTable(id) {
  const editUrl = `/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(id)}`;
  await page.goto(uri(editUrl), { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForFunction(() => globalThis.tp?.table?.data && globalThis.tp?.nonces?.edit_table && globalThis.tp?.editor?.options?.data, null, { timeout: 40000 });
  const table = await page.evaluate(() => ({
    id: String(globalThis.tp.table.id || ''),
    nonce: String(globalThis.tp.nonces.edit_table || ''),
    name: String(globalThis.tp.table.meta?.name || ''),
    description: String(globalThis.tp.table.meta?.description || ''),
    data: JSON.parse(JSON.stringify(globalThis.tp.editor.options.data)),
    options: JSON.parse(JSON.stringify(globalThis.tp.table.options)),
    visibility: JSON.parse(JSON.stringify(globalThis.tp.table.visibility)),
    columns: globalThis.tp.editor.options.columns.length,
  }));
  assert(table.id === id && table.nonce && Array.isArray(table.data) && table.columns > 0,
    `Native ESC Table editor mismatch for ${id}`);
  return table;
}

async function resolveEnglishLegacyNews(viSlug, n) {
  // Resolve a historical VI Post through its translated legacy record,
  // then verify that the EN Post was imported and tagged product_lang=en.
  const source = 'https://ptscps.com.vn';
  try {
    const viResponse = await context.request.get(`${source}/wp-json/wp/v2/posts?slug=${encodeURIComponent(viSlug)}&_fields=id,slug,translations`, { timeout: 25000 });
    if (!viResponse.ok()) return null;
    const rows = await viResponse.json();
    if (!Array.isArray(rows) || rows.length !== 1) return null;
    const translation = rows[0]?.translations?.en;
    const id = Number(translation?.id || translation?.ID || translation?.value || translation || 0);
    if (!id) return null;
    const enResponse = await context.request.get(`${source}/wp-json/wp/v2/posts/${id}?_fields=id,slug`, { timeout: 25000 });
    if (!enResponse.ok()) return null;
    const enSlug = String((await enResponse.json())?.slug || '').trim();
    if (!enSlug) return null;
    const { response, body } = await api('GET', `/wp-json/wp/v2/posts?context=edit&status=publish&slug=${encodeURIComponent(enSlug)}&_fields=id,slug,status,acf`, n);
    const match = response.ok() && Array.isArray(body) ? body.find(p => p.slug === enSlug && p.status === 'publish' && acfValue(p.acf?.product_lang) === 'en') : null;
    return match ? `/${enSlug}` : null;
  } catch { return null; }
}

// Resolve curated card titles from real WordPress Products, never fabricate a
// detail URL. If a localized EN Product does not exist, link to its verified
// EN service category instead of silently loading a Vietnamese detail page.
const normalizeProjectTitle = value => String(value || '').replace(/<[^>]+>/g, '').replace(/&amp;/gi, '&').trim().replace(/\s+/g, ' ').toLowerCase();
function homepageProjectTarget(title, locale, products, categories) {
  const matches = products.filter(p => p.status === 'publish'
    && normalizeProjectTitle(p.title?.raw ?? p.title?.rendered ?? p.title) === normalizeProjectTitle(title));
  const source = matches.filter(p => acfValue(p.acf?.product_lang) === 'vi');
  if (source.length !== 1) return null;
  const viRoute = routeMap.get(`/${source[0].slug}`);
  if (!viRoute || !viRoute.startsWith('/dich-vu/')) return null;
  if (locale === 'vi') return viRoute;
  const translated = matches.filter(p => acfValue(p.acf?.product_lang) === 'en');
  if (translated.length === 1) {
    const direct = routeMap.get(`/e/${translated[0].slug}`);
    if (direct?.startsWith('/services/')) return direct;
  }
  const category = viRoute.split('/')[2];
  const counterpart = {
    'van-hanh-va-bao-duong-fpso-fso-mopu': 'fpso-fso-om-services',
    'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong': 'manpower-supply',
  }[category];
  return counterpart && categories.some(c => c.slug === counterpart)
    ? `/services/${counterpart}` : null;
}

async function repairHomepageTables(pages, products, categories, n) {
  const homePages = pages.filter(p => {
    const slug = String(p.slug || '').toLowerCase();
    const key = acfValue(p.acf?.key).toLowerCase();
    return p.status === 'publish' && (slug === 'home' || slug === 'trang-chu' || key === 'home' || key === 'trang-chu');
  });
  const ids = [...new Set(homePages.flatMap(p => tableIds(p.content?.raw ?? p.content?.rendered ?? '')))]
    .filter(id => /^home_\d{2}(?:_(?:en|vi))?$/i.test(id));
  assert(ids.length > 0, 'HOME_TABLES_MISSING: Cannot resolve editable home ESC Table ids from published WordPress pages');
  log('HOME_TABLES', { pages: homePages.map(p => ({ id: p.id, slug: p.slug, locale: acfValue(p.acf?.product_lang) })), ids });

  // Read all tables before writing; keep their existing metadata and layout.
  const snapshots = [];
  for (const id of ids) snapshots.push({ id, table: await readNativeHomeTable(id) });
  const translatedNews = new Map();
  const englishNews = snapshots.filter(x => /^home_05_en$/i.test(x.id));
  for (const { table } of englishNews) {
    for (const row of table.data) for (const cell of row) {
      if (typeof cell !== 'string') continue;
      for (const match of cell.matchAll(legacyHomeUrl)) {
        let url;
        try { url = new URL(match[0]); } catch { continue; }
        if (!/\.html?$/i.test(url.pathname)) continue;
        const slug = url.pathname.split('/').pop().replace(/\.html?$/i, '');
        if (slug === 'thu-ngo' || translatedNews.has(slug)) continue;
        const direct = await resolveEnglishLegacyNews(slug, n);
        translatedNews.set(slug, direct || '/news');
        log('HOME_EN_NEWS_ROUTE', { legacySlug: slug, route: direct || '/news', paired: Boolean(direct) });
      }
    }
  }

  // Collect and validate candidates before the first TablePress write.
  const changes = [];
  const unresolved = [];
  const availability = new Map();
  for (const { id, table } of snapshots) {
    const locale = /_en$/i.test(id) ? 'en' : 'vi';
    let altered = 0;
    const data = table.data.map((row, rowIndex) => row.map((cell, colIndex) => {
      if (typeof cell !== 'string' || !/ptscps\.com\.vn/i.test(cell)) return cell;
      return cell.replace(legacyHomeUrl, oldUrl => {
        const candidate = homepageLinkTarget(oldUrl, locale, pages, translatedNews);
        if (!candidate) return oldUrl;
        const { target } = candidate;
        if (!target.startsWith('/') || target.startsWith('//') || /ptscps\.com\.vn/i.test(target)) {
          unresolved.push({ id, row: rowIndex, col: colIndex, oldUrl, target, reason: 'INVALID_TARGET' });
          return oldUrl;
        }
        homeLinkAudit.push({ id, row: rowIndex, col: colIndex, from: oldUrl, to: target, locale });
        altered++;
        return target;
      });
    }));
    if (/^home_04(?:_en)?$/i.test(id)) {
      const headers = table.data[0].map(value => String(value || '').trim());
      const titleCol = headers.indexOf('title');
      const linkCol = headers.indexOf('link');
      assert(titleCol >= 0 && linkCol >= 0, `PROJECT_CARD_SCHEMA_MISMATCH: ${id}`);
      for (let row = 2; row < data.length; row++) {
        if (String(data[row][linkCol] || '').trim()) continue;
        const title = String(data[row][titleCol] || '').trim();
        if (!title) continue;
        const target = homepageProjectTarget(title, locale, products, categories);
        if (!target) { unresolved.push({ id, row, title, reason: 'PROJECT_ROUTE_UNRESOLVED' }); continue; }
        data[row][linkCol] = target;
        altered++;
        homeLinkAudit.push({ id, row, col: linkCol, from: '', to: target, title, locale });
        log('PROJECT_CARD_LINK', { id, title, target, locale });
      }
    }
    if (altered) changes.push({ id, table, data, altered });
  }
  log('HOME_LINK_INVENTORY', { tables: ids.length, candidates: homeLinkAudit.length, byTable: changes.map(x => ({ id: x.id, links: x.altered })) });
  // An unknown mapping must not be written as a plausible-looking relative 404.
  for (const row of homeLinkAudit) {
    if (!availability.has(row.to)) {
      const response = await context.request.get(front + row.to, { timeout: 25000, maxRedirects: 8 }).catch(() => null);
      availability.set(row.to, response?.status() || 0);
    }
    const http = availability.get(row.to);
    if (http < 200 || http >= 400) unresolved.push({ ...row, reason: 'TARGET_NOT_FOUND', http });
  }
  await writeFile(`${artifactDir}/home-link-audit.json`, JSON.stringify({ ids, homePages: homePages.map(p => ({ id: p.id, slug: p.slug })), candidates: homeLinkAudit, unresolved }, null, 2));
  if (unresolved.length) {
    log('HOME_LINK_UNRESOLVED', unresolved);
    throw Error(`HOME_LINK_UNRESOLVED=${unresolved.length}: some legacy links do not resolve to live routes`);
  }
  for (const { id, table, data, altered } of changes) {
    const original = JSON.stringify(table.data);
    const desired = JSON.stringify(data);
    let confirmed = false;
    let savedInThisRun = false;
    for (let attempt = 1; attempt <= 4 && !confirmed; attempt++) {
      let latest;
      try { latest = await readNativeHomeTable(id); }
      catch (error) {
        if (attempt === 4) throw error;
        log('HOME_TABLE_READ_RETRY', { id, attempt, error: String(error?.code || error?.message || 'read failed').slice(0, 90) });
        await sleep(attempt * 2000);
        continue;
      }
      const actual = JSON.stringify(latest.data);
      if (actual === desired) {
        confirmed = true;
        log('HOME_TABLE_READBACK_CONFIRMED', { id, attempt });
        break;
      }
      assert(actual === original, `ESC Table concurrent data change: ${id}; refusing overwrite`);
      const form = {
        action: 'tablepress_save_table',
        _ajax_nonce: latest.nonce,
        'tablepress[id]': id,
        'tablepress[new_id]': id,
        'tablepress[name]': latest.name,
        'tablepress[description]': latest.description,
        'tablepress[data]': desired,
        'tablepress[options]': JSON.stringify(latest.options),
        'tablepress[visibility]': JSON.stringify(latest.visibility),
        'tablepress[number][rows]': String(data.length),
        'tablepress[number][columns]': String(latest.columns),
      };
      try {
        const response = await page.request.post(uri('/wp-admin/admin-ajax.php'), { form, timeout: 90000 });
        const body = await response.json().catch(() => null);
        if (!response.ok() || body?.success !== true || body.table_id !== id) {
          if ([502, 503, 504].includes(response.status()) && attempt < 4) {
            log('HOME_TABLE_SAVE_RETRY', { id, attempt, http: response.status() });
            await sleep(attempt * 2000);
            continue;
          }
          throw Error(`ESC Table native save rejected ${id}: HTTP=${response.status()} message=${body?.message || 'unknown'}`);
        }
        savedInThisRun = true;
      } catch (error) {
        const reason = String(error?.code || error?.message || 'save failed').slice(0, 120);
        if (!/ECONNRESET|ETIMEDOUT|socket hang up|EPIPE|ECONNABORTED/i.test(reason) || attempt === 4) {
          // Even a failed final attempt may have been committed server-side.
          const readback = await readNativeHomeTable(id).catch(() => null);
          if (readback && JSON.stringify(readback.data) === desired) { confirmed = true; savedInThisRun = true; break; }
          throw error;
        }
        log('HOME_TABLE_SAVE_RETRY', { id, attempt, reason });
        await sleep(attempt * 2000);
      }
    }
    assert(confirmed || savedInThisRun, `ESC Table save not confirmed ${id}`);
    const verified = await readNativeHomeTable(id);
    assert(JSON.stringify(verified.data) === desired, `ESC Table readback mismatch ${id}`);
    if (savedInThisRun) {
      writes++;
      repairs.push({ owner: `table:${id}`, fixed: altered });
      log('HOME_TABLE_SAVED', { id, fixed: altered });
    } else log('HOME_TABLE_ALREADY_SAVED', { id, fixed: altered });
    await sleep(800);
  }
}

async function qaHomepageLinks() {
  const results = [];
  for (const path of ['/', '/home']) {
    const response = await context.request.get(front + path, { timeout: 45000 });
    assert(response.ok(), `HOME_ROUTE_HTTP_${response.status()}: ${path}`);
    const browserPage = await context.newPage();
    try {
      await browserPage.goto(front + path, { waitUntil: 'domcontentloaded', timeout: 45000 });
      const bad = await browserPage.locator('a[href*="ptscps.com.vn"], [onclick*="ptscps.com.vn"], [data-href*="ptscps.com.vn"]').evaluateAll(nodes => nodes.map(n => ({
        tag: n.tagName, text: (n.textContent || '').trim().slice(0, 100), href: n.getAttribute('href'), onclick: n.getAttribute('onclick'), dataHref: n.getAttribute('data-href'),
      })));
      const cards = await browserPage.locator('[data-pps-section="services"] article, [data-pps-section="projects"] article, [data-pps-section="news"] article').evaluateAll(nodes => nodes.map(card => {
        const a = card.querySelector(':scope > a[href]');
        return { section: card.closest('[data-pps-section]')?.getAttribute('data-pps-section'),
          href: a?.getAttribute('href') || '', fullCard: Boolean(a?.classList.contains('inset-0')) };
      }));
      results.push({ path, legacyLinks: bad, cards });
    } finally { await browserPage.close(); }
  }
  await writeFile(`${artifactDir}/home-link-qa.json`, JSON.stringify(results, null, 2));
  log('HOME_LINK_QA', results.map(r => ({ path: r.path, legacyLinks: r.legacyLinks.length })));
  assert(results.every(r => r.legacyLinks.length === 0), 'Homepage still renders legacy clickable pt scps.com.vn links');
  for (const row of results) {
    assert(row.cards.length >= 10, `HOME_CARDS_MISSING: ${row.path}, count=${row.cards.length}`);
    assert(row.cards.every(c => c.fullCard && c.href.startsWith('/') && !c.href.startsWith('//') && !/ptscps\.com\.vn/i.test(c.href)),
      `HOME_CARD_LINK_INVALID: ${row.path} ${JSON.stringify(row.cards.filter(c => !c.fullCard || !c.href.startsWith('/') || /ptscps\.com\.vn/i.test(c.href)))}`);
    log('HOME_CARD_QA', { path: row.path, cards: row.cards.length, fullCard: true });
  }
}

async function openBuildPage() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const button = page.locator('#vcs-build-btn-main');
  assert(await button.count() === 1, 'WordPress Build Website button unavailable');
  const state = await page.evaluate(() => ({
    configured: globalThis.vcsBuild?.build_configured,
    active: globalThis.vcsBuild?.initial_active,
    pending: globalThis.vcsBuild?.pending_count,
  }));
  assert(state.configured === true || state.configured === 1 || state.configured === '1', 'WordPress Build Website is not configured');
  return { button, state, disabled: await button.isDisabled() };
}

async function waitForBuildSlot() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const current = await openBuildPage();
    if (!current.state.active && (!current.disabled || (forceBuild && Number(current.state.pending || 0) === 0))) return current;
    log('BUILD_SLOT_WAIT', { attempt, active: Boolean(current.state.active), disabled: current.disabled });
    const existing = await waitForWordPressBuild({
      page,
      log: (key, value) => log(`BUILD_EXISTING_${key}`, value),
      expectTriggered: false,
      buildTimeoutMs: 900000,
      githubRepository: 'ngocnhanvo/ptscps-actions',
      githubToken,
    });
    log('BUILD_EXISTING_RESULT', existing);
    if (attempt < 6) await sleep(3000);
  }
  throw Error('WordPress Build Website stayed active/disabled after existing build completed');
}

async function triggerBuildAndWait() {
  assert(githubToken, 'GITHUB_TOKEN is required to monitor the exact Astro build run');
  const { button, state } = await waitForBuildSlot();
  if (forceBuild && Number(state.pending || 0) === 0) {
    const force = page.locator('#vcs-force-build');
    assert(await force.count() === 1 && !await force.isDisabled(), 'WordPress force-build control unavailable');
    if (!await force.isChecked()) await force.check();
    assert(!await button.isDisabled(), 'Build button disabled after force checkbox');
    log('BUILD_SOURCE_RELEASE', 'FORCE_EMPTY_QUEUE');
  }
  const ack = page.waitForResponse(response => response.url().startsWith(wp + '/wp-admin/admin-ajax.php')
    && response.request().method() === 'POST'
    && String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
  await button.click();
  const response = await ack;
  const body = await response.json().catch(() => null);
  assert(response.ok() && body?.success, 'WordPress Build Website rejected trigger');
  log('BUILD', 'TRIGGERED_VIA_WORDPRESS');
  const result = await waitForWordPressBuild({
    page,
    log: (key, value) => log(`BUILD_${key}`, value),
    githubRepository: 'ngocnhanvo/ptscps-actions',
    githubToken,
  });
  log('BUILD_RESULT', result);
  return result;
}

async function waitFrontReady() {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const response = await context.request.get(`${front}/?_link_ready=${Date.now()}-${attempt}`, { timeout: 20000 });
      if (response.status() >= 200 && response.status() < 400) return;
      log('READY_WAIT', { attempt, http: response.status() });
    } catch (error) {
      log('READY_WAIT', { attempt, error: String(error?.message || error) });
    }
    if (attempt < 12) await sleep(5000);
  }
  throw Error('Frontend readiness timeout after internal-link repair build');
}

async function qaLinks(records) {
  const unique = new Map();
  for (const row of records) {
    if (!unique.has(row.target)) unique.set(row.target, []);
    unique.get(row.target).push(row);
  }
  const results = [];
  const failures = [];
  for (const [target, owners] of unique) {
    let status = 0;
    let finalUrl = '';
    let error = '';
    try {
      const response = await context.request.get(`${front}${target}`, { timeout: 25000, maxRedirects: 8 });
      status = response.status();
      finalUrl = response.url();
    } catch (err) {
      error = String(err?.message || err);
    }
    const item = { target, status, finalUrl, error, owners };
    results.push(item);
    if (error || status >= 400 || status === 0) failures.push(item);
  }
  await writeFile(`${artifactDir}/internal-link-qa.json`, JSON.stringify({ results, failures }, null, 2));
  log('QA', { checked: results.length, failures: failures.length });
  if (failures.length) {
    console.error('PTSCPS_LINK_QA_FAILURES=' + JSON.stringify(failures.slice(0, 50)));
    throw Error(`Internal link QA failed: ${failures.length} unresolved/broken link target(s)`);
  }
  return results;
}

try {
  await login();
  const n = await nonce();
  const pages = await collect('pages', n, 'id,slug,status,content,acf');
  const categories = await listProductCategories(n);
  const products = await collect('product', n, 'id,slug,status,title,content,excerpt,product_categories,product_cat,acf');
  log('INVENTORY', { pages: pages.length, categories: categories.length, products: products.length });

  prepareRoutes(pages, categories, products);
  await repairContent(n, pages, categories, products);
  await repairHomepageTables(pages, products, categories, n);
  await writeFile(`${artifactDir}/repairs.json`, JSON.stringify({ repairs, ambiguities }, null, 2));
  log('REPAIR', { writes, replacements: repairs.length, ambiguous: ambiguities.length });

  const records = await collectLinkRecords(pages, categories, products);
  await writeFile(`${artifactDir}/link-records.json`, JSON.stringify(records, null, 2));
  if (writes > 0 || forceBuild) await triggerBuildAndWait();
  else log('BUILD', 'NO_CMS_CHANGES_SKIP_TRIGGER');
  await waitFrontReady();
  await qaLinks(records);
  await qaHomepageLinks();
  log('RESULT', { status: 'PASS', writes, replacements: repairs.length });
} finally {
  await browser.close();
}
