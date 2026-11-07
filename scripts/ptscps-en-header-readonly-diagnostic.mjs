import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
assert(wp && front, 'Missing configured origins');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const log = (key, value) => console.log(`EN_HEADER_DIAG_${key}=${JSON.stringify(value)}`);
const acfValue = value => String(value?.value ?? value ?? '').trim();
const safeNode = node => ({
  id: Number(node?.id || 0),
  key: String(node?.key || ''),
  label: String(node?.label || ''),
  lang: String(node?.lang || ''),
  slug: String(node?.slug || ''),
  href: String(node?.href || ''),
  linkMode: String(node?.linkMode || ''),
  linkType: String(node?.linkType || ''),
  header: node?.header,
  children: Array.isArray(node?.children) ? node.children.map(safeNode) : [],
});
const requestJson = async url => {
  const response = await page.request.get(url, { timeout: 30000, headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' } });
  return { status: response.status(), ok: response.ok(), body: response.ok() ? await response.json().catch(() => null) : null };
};
try {
  const menus = await requestJson(`${wp}/wp-json/esc-api/v1/menus?_diag=${Date.now()}`);
  assert(menus.ok && menus.body?.success === true, `WordPress menu REST failed HTTP ${menus.status}`);
  const headerEn = menus.body?.menus?.Header?.en || null;
  log('WORDPRESS_HEADER_EN', headerEn ? { id: headerEn.id, type: headerEn.type, items: (headerEn.items || []).map(safeNode) } : null);

  const pages = await requestJson(`${wp}/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,acf,status&_diag=${Date.now()}`);
  assert(pages.ok && Array.isArray(pages.body), `WordPress Pages REST failed HTTP ${pages.status}`);
  const enPages = pages.body.filter(item => acfValue(item?.acf?.product_lang) === 'en');
  const englishHome = enPages.find(item => acfValue(item?.acf?.key) === 'home') || null;
  log('ENGLISH_HOME', englishHome ? { id: englishHome.id, slug: englishHome.slug, key: acfValue(englishHome.acf?.key), lang: acfValue(englishHome.acf?.product_lang), title: String(englishHome.title?.rendered || '').replace(/<[^>]+>/g, '') } : null);

  const common = await requestJson(`${front}/data/cms-common.json?_diag=${Date.now()}`);
  const menuRows = Array.isArray(common.body?.menus) ? common.body.menus : [];
  const cmsEn = menuRows.filter(item => String(item?.lang || '') === 'en').map(safeNode);
  log('CMS_COMMON', { status: common.status, ok: common.ok, enCount: cmsEn.length, enMenus: cmsEn });

  const routes = [...new Set(['/top-message', englishHome?.slug ? `/${englishHome.slug.replace(/^\/+/, '')}` : null].filter(Boolean))];
  for (const route of routes) {
    const response = await page.goto(`${front}${route}?_diag=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    const snapshot = await page.evaluate(() => {
      const directLabel = li => {
        const candidate = li.querySelector(':scope > button > span:first-child, :scope > a > span:first-child, :scope > span');
        return String(candidate?.textContent || '').trim();
      };
      const top = [...document.querySelectorAll('#desktop-menu > ul > li')].map(li => ({
        label: directLabel(li),
        text: String(li.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 500),
        hidden: li.hasAttribute('hidden'),
      }));
      return {
        htmlLang: document.documentElement.lang,
        title: document.title,
        headerText: String(document.querySelector('#header-navrow')?.innerText || '').trim().replace(/\s+/g, ' '),
        top,
      };
    });
    log('ROUTE', { route, http: response?.status() || 0, ...snapshot });
  }

  const probeRoute = async route => {
    const response = await page.goto(`${front}${route}${route.includes('?') ? '&' : '?'}_diag=${Date.now()}`, {
      waitUntil: 'domcontentloaded', timeout: 50000,
    }).catch(() => null);
    const snapshot = await page.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      main: String(document.querySelector('main')?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 600),
      body: String(document.body?.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 600),
    })).catch(() => ({ title: '', lang: '', main: '', body: '' }));
    log('CONTENT_ROUTE', { route, http: response?.status() || 0, finalUrl: page.url(), ...snapshot });
  };
  for (const route of ['/tin-tuc?lang=en', '/tin-tuc?lang=vi', '/search-jobs']) await probeRoute(route);

  const probeRest = async (key, path) => {
    const response = await page.request.get(`${wp}${path}`, {
      timeout: 30000,
      headers: { 'Cache-Control': 'no-cache', Accept: 'application/json' },
    });
    const text = await response.text().catch(() => '');
    log(key, { http: response.status(), ok: response.ok(), body: text.slice(0, 1200) });
  };
  await probeRest('POSTS_EN', '/wp-json/wp/v2/posts?_embed=true&status=publish&per_page=3&page=1&lang=en&cat=tin-tuc&include_children=true');
  await probeRest('POSTS_VI', '/wp-json/wp/v2/posts?_embed=true&status=publish&per_page=3&page=1&lang=vi&cat=tin-tuc&include_children=true');
  await probeRest('CATEGORY_TIN_TUC', '/wp-json/wp/v2/categories?slug=tin-tuc&hide_empty=false&per_page=20');
  log('RESULT', 'PASS_READ_ONLY');
} finally {
  await browser.close();
}
