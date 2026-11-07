import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const user = String(process.env.WP_ADMIN_USERNAME || '');
const pass = String(process.env.WP_ADMIN_PASSWORD || '');
assert(wp.startsWith('https://') && front.startsWith('https://') && wp !== front && user && pass,
  'Missing validated PTSCPS origins or WordPress credentials');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 950 } });
const page = await context.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => wp + path;
const log = (key, value) => console.log(`PTSCPS_NEWS_EN_REPAIR_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);

const routes = [
  { label: 'News', en: '/news', vi: '/tin-tuc', h1: 'News', legacy: '/tin-tuc?lang=en' },
  { label: 'Company Activities', en: '/c/news/company-activities', vi: '/c/tin-tuc/hoat-dong-cua-cong-ty', h1: 'Company Activities', legacy: '/c/tin-tuc/hoat-dong-cua-cong-ty?lang=en' },
  { label: 'Domestic and Regional', en: '/c/news/domestic-and-regional', vi: '/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc', h1: 'Domestic and Regional', legacy: '/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc?lang=en' },
  { label: 'Invitation for Quotation', en: '/invitation-for-quotation', vi: '/thu-moi-chao-gia', h1: 'Invitation for Quotation', legacy: '/thu-moi-chao-gia?lang=en' },
];
const routeByLabel = new Map(routes.map(item => [item.label, item]));

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

async function readMenus() {
  const response = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_news_en_repair=${Date.now()}`), {
    timeout: 30000, headers: { 'Cache-Control': 'no-cache' },
  });
  assert(response.ok(), `Menu API HTTP ${response.status()}`);
  const data = await response.json();
  assert(data?.success === true, 'Menu API contract changed');
  return data.menus || {};
}

function normalizedHref(value) {
  const raw = String(value || '').trim();
  if (!raw || raw === '#') return raw || '#';
  const url = new URL(raw, wp);
  if ([new URL(wp).origin, new URL(front).origin].includes(url.origin)) {
    return `${url.pathname}${url.search}${url.hash}`;
  }
  return url.href;
}

function buildDesiredTree(items, parentKey = '') {
  const seen = new Map();
  const walk = (nodes, parent) => (nodes || []).map((item, index) => {
    const label = String(item.label || '').trim();
    assert(label, `Header.en item missing label at ${parent}/${index}`);
    const key = `${parent}/${label}[${index}]`;
    const route = routeByLabel.get(label);
    if (route) seen.set(label, (seen.get(label) || 0) + 1);
    const href = route?.en || normalizedHref(item.href || item.slug || '#');
    return {
      key,
      lang: 'en',
      label,
      href,
      linkMode: href === '#' ? 'none' : 'custom',
      target: String(item.target || ''),
      children: walk(item.children || [], key),
    };
  });
  const tree = walk(items, parentKey);
  for (const route of routes) assert.equal(seen.get(route.label) || 0, 1, `Header.en must contain exactly one ${route.label}`);
  return tree;
}

function findByLabel(nodes, label, matches = []) {
  for (const node of nodes || []) {
    if (String(node.label || '').trim() === label) matches.push(node);
    findByLabel(node.children || [], label, matches);
  }
  return matches;
}

