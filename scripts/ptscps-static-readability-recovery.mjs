import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
const githubToken = String(process.env.GITHUB_TOKEN || '').trim();
const githubRepository = String(process.env.GITHUB_REPOSITORY || '').trim();
assert(/^https:\/\/[^/]+$/.test(wp) && /^https:\/\/[^/]+$/.test(front) && wp !== front,
  'PTSCPS_STATIC_RECOVERY=BLOCKED invalid configured origins');
assert(user && pass, 'PTSCPS_STATIC_RECOVERY=BLOCKED missing WordPress credentials');
assert(githubToken && githubRepository === 'ngocnhanvo/ptscps-actions',
  'PTSCPS_STATIC_RECOVERY=BLOCKED invalid GitHub build monitor context');

const artifactDir = 'artifacts/ptscps-static-readability-recovery';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => wp + path;
const log = (key, value) => console.log(`PTSCPS_STATIC_RECOVERY_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
const acfValue = value => String(value?.value ?? value?.ID ?? value?.id ?? value ?? '').trim();

const specs = [
  { id: 84805, slug: 'sitemap', title: 'Sitemap', key: 'sitemap' },
  { id: 84807, slug: 'dieu-khoan-dich-vu', title: 'Điều khoản dịch vụ', key: 'dieu-khoan-dich-vu' },
  { id: 84809, slug: 'chinh-sach-bao-mat', title: 'Chính sách bảo mật', key: 'chinh-sach-bao-mat' },
];

const CSS_START = '/* PTSCPS_STATIC_READABILITY_START */';
const CSS_END = '/* PTSCPS_STATIC_READABILITY_END */';
const CSS = `${CSS_START}
.ptscps-readable-page{background:#fff;color:#334155;padding:48px 20px 72px}
.ptscps-readable-page__inner{width:100%;max-width:1180px;margin:0 auto}
.ptscps-readable-page__header{max-width:900px;margin:0 0 32px;padding:0 0 18px;border-bottom:1px solid #dbe4ee}
.ptscps-readable-page__title{margin:0;color:#102a43;font-size:clamp(2rem,4vw,3rem);font-weight:750;line-height:1.12;letter-spacing:-.025em}
.ptscps-readable-page__body{max-width:900px;color:#334155;font-size:17px;line-height:1.8}
.ptscps-readable-page--sitemap .ptscps-readable-page__body{max-width:1180px}
.ptscps-readable-page__body>*:first-child{margin-top:0}
.ptscps-readable-page__body>*:last-child{margin-bottom:0}
.ptscps-readable-page__body p{margin:0 0 1.05rem}
.ptscps-readable-page__body h1,.ptscps-readable-page__body h2,.ptscps-readable-page__body h3,.ptscps-readable-page__body h4,.ptscps-readable-page__body h5,.ptscps-readable-page__body h6{color:#102a43;font-weight:700;line-height:1.3}
.ptscps-readable-page__body h1{font-size:2rem;margin:2.2rem 0 1rem}
.ptscps-readable-page__body h2{font-size:1.75rem;margin:2.2rem 0 .9rem}
.ptscps-readable-page__body h3{font-size:1.45rem;margin:2rem 0 .8rem;padding-left:14px;border-left:4px solid #1f5fae}
.ptscps-readable-page__body h4{font-size:1.2rem;margin:1.8rem 0 .7rem}
.ptscps-readable-page__body h5,.ptscps-readable-page__body h6{font-size:1.05rem;margin:1.5rem 0 .6rem}
.ptscps-readable-page__body ul,.ptscps-readable-page__body ol{margin:.75rem 0 1.25rem;padding-left:1.6rem}
.ptscps-readable-page__body ul{list-style:disc}
.ptscps-readable-page__body ul ul{list-style:circle;margin:.45rem 0 .65rem}
.ptscps-readable-page__body ol{list-style:decimal}
.ptscps-readable-page__body li{padding-left:.18rem}
.ptscps-readable-page__body li+li{margin-top:.45rem}
.ptscps-readable-page__body a{color:#1557a5;text-decoration:underline;text-decoration-thickness:1px;text-underline-offset:3px}
.ptscps-readable-page__body a:hover{color:#0b3c78;text-decoration-thickness:2px}
.ptscps-readable-page__body a:focus-visible{outline:2px solid #1f5fae;outline-offset:3px;border-radius:2px}
.ptscps-readable-page__body table{width:100%;border-collapse:collapse;margin:1.25rem 0 1.75rem;font-size:.96em}
.ptscps-readable-page__body th,.ptscps-readable-page__body td{border:1px solid #dbe4ee;padding:.7rem .8rem;text-align:left;vertical-align:top}
.ptscps-readable-page__body th{background:#f5f8fc;color:#102a43;font-weight:700}
.ptscps-readable-page__body blockquote{margin:1.25rem 0;padding:.9rem 1.1rem;border-left:4px solid #1f5fae;background:#f7faff;color:#42566b}
.ptscps-sitemap-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px;align-items:start}
.ptscps-sitemap-group{min-width:0;padding:22px 22px 18px;border:1px solid #dbe4ee;border-radius:14px;background:#f9fbfd;box-shadow:0 8px 24px rgba(15,42,67,.05)}
.ptscps-readable-page__body .ptscps-sitemap-group__title{margin:0 0 .8rem;padding:0 0 .7rem;border:0;border-bottom:1px solid #dbe4ee;font-size:1.15rem;line-height:1.35}
.ptscps-sitemap-group__title a,.ptscps-sitemap-group__title span{font-weight:750;text-decoration:none;color:#102a43}
.ptscps-sitemap-group ul{margin:.65rem 0 0;padding-left:1.25rem}
.ptscps-sitemap-group li+li{margin-top:.4rem}
.ptscps-sitemap-group ul ul{margin:.4rem 0 .55rem;padding-left:1.15rem}
@media (min-width:1100px){.ptscps-sitemap-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
@media (max-width:700px){.ptscps-readable-page{padding:34px 16px 54px}.ptscps-readable-page__header{margin-bottom:24px;padding-bottom:14px}.ptscps-readable-page__title{font-size:2rem}.ptscps-readable-page__body{font-size:16px;line-height:1.72}.ptscps-readable-page__body h2{font-size:1.5rem}.ptscps-readable-page__body h3{font-size:1.3rem}.ptscps-readable-page__body h4{font-size:1.12rem}.ptscps-readable-page__body ul,.ptscps-readable-page__body ol{padding-left:1.35rem}.ptscps-sitemap-grid{grid-template-columns:1fr;gap:14px}.ptscps-sitemap-group{padding:18px 18px 15px}}
${CSS_END}`;

const esc = value => String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

function mergeCss(value) {
  const cleaned = String(value || '').replace(/\/\* PTSCPS_STATIC_READABILITY_START \*\/[\s\S]*?\/\* PTSCPS_STATIC_READABILITY_END \*\//g, '').trim();
  return [cleaned, CSS].filter(Boolean).join('\n\n');
}

function wrapPage(body, spec) {
  return `<section class="ptscps-readable-page ptscps-readable-page--${spec.slug}" data-ptscps-readable-page="1"><div class="ptscps-readable-page__inner"><header class="ptscps-readable-page__header"><h1 class="ptscps-readable-page__title">${esc(spec.title)}</h1></header><div class="ptscps-readable-page__body">${String(body || '').trim()}</div></div></section>`;
}

function safeHref(raw) {
  const value = String(raw || '').trim();
  if (!value || value === '#') return '';
  try {
    const url = new URL(value, front);
    if (url.origin === front || url.origin === wp) return `${url.pathname}${url.search}${url.hash}` || '/';
    return url.href;
  } catch { return ''; }
}

function renderNested(items) {
  const rows = [];
  for (const item of items || []) {
    const label = String(item?.label || item?.title || '').trim();
    if (!label) continue;
    const href = safeHref(item?.href || item?.url || item?.slug || '');
    const labelHtml = href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
    const children = renderNested(item?.children || []);
    rows.push(`<li>${labelHtml}${children}</li>`);
  }
  return rows.length ? `<ul>${rows.join('')}</ul>` : '';
}

function buildSitemap(menuItems) {
  const cards = [];
  for (const item of menuItems || []) {
    const label = String(item?.label || item?.title || '').trim();
    if (!label) continue;
    const href = safeHref(item?.href || item?.url || item?.slug || '');
    const heading = href ? `<a href="${esc(href)}">${esc(label)}</a>` : `<span>${esc(label)}</span>`;
    const children = renderNested(item?.children || []);
    cards.push(`<section class="ptscps-sitemap-group"><h2 class="ptscps-sitemap-group__title">${heading}</h2>${children}</section>`);
  }
  cards.push(`<section class="ptscps-sitemap-group"><h2 class="ptscps-sitemap-group__title"><span>Thông tin &amp; chính sách</span></h2><ul><li><a href="/dieu-khoan-dich-vu">Điều khoản dịch vụ</a></li><li><a href="/chinh-sach-bao-mat">Chính sách bảo mật</a></li></ul></section>`);
  assert(cards.length >= 4, `Sitemap menu groups unexpectedly short: ${cards.length}`);
  return `<nav class="ptscps-sitemap-grid" aria-label="Sitemap">${cards.join('')}</nav>`;
}

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
  const menus = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_nonce_probe=${Date.now()}`), {
    timeout: 30000, headers: { 'Cache-Control': 'no-cache' },
  }).catch(() => null);
  let menuId = 0;
  if (menus?.ok()) menuId = Number((await menus.json())?.menus?.Header?.vi?.id || 0);
  const paths = [
    ...(menuId ? [`/wp-admin/nav-menus.php?action=edit&menu=${menuId}&esc_full_admin=1`] : []),
    '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1',
  ];
  for (const path of paths) {
    await page.goto(uri(path), { waitUntil: 'domcontentloaded', timeout: 50000 });
    const value = await page.evaluate(() => String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(value)) {
      log('NONCE_SOURCE', path.split('?')[0]);
      return value;
    }
  }
  const fallback = await page.request.post(uri('/wp-admin/admin-ajax.php'), {
    form: { action: 'rest-nonce' }, timeout: 30000,
  }).catch(() => null);
  const value = fallback?.ok() ? (await fallback.text()).trim() : '';
  assert(/^[A-Za-z0-9_-]{8,32}$/.test(value), 'Authenticated REST nonce unavailable');
  log('NONCE_SOURCE', 'admin-ajax');
  return value;
}

async function api(method, path, n, data, timeout = 60000) {
  const response = await page.request.fetch(uri(path), {
    method, timeout, headers: { 'X-WP-Nonce': n, 'Cache-Control': 'no-cache' },
    ...(data === undefined ? {} : { data }),
  });
  const body = await response.json().catch(() => null);
  return { response, body };
}

async function readMenus() {
  const response = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_readability=${Date.now()}`), {
    timeout: 30000, headers: { 'Cache-Control': 'no-cache' },
  });
  assert(response.ok(), `Menu API HTTP ${response.status()}`);
  const body = await response.json();
  assert(body?.success === true && body?.menus?.Header?.vi?.items, 'Header.vi menu unavailable');
  return body.menus.Header.vi.items;
}

async function repairAndTouchPages(n) {
  const menuItems = await readMenus();
  const results = [];
  for (const spec of specs) {
    const current = await api('GET', `/wp-json/wp/v2/pages/${spec.id}?context=edit&_fields=id,slug,status,title,content,acf`, n);
    assert(current.response.ok() && Number(current.body?.id) === spec.id && current.body?.slug === spec.slug,
      `Cannot read target Page ${spec.slug}`);
    const raw = String(current.body?.content?.raw ?? current.body?.content?.rendered ?? '').trim();
    const currentCss = acfValue(current.body?.acf?.cssmore);
    const action = acfValue(current.body?.acf?.action) || 'IntroPage';
    const key = acfValue(current.body?.acf?.key) || spec.key;
    const lang = acfValue(current.body?.acf?.product_lang) || 'vi';
    let content = raw;
    if (spec.slug === 'sitemap') {
      content = wrapPage(buildSitemap(menuItems), spec);
    } else if (!raw.includes('data-ptscps-readable-page="1"')) {
      content = wrapPage(raw, spec);
    }
    const cssmore = mergeCss(currentCss);
    const saved = await api('POST', `/wp-json/wp/v2/pages/${spec.id}`, n, {
      title: spec.title, status: 'publish', content,
      acf: { product_lang: lang, action, key, cssmore },
    }, 90000);
    assert(saved.response.ok(), `Cannot save readable Page ${spec.slug}: HTTP ${saved.response.status()}`);
    const verify = await api('GET', `/wp-json/wp/v2/pages/${spec.id}?context=edit&_fields=id,slug,status,title,content,acf`, n);
    const verifyContent = String(verify.body?.content?.raw ?? verify.body?.content?.rendered ?? '');
    const verifyCss = acfValue(verify.body?.acf?.cssmore);
    assert(verify.response.ok() && verify.body?.status === 'publish' && verifyContent.includes('data-ptscps-readable-page="1"')
      && verifyCss.includes(CSS_START), `Readable Page readback failed ${spec.slug}`);
    if (spec.slug === 'sitemap') assert(verifyContent.includes('ptscps-sitemap-grid'), 'Semantic sitemap grid did not persist');
    results.push({ id: spec.id, slug: spec.slug });
    log('CMS_PAGE', { id: spec.id, slug: spec.slug, state: 'PASS_TOUCHED' });
  }

  const logsResponse = await page.request.get(uri(`/wp-json/astro/v1/get-page-logs?_readability=${Date.now()}`), {
    timeout: 45000, headers: { 'Cache-Control': 'no-cache' },
  });
  assert(logsResponse.ok(), `Page log endpoint HTTP ${logsResponse.status()}`);
  const logs = await logsResponse.json();
  assert(Array.isArray(logs), 'Page log endpoint returned non-array');
  for (const spec of specs) {
    const item = logs.find(row => Number(row?.id) === spec.id && row?.action === 'modify');
    assert(item?.page?.id && String(item?.page?.content?.rendered || '').includes('data-ptscps-readable-page="1"'),
      `Pending page modify log missing readable payload for ${spec.slug}`);
  }
  log('PAGE_LOGS', { state: 'PASS', ids: specs.map(x => x.id), pending: logs.length });
  return results;
}

async function nativeStatus() {
  return page.evaluate(async () => {
    const cfg = globalThis.vcsBuild || {};
    if (!cfg.ajax_url || !cfg.nonce) return { transportError: 'WordPress build AJAX config missing' };
    const body = new URLSearchParams({ action: 'vcs_check_build_status', nonce: String(cfg.nonce) });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(String(cfg.ajax_url), {
        method: 'POST', credentials: 'same-origin',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
        body: body.toString(), signal: controller.signal,
      });
      const text = await response.text();
      let json = null; try { json = JSON.parse(text); } catch {}
      return { httpStatus: response.status, json };
    } catch (error) {
      return { transportError: String(error?.name || error?.message || error) };
    } finally { clearTimeout(timer); }
  });
}

function nativeData(result) {
  assert(!result?.transportError && Number(result?.httpStatus || 0) === 200 && result?.json?.success === true,
    `WordPress build status unavailable: ${result?.transportError || `HTTP ${result?.httpStatus || 0}`}`);
  return result.json.data || {};
}

function runIdFromUrl(value) {
  const match = /\/actions\/runs\/(\d+)/.exec(String(value || ''));
  return match ? Number(match[1]) : 0;
}

async function waitForNativeIdle(maxMs = 12 * 60 * 1000) {
  const deadline = Date.now() + maxMs;
  let last = null;
  while (Date.now() < deadline) {
    const data = nativeData(await nativeStatus());
    last = data;
    const active = Boolean(data.build_active);
    log('BUILD_NATIVE_STATUS', { active, status: data.status || '', runId: runIdFromUrl(data.dashboard_url), pending: data.pending_count ?? null });
    if (!active) return data;
    await sleep(10000);
  }
  throw new Error(`Existing WordPress build did not settle before deadline: ${JSON.stringify({ status: last?.status, dashboard_url: last?.dashboard_url })}`);
}

async function githubRun(runId) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(`https://api.github.com/repos/${githubRepository}/actions/runs/${runId}`, {
      headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${githubToken}`,
        'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'ptscps-static-readability-recovery' },
      signal: controller.signal,
    });
    const body = await response.json().catch(() => null);
    assert(response.ok && body?.id, `GitHub run status HTTP ${response.status}`);
    return body;
  } finally { clearTimeout(timer); }
}

async function triggerAndWaitBuild() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#vcs-build-btn-main').waitFor({ state: 'attached', timeout: 30000 });
  let initial = await page.evaluate(() => ({
    configured: globalThis.vcsBuild?.build_configured,
    active: globalThis.vcsBuild?.initial_active,
    pending: globalThis.vcsBuild?.pending_count,
  }));
  assert(initial.configured === true || initial.configured === 1 || initial.configured === '1', 'WordPress Build Website is not configured');
  if (initial.active) {
    log('BUILD_WAIT_EXISTING', initial);
    await waitForNativeIdle();
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 50000 });
    initial = await page.evaluate(() => ({
      configured: globalThis.vcsBuild?.build_configured,
      active: globalThis.vcsBuild?.initial_active,
      pending: globalThis.vcsBuild?.pending_count,
    }));
  }
  assert(!initial.active, 'WordPress build still active after native reconciliation');
  assert(Number(initial.pending || 0) >= specs.length,
    `Expected at least ${specs.length} pending Page logs before build, got ${initial.pending || 0}`);
  const button = page.locator('#vcs-build-btn-main');
  assert(!await button.isDisabled(), 'WordPress Build Website button disabled with pending changes');
  const ack = page.waitForResponse(response => response.url().startsWith(wp + '/wp-admin/admin-ajax.php')
    && response.request().method() === 'POST'
    && String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
  await button.click();
  const response = await ack;
  const body = await response.json().catch(() => null);
  assert(response.ok() && body?.success === true && body?.data?.build_active === true,
    `WordPress Build Website rejected trigger HTTP=${response.status()}`);
  log('BUILD_TRIGGERED', { state: 'TRIGGERED_VIA_WORDPRESS', pending: body.data?.pending_count ?? null });

  const discoverDeadline = Date.now() + 180000;
  let runId = 0;
  let runUrl = '';
  while (Date.now() < discoverDeadline && !runId) {
    const data = nativeData(await nativeStatus());
    runUrl = String(data.dashboard_url || '');
    runId = runIdFromUrl(runUrl);
    if (!runId) await sleep(5000);
  }
  assert(runId > 0, 'WordPress build run was not discovered within 180s');
  log('BUILD_RUN_LOCKED', { runId, runUrl });

  const deadline = Date.now() + 15 * 60 * 1000;
  let lastState = '';
  while (Date.now() < deadline) {
    const run = await githubRun(runId);
    assert(run.event === 'repository_dispatch' && run.path === '.github/workflows/ptscps-production-deploy.yml',
      `Locked run is not PTSCPS production deployment: ${run.event} ${run.path}`);
    const state = `${run.status}:${run.conclusion || ''}`;
    if (state !== lastState) {
      log('BUILD_RUN_STATUS', { runId, status: run.status, conclusion: run.conclusion || '' });
      lastState = state;
    }
    if (run.status === 'completed') {
      assert(run.conclusion === 'success', `Astro build ${runId} completed with ${run.conclusion}`);
      break;
    }
    await sleep(10000);
  }
  const finalRun = await githubRun(runId);
  assert(finalRun.status === 'completed' && finalRun.conclusion === 'success', `Astro build ${runId} exceeded deadline`);
  await waitForNativeIdle(90000);
  log('BUILD_SUCCESS', { runId, runUrl: finalRun.html_url });
  return { runId, runUrl: finalRun.html_url };
}

async function waitForReadable(qa, spec) {
  const deadline = Date.now() + 90000;
  let lastStatus = 0;
  while (Date.now() < deadline) {
    const response = await qa.goto(`${front}/${spec.slug}?_readability_ready=${Date.now()}`, { waitUntil: 'load', timeout: 45000 }).catch(() => null);
    lastStatus = response?.status() || 0;
    const marker = await qa.locator('[data-ptscps-readable-page="1"]').count().catch(() => 0);
    if (lastStatus === 200 && marker === 1) return;
    await sleep(5000);
  }
  throw new Error(`DEPLOY_TIMEOUT readable marker ${spec.slug} http=${lastStatus}`);
}

async function inspect(qa, spec, label) {
  const root = qa.locator('[data-ptscps-readable-page="1"]');
  assert(await root.count() === 1, `QA_FAILED readable wrapper ${spec.slug} ${label}`);
  const title = (await root.locator('.ptscps-readable-page__title').innerText()).trim();
  assert.equal(title, spec.title, `QA_FAILED title ${spec.slug} ${label}`);
  const metrics = await root.evaluate((el, slug) => {
    const body = el.querySelector('.ptscps-readable-page__body');
    const h1 = el.querySelector('.ptscps-readable-page__title');
    const bodyRect = body?.getBoundingClientRect();
    const bodyStyle = body ? getComputedStyle(body) : null;
    const h1Style = h1 ? getComputedStyle(h1) : null;
    const grid = el.querySelector('.ptscps-sitemap-grid');
    const gridStyle = grid ? getComputedStyle(grid) : null;
    const rootRect = el.getBoundingClientRect();
    const footer = document.querySelector('#footer-contact');
    const footerRect = footer?.getBoundingClientRect();
    return {
      viewport: innerWidth,
      bodyLeft: bodyRect?.left ?? 0,
      bodyRight: bodyRect?.right ?? 0,
      bodyWidth: bodyRect?.width ?? 0,
      bodyFont: parseFloat(bodyStyle?.fontSize || '0'),
      bodyLine: parseFloat(bodyStyle?.lineHeight || '0'),
      h1Font: parseFloat(h1Style?.fontSize || '0'),
      h1Weight: Number(h1Style?.fontWeight || 0),
      textLength: (body?.textContent || '').trim().length,
      headingCount: body?.querySelectorAll('h2,h3,h4').length || 0,
      paragraphCount: body?.querySelectorAll('p').length || 0,
      listCount: body?.querySelectorAll('ul,ol').length || 0,
      linkCount: body?.querySelectorAll('a').length || 0,
      sitemapGroups: body?.querySelectorAll('.ptscps-sitemap-group').length || 0,
      gridColumns: gridStyle?.gridTemplateColumns ? gridStyle.gridTemplateColumns.split(' ').filter(Boolean).length : 0,
      overflow: document.documentElement.scrollWidth - innerWidth,
      footerGap: footerRect ? Math.max(0, footerRect.top - rootRect.bottom) : -1,
      slug,
    };
  }, spec.slug);
  assert(metrics.textLength > 80, `QA_FAILED content too short ${spec.slug} ${label}`);
  assert(metrics.bodyLeft >= 12 && metrics.bodyRight <= metrics.viewport + 1 && metrics.bodyWidth <= metrics.viewport - 24,
    `QA_FAILED content width ${spec.slug} ${label}`);
  assert(metrics.h1Font >= (label === 'mobile' ? 28 : 30) && metrics.h1Weight >= 600,
    `QA_FAILED H1 hierarchy ${spec.slug} ${label}`);
  assert(metrics.bodyFont >= 15 && metrics.bodyLine >= metrics.bodyFont * 1.45,
    `QA_FAILED body typography ${spec.slug} ${label}`);
  assert(metrics.overflow <= 2, `QA_FAILED horizontal overflow ${spec.slug} ${label}`);
  assert(metrics.footerGap >= 0 && metrics.footerGap <= 2,
    `QA_FAILED footer gap ${spec.slug} ${label}: ${metrics.footerGap}px`);
  if (spec.slug === 'sitemap') {
    assert(metrics.sitemapGroups >= 4 && metrics.listCount >= 2 && metrics.linkCount >= 8,
      `QA_FAILED sitemap hierarchy ${label}: ${JSON.stringify(metrics)}`);
    if (label === 'desktop') assert(metrics.gridColumns >= 2, `QA_FAILED sitemap desktop grid columns=${metrics.gridColumns}`);
    if (label === 'mobile') assert(metrics.gridColumns === 1, `QA_FAILED sitemap mobile grid columns=${metrics.gridColumns}`);
  }
  await qa.screenshot({ path: `${artifactDir}/${spec.slug}-${label}.png`, fullPage: true });
  log('QA_PASS', { route: `/${spec.slug}`, label, metrics });
}

async function productionQa() {
  const desktop = await context.newPage();
  for (const spec of specs) {
    await waitForReadable(desktop, spec);
    await inspect(desktop, spec, 'desktop');
  }
  await desktop.close();
  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  for (const spec of specs) {
    const response = await mobile.goto(`${front}/${spec.slug}?_readability_mobile=${Date.now()}`, { waitUntil: 'load', timeout: 45000 });
    assert(response?.status() === 200, `QA_FAILED mobile HTTP ${spec.slug}`);
    await inspect(mobile, spec, 'mobile');
  }
  await mobile.close();
  log('QA_RESULT', 'PASS');
}

try {
  await login();
  const n = await nonce();
  await repairAndTouchPages(n);
  const build = await triggerAndWaitBuild();
  await productionQa();
  log('RESULT', { state: 'PASS', build });
} finally {
  await browser.close();
}
