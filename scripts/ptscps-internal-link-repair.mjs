import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
const githubToken = String(process.env.GITHUB_TOKEN || '').trim();
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
    // Remove duplicate standalone project text links, not project records/cards.
    // Only these two WordPress service categories are in the write scope.
    const cleanService = ['manpower-supply', 'fpso-fso-om-services'].includes(String(item.slug || ''));
    const projectSlugs = new Set(products.filter(product => product.status === 'publish').map(product => String(product.slug || '')));
    const legacyProjectSlugs = new Set([
      'fso-pps-01-e-translation', 'fso-golden-star-2', '648',
      'fso-ptsc-bien-dong-01-2', 'fpso-ruby-ii-2', 'fso-ptsc-bach-ho-2',
      'fpso-ruby-princess-2', '5454',
    ]);
    let removedTextLinks = 0;
    const withoutDuplicateText = cleanService ? current.replace(/<(p|li)\b[^>]*>[\s\S]*?<\/\1>/gi, block => {
      const links = [...block.matchAll(/<a\b[^>]*\bhref\s*=\s*(["'])([^"']+)\1[^>]*>[\s\S]*?<\/a>/gi)];
      if (!links.length) return block;
      const remainingText = block.replace(/<a\b[^>]*\bhref\s*=\s*(["'])[^"']+\1[^>]*>[\s\S]*?<\/a>/gi, '')
        .replace(/<\/?(?:p|li|span|strong|em|b|i|u|br)\b[^>]*>/gi, '')
        .replace(/&nbsp;|&#160;|\s/gi, '').trim();
      if (remainingText) return block;
      const projectLinksOnly = links.every(match => {
        try {
          const slug = new URL(match[2], front).pathname.replace(/\/+$/, '').split('/').filter(Boolean).at(-1)?.replace(/\.html?$/i, '') || '';
          return projectSlugs.has(slug) || legacyProjectSlugs.has(slug);
        } catch { return false; }
      });
      if (!projectLinksOnly) return block;
      removedTextLinks += links.length;
      return '';
    }) : current;
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

async function openBuildPage() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const button = page.locator('#vcs-build-btn-main');
  assert(await button.count() === 1, 'WordPress Build Website button unavailable');
  const state = await page.evaluate(() => ({
    configured: globalThis.vcsBuild?.build_configured,
    active: globalThis.vcsBuild?.initial_active,
  }));
  assert(state.configured === true || state.configured === 1 || state.configured === '1', 'WordPress Build Website is not configured');
  return { button, state, disabled: await button.isDisabled() };
}

async function waitForBuildSlot() {
  for (let attempt = 1; attempt <= 6; attempt++) {
    const current = await openBuildPage();
    if (!current.state.active && !current.disabled) return current;
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
  const { button } = await waitForBuildSlot();
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
  const products = await collect('product', n, 'id,slug,status,content,excerpt,product_categories,product_cat,acf');
  log('INVENTORY', { pages: pages.length, categories: categories.length, products: products.length });

  prepareRoutes(pages, categories, products);
  await repairContent(n, pages, categories, products);
  await writeFile(`${artifactDir}/repairs.json`, JSON.stringify({ repairs, ambiguities }, null, 2));
  log('REPAIR', { writes, replacements: repairs.length, ambiguous: ambiguities.length });

  const records = await collectLinkRecords(pages, categories, products);
  await writeFile(`${artifactDir}/link-records.json`, JSON.stringify(records, null, 2));
  if (writes > 0) await triggerBuildAndWait();
  else log('BUILD', 'NO_CMS_CHANGES_SKIP_TRIGGER');
  await waitFrontReady();
  await qaLinks(records);
  log('RESULT', { status: 'PASS', writes, replacements: repairs.length });
} finally {
  await browser.close();
}