async function repairHeader() {
  const menus = await readMenus();
  const en = menus?.Header?.en;
  assert(en?.id && Array.isArray(en.items), 'Header.en menu is unavailable');
  const desiredTree = buildDesiredTree(en.items || []);
  const alreadyCorrect = routes.every(route => {
    const match = findByLabel(en.items, route.label);
    return match.length === 1 && normalizedHref(match[0].href || match[0].slug || '') === route.en;
  });
  if (alreadyCorrect) {
    log('MENU', { state: 'ALREADY_CORRECT', menuId: en.id });
    return false;
  }

  await page.goto(uri(`/wp-admin/nav-menus.php?action=edit&menu=${Number(en.id)}&esc_full_admin=1`), {
    waitUntil: 'domcontentloaded', timeout: 50000,
  });
  const importButton = page.locator('#esc-pse-menu-json-preview');
  assert(await importButton.count() === 1, 'ESC menu JSON import control unavailable');
  const nonce = String(await importButton.getAttribute('data-nonce') || '').trim();
  const menuId = String(await importButton.getAttribute('data-menu-id') || '').trim();
  assert(/^\d+$/.test(menuId) && Number(menuId) === Number(en.id), 'ESC Header.en import menu ID mismatch');
  assert(nonce.length >= 8, 'ESC Header.en import nonce unavailable');
  const json = JSON.stringify(desiredTree);
  const ajax = async (action, extra = {}) => {
    const response = await page.request.post(uri('/wp-admin/admin-ajax.php'), {
      timeout: 60000,
      form: { action, nonce, menu_id: menuId, json, ...extra },
    });
    const body = await response.json().catch(() => null);
    assert(response.ok() && body?.success === true,
      `ESC Header.en ${action} failed HTTP=${response.status()} message=${body?.data?.message || 'unknown'}`);
    return body;
  };
  const preview = await ajax('esc_pse_menu_json_preview');
  assert(Number(preview?.data?.stats?.total || 0) > 0, 'ESC Header.en preview returned zero items');
  await ajax('esc_pse_menu_json_replace', { confirm: 'replace' });

  for (let attempt = 1; attempt <= 10; attempt++) {
    const after = (await readMenus())?.Header?.en;
    const correct = after?.id && Number(after.id) === Number(en.id) && routes.every(route => {
      const match = findByLabel(after.items || [], route.label);
      return match.length === 1 && normalizedHref(match[0].href || match[0].slug || '') === route.en;
    });
    if (correct) {
      log('MENU', { state: 'REPLACED_AND_READBACK_PASS', menuId: en.id, routes: routes.map(x => [x.label, x.en]) });
      return true;
    }
    if (attempt < 10) await sleep(700 * attempt);
  }
  throw new Error('Header.en canonical News route readback failed');
}

async function readWordPressBuildStatus() {
  return page.evaluate(async () => {
    const cfg = globalThis.vcsBuild || {};
    if (!cfg.ajax_url || !cfg.nonce) return { success: false, data: null, transportError: 'WordPress build status config missing' };
    const body = new URLSearchParams({ action: 'vcs_check_build_status', nonce: String(cfg.nonce) });
    try {
      const response = await fetch(String(cfg.ajax_url), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(),
      });
      return await response.json();
    } catch (error) {
      return { success: false, data: null, transportError: String(error?.message || error) };
    }
  });
}

async function reconcileBuildPage() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    const state = await page.evaluate(() => ({
      configured: globalThis.vcsBuild?.build_configured,
      active: globalThis.vcsBuild?.initial_active,
      pending: globalThis.vcsBuild?.pending_count,
      disabled: Boolean(document.querySelector('#vcs-build-btn-main')?.disabled),
    }));
    assert(state.configured === true || state.configured === 1 || state.configured === '1', 'WordPress Build Website is not configured');
    if (!state.active && !state.disabled) return state;

    const status = await readWordPressBuildStatus();
    assert(status?.success === true && status?.data, `Cannot reconcile WordPress build state: ${status?.transportError || 'invalid response'}`);
    log('BUILD_RECONCILE', { attempt, status: status.data.status, buildActive: Boolean(status.data.build_active), runUrl: status.data.dashboard_url || '' });
    if (status.data.status === 'loading' && status.data.build_active) {
      throw new Error(`A real WordPress-triggered build is still active: ${status.data.dashboard_url || 'run URL unavailable'}`);
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 50000 });
    await sleep(500);
  }
  throw new Error('WordPress Build Website remained disabled after stale-state reconciliation');
}

async function triggerBuild() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const button = page.locator('#vcs-build-btn-main');
  assert(await button.count() === 1, 'WordPress Build Website button unavailable');
  const state = await reconcileBuildPage();
  const force = page.locator('#vcs-force-build');
  if (Number(state.pending || 0) === 0) {
    assert(await force.count() === 1 && !await force.isDisabled(), 'Build ngoại lệ control unavailable with empty queue');
    if (!await force.isChecked()) await force.check();
  }
  const ack = page.waitForResponse(response => response.url().startsWith(wp + '/wp-admin/admin-ajax.php')
    && response.request().method() === 'POST'
    && String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
  await button.click();
  const response = await ack;
  const body = await response.json().catch(() => null);
  assert(response.ok() && body?.success, 'WordPress Build Website rejected trigger');
  log('BUILD_TRIGGER', Number(state.pending || 0) === 0 ? 'FORCE_EMPTY_QUEUE' : 'NORMAL');
  const token = String(process.env.SOURCE_REPO_PAT || '').trim();
  assert(token, 'SOURCE_REPO_PAT is required to monitor the exact Astro build run');
  const build = await waitForWordPressBuild({
    page,
    log: (key, value) => log(`BUILD_${key}`, value),
    githubRepository: 'ngocnhanvo/ptscps-astro',
    githubToken: token,
  });
  log('BUILD_RESULT', build);
  return build;
}

async function qaProduction() {
  const qa = await context.newPage();
  try {
    for (const route of routes) {
      const response = await qa.goto(`${front}${route.en}?_qa_news_en=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 50000 });
      assert.equal(response?.status(), 200, `${route.en}: HTTP ${response?.status()}`);
      assert.equal(new URL(qa.url()).pathname, route.en, `${route.en}: pathname mismatch`);
      assert.equal(new URL(qa.url()).searchParams.has('lang'), false, `${route.en}: lang query leaked`);
      assert.equal(String(await qa.locator('html').getAttribute('lang') || '').split('-')[0].toLowerCase(), 'en', `${route.en}: html lang mismatch`);
      const h1 = String(await qa.locator('main h1').first().textContent() || '').trim().replace(/\s+/g, ' ');
      assert.equal(h1, route.h1, `${route.en}: H1 mismatch`);
      const canonical = await qa.locator('link[rel="canonical"]').getAttribute('href');
      assert(canonical, `${route.en}: canonical missing`);
      const canonicalUrl = new URL(canonical);
      assert.equal(canonicalUrl.pathname, route.en, `${route.en}: canonical pathname mismatch`);
      assert.equal(canonicalUrl.searchParams.has('lang'), false, `${route.en}: canonical lang leaked`);
      const switchLinks = await qa.locator('[data-header-language] a[href]').evaluateAll(nodes => nodes.map(node => node.getAttribute('href')));
      assert(switchLinks.includes(route.vi), `${route.en}: VI counterpart missing; actual=${switchLinks}`);
      assert(switchLinks.includes(route.en), `${route.en}: EN counterpart missing; actual=${switchLinks}`);
      assert(!switchLinks.some(href => String(href || '').includes('lang=')), `${route.en}: language switch still uses ?lang=`);
      log('QA_ROUTE', { route: route.en, h1, status: 200 });

      const legacyResponse = await qa.goto(`${front}${route.legacy}&_qa_news_en_legacy=${Date.now()}`, { waitUntil: 'domcontentloaded', timeout: 50000 });
      assert.equal(legacyResponse?.status(), 200, `${route.legacy}: HTTP ${legacyResponse?.status()}`);
      const finalLegacy = new URL(qa.url());
      assert.equal(finalLegacy.pathname, route.en, `${route.legacy}: legacy redirect identity mismatch`);
      assert.equal(finalLegacy.searchParams.has('lang'), false, `${route.legacy}: legacy redirect retained lang`);
      log('QA_LEGACY_REDIRECT', { from: route.legacy, to: route.en, status: 200 });
    }
    log('QA', 'PASS');
  } finally {
    await qa.close();
  }
}

try {
  await login();
  const changed = await repairHeader();
  log('MENU_CHANGED', changed);
  await triggerBuild();
  await qaProduction();
  log('RESULT', 'PASS');
} finally {
  await browser.close();
}
