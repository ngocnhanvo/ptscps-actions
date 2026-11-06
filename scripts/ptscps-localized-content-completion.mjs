import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const source = 'https://ptscps.com.vn';
const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp.startsWith('https://') && front.startsWith('https://') && wp !== front && user && pass,
  'Missing validated PTSCPS origins or WordPress credentials');

const artifactDir = 'artifacts/ptscps-localized-content-completion';
await mkdir(artifactDir, { recursive: true });
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
const page = await context.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => wp + path;
const plain = value => String(value ?? '')
  .replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
  .replace(/&amp;|&#0?38;|&#x26;/gi, '&')
  .replace(/\s+/g, ' ').trim();
const acfValue = value => String(value?.value ?? value?.ID ?? value?.id ?? value ?? '').trim();
const log = (key, value) => console.log(`PTSCPS_LOCALIZED_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
let writes = 0;
const deferred = [];
const mediaCache = new Map();

async function login() {
  await page.goto(uri('/wp-login.php'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([
    page.waitForLoadState('domcontentloaded'),
    page.locator('#wp-submit').click(),
  ]);
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
  const menus = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_localized_nonce=${Date.now()}`), {
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
  if (/^[A-Za-z0-9_-]{8,32}$/.test(value)) {
    log('NONCE_SOURCE', 'admin-ajax');
    return value;
  }
  throw Error('Authenticated REST nonce unavailable');
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

async function sourceGet(path, expectJson = true) {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await context.request.get(source + path, {
        timeout: 40000,
        headers: { 'Cache-Control': 'no-cache', 'User-Agent': 'PTSCPS localized migration' },
      });
      if (response.ok()) {
        const text = await response.text();
        return { response, body: expectJson ? parseLegacyJson(text, path) : text };
      }
      last = `HTTP ${response.status()}`;
      if (![429, 500, 502, 503, 504].includes(response.status())) break;
    } catch (error) {
      last = String(error?.message || error);
    }
    if (attempt < 3) await sleep(900 * attempt);
  }
  throw Error(`Legacy source failed after 3 attempts: ${path} ${last}`);
}

function parseLegacyJson(text, label) {
  const raw = String(text || '').replace(/^\uFEFF/, '').trim();
  try { return JSON.parse(raw); } catch {}

  // Some legacy WordPress responses append PHP/plugin output after a valid
  // JSON payload. Locate the first complete top-level JSON value instead of
  // assuming the final ]/} in the response belongs to WordPress REST.
  const starts = [raw.indexOf('['), raw.indexOf('{')].filter(index => index >= 0).sort((a, b) => a - b);
  for (const start of starts) {
    const open = raw[start];
    const close = open === '[' ? ']' : '}';
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = start; index < raw.length; index++) {
      const char = raw[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (char === '\\') escaped = true;
        else if (char === '"') quoted = false;
        continue;
      }
      if (char === '"') { quoted = true; continue; }
      if (char === open) depth++;
      else if (char === close) {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(raw.slice(start, index + 1)); } catch { break; }
        }
      }
    }
  }
  const diagnostic = raw.slice(0, 120).replace(/\s+/g, ' ');
  throw Error(`Legacy ${label} returned malformed JSON prefix=${JSON.stringify(diagnostic)}`);
}

async function collectSource(collection, fields) {
  const out = [];
  for (let p = 1; p <= 40; p++) {
    const path = `/wp-json/wp/v2/${collection}?status=publish&per_page=100&page=${p}&_fields=${encodeURIComponent(fields)}`;
    const response = await context.request.get(source + path, { timeout: 40000, headers: { 'Cache-Control': 'no-cache' } });
    if (response.status() === 400 && p > 1) break;
    assert(response.ok(), `Legacy ${collection} HTTP ${response.status()} page=${p}`);
    const rows = parseLegacyJson(await response.text(), `${collection} page=${p}`);
    assert(Array.isArray(rows), `Legacy ${collection} invalid payload`);
    out.push(...rows);
    const max = Number(response.headers()['x-wp-totalpages'] || 1);
    if (p >= max || rows.length < 100) break;
  }
  return out;
}

async function collectTarget(collection, n, fields) {
  const out = [];
  for (let p = 1; p <= 40; p++) {
    const { response, body } = await api('GET', `/wp-json/wp/v2/${collection}?context=edit&status=any&per_page=100&page=${p}&_fields=${encodeURIComponent(fields)}`, n);
    if (response.status() === 400 && p > 1) break;
    assert(response.ok() && Array.isArray(body), `Target ${collection} HTTP ${response.status()} page=${p}`);
    out.push(...body);
    const max = Number(response.headers()['x-wp-totalpages'] || 1);
    if (p >= max || body.length < 100) break;
  }
  return out;
}

const langOf = row => {
  const direct = String(row?.lang || row?.acf?.product_lang?.value || row?.acf?.product_lang || '').trim().toLowerCase();
  if (direct) return direct;
  try { return new URL(row?.link || source).pathname.startsWith('/e/') ? 'en' : 'vi'; } catch { return 'vi'; }
};

function translationId(row, lang) {
  const sourceValue = row?.translations?.[lang];
  const candidates = [sourceValue?.id, sourceValue?.ID, sourceValue?.value, sourceValue];
  for (const value of candidates) {
    const parsed = Number(value || 0);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return 0;
}

const filenameFromUrl = value => {
  try { return decodeURIComponent(new URL(value, source).pathname.split('/').pop() || '').replace(/[\\/]/g, ''); }
  catch { return ''; }
};

const mimeFor = value => {
  const lower = filenameFromUrl(value).toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.pdf')) return 'application/pdf';
  if (lower.endsWith('.docx')) return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if (lower.endsWith('.doc')) return 'application/msword';
  return 'image/jpeg';
};

async function targetMediaByFilename(n, file) {
  const stem = file.replace(/\.[^.]+$/, '');
  const { response, body } = await api('GET', `/wp-json/wp/v2/media?context=edit&search=${encodeURIComponent(stem)}&per_page=100&_fields=id,source_url`, n);
  if (!response.ok() || !Array.isArray(body)) return null;
  return body.find(item => filenameFromUrl(item.source_url) === file) || null;
}

async function ensureMedia(n, sourceUrl, owner) {
  const normalized = new URL(sourceUrl, source).href;
  if (mediaCache.has(normalized)) return mediaCache.get(normalized);
  const parsed = new URL(normalized);
  if (!/(?:^|\.)ptscps\.com\.vn$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/wp-content/uploads/')) {
    return { id: 0, url: normalized };
  }
  const file = filenameFromUrl(normalized);
  if (!file) return { id: 0, url: '' };
  const existing = await targetMediaByFilename(n, file);
  if (existing) {
    const result = { id: Number(existing.id), url: String(existing.source_url) };
    mediaCache.set(normalized, result);
    return result;
  }
  let reason = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const download = await context.request.get(normalized, { timeout: 30000 });
      if (!download.ok()) throw Error(`download HTTP ${download.status()}`);
      const bytes = await download.body();
      if (!bytes?.length || bytes.length > 30 * 1024 * 1024) throw Error('empty/oversized asset');
      const upload = await page.request.post(uri('/wp-json/wp/v2/media'), {
        timeout: 60000,
        headers: {
          'X-WP-Nonce': n,
          'Content-Type': download.headers()['content-type']?.split(';')[0] || mimeFor(normalized),
          'Content-Disposition': `attachment; filename="${file.replace(/"/g, '')}"`,
        },
        data: bytes,
      });
      const saved = await upload.json().catch(() => null);
      if (!upload.ok() || !saved?.id || !saved?.source_url) throw Error(`upload HTTP ${upload.status()}`);
      const result = { id: Number(saved.id), url: String(saved.source_url) };
      mediaCache.set(normalized, result);
      writes++;
      log('MEDIA', { state: 'UPLOADED', file, owner, id: result.id });
      return result;
    } catch (error) {
      reason = String(error?.message || error);
      if (attempt < 3) await sleep(1000 * attempt);
    }
  }
  deferred.push({ type: 'asset', url: normalized, file, owner, attempts: 3, reason });
  log('ASSET_DEFERRED', { file, owner, attempts: 3, reason });
  const result = { id: 0, url: '' };
  mediaCache.set(normalized, result);
  return result;
}

async function localizeHtml(html, n, owner) {
  let output = String(html || '');
  const urlRe = /(?:https?:)?\/\/ptscps\.com\.vn\/wp-content\/uploads\/[^\s"'<>]+|\/wp-content\/uploads\/[^\s"'<>]+/gi;
  const assets = [...new Set(output.match(urlRe) || [])];
  for (const raw of assets) {
    const absolute = new URL(raw, source).href;
    const saved = await ensureMedia(n, absolute, owner);
    if (saved.url) output = output.split(raw).join(saved.url);
    else {
      output = output.replace(/<img\b[^>]*>/gi, tag => tag.includes(raw) ? '' : tag);
      output = output.replace(/<a\b[^>]*>[\s\S]*?<\/a>/gi, tag => tag.includes(raw) ? tag.replace(/^<a\b[^>]*>/i, '').replace(/<\/a>$/i, '') : tag);
      output = output.split(raw).join('');
    }
  }
  return output
    .replace(/https?:\/\/ptscps\.com\.vn(?=\/)/gi, '')
    .replace(/href=(['"])\/e\//gi, 'href=$1/');
}

async function setAcf(n, collection, id, values) {
  const route = `/wp-json/wp/v2/${collection}/${id}`;
  const direct = await api('POST', route, n, { acf: values });
  if (direct.response.ok()) {
    const check = await api('GET', `${route}?context=edit&_fields=id,acf`, n);
    if (check.response.ok() && Object.entries(values).every(([key, value]) => acfValue(check.body?.acf?.[key]) === String(value))) return;
  }
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`), { waitUntil: 'domcontentloaded', timeout: 50000 });
  for (const [key, value] of Object.entries(values)) {
    const field = page.locator(`.acf-field[data-name="${key}"]`).first();
    assert(await field.count() === 1, `Missing ACF ${key} for ${collection} ${id}`);
    const select = field.locator('select').first();
    if (await select.count()) await select.selectOption(String(value));
    else {
      const radio = field.locator(`input[type="radio"][value="${String(value).replace(/"/g, '\\"')}"]`).first();
      if (await radio.count()) await radio.check();
      else {
        const input = field.locator('input[type="text"],input[type="number"],input:not([type]),textarea').first();
        assert(await input.count(), `Unsupported ACF ${key} for ${collection} ${id}`);
        await input.fill(String(value));
      }
    }
  }
  const update = page.locator('#publish').first();
  assert(await update.count(), `Update button missing for ${collection} ${id}`);
  await update.click();
  await sleep(500);
  const check = await api('GET', `${route}?context=edit&_fields=id,acf`, n);
  assert(check.response.ok() && Object.entries(values).every(([key, value]) => acfValue(check.body?.acf?.[key]) === String(value)),
    `ACF readback failed ${collection} ${id}`);
}

async function ensureVietnameseStaticPages(n, sourcePages, targetPages) {
  const specs = [
    { slug: 'sitemap', title: 'Sitemap', key: 'sitemap' },
    { slug: 'dieu-khoan-dich-vu', title: 'Điều khoản dịch vụ', key: 'dieu-khoan-dich-vu' },
    { slug: 'chinh-sach-bao-mat', title: 'Chính sách bảo mật', key: 'chinh-sach-bao-mat' },
  ];
  const results = [];
  for (const spec of specs) {
    const sources = sourcePages.filter(item => item.slug === spec.slug && langOf(item) !== 'en');
    assert(sources.length === 1, `Legacy VI static Page mismatch ${spec.slug}: ${sources.length}`);
    const sourcePage = sources[0];
    const localized = await localizeHtml(sourcePage.content?.rendered || '', n, `page:${spec.slug}`);
    assert(plain(localized).length > 30, `Legacy VI static Page content unexpectedly empty ${spec.slug}`);
    let target = targetPages.find(item => item.slug === spec.slug && acfValue(item.acf?.product_lang) === 'vi')
      || targetPages.find(item => item.slug === spec.slug && !acfValue(item.acf?.product_lang));
    const payload = { title: spec.title, slug: spec.slug, status: 'publish', content: localized };
    if (!target) {
      const created = await api('POST', '/wp-json/wp/v2/pages', n, payload, 90000);
      assert(created.response.ok() && created.body?.id, `Cannot create VI static Page ${spec.slug}`);
      target = created.body; writes++;
    } else {
      const current = String(target.content?.raw ?? target.content?.rendered ?? '');
      if (plain(current) !== plain(localized) || target.status !== 'publish') {
        const updated = await api('POST', `/wp-json/wp/v2/pages/${target.id}`, n, payload, 90000);
        assert(updated.response.ok(), `Cannot update VI static Page ${spec.slug}`);
        target = updated.body; writes++;
      }
    }
    const currentAction = acfValue(target.acf?.action) || 'IntroPage';
    const currentKey = acfValue(target.acf?.key) || spec.key;
    await setAcf(n, 'pages', Number(target.id), { product_lang: 'vi', action: currentAction, key: currentKey });
    const verify = await api('GET', `/wp-json/wp/v2/pages/${target.id}?context=edit&_fields=id,slug,status,title,content,acf`, n);
    assert(verify.response.ok() && verify.body.status === 'publish' && plain(verify.body.content?.raw ?? verify.body.content?.rendered).length > 30,
      `VI static Page readback failed ${spec.slug}`);
    results.push({ slug: spec.slug, id: Number(target.id), action: acfValue(verify.body.acf?.action), key: acfValue(verify.body.acf?.key) });
    log('VI_STATIC_PAGE', { slug: spec.slug, id: target.id, state: 'PASS' });
  }
  return results;
}

const tableIds = html => [...String(html || '').matchAll(/\[(?:table|esc_table)\s+id\s*=\s*["']?([^\s\]"']+)/gi)].map(match => match[1]);
const englishTableId = id => String(id).endsWith('_vi') ? String(id).replace(/_vi$/, '_en') : `${id}_en`;
async function tableExists(id) {
  let last = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await page.request.get(uri(`/wp-json/tablepress/v1/table/${encodeURIComponent(id)}`), { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } });
      if (response.ok()) return true;
      if (response.status() === 404) return false;
      last = `HTTP ${response.status()}`;
    } catch (error) {
      last = String(error?.message || error);
    }
    if (attempt < 3) await sleep(900 * attempt);
  }
  log('TABLE_CHECK_WARNING', { id, retries: 3, reason: last });
  return false;
}

async function contentForEnglishPage(targetVi, sourceEn, n) {
  const viContent = String(targetVi.content?.raw ?? targetVi.content?.rendered ?? '');
  const ids = tableIds(viContent);
  if (!ids.length) return { content: await localizeHtml(sourceEn.content?.rendered || '', n, `page-en:${sourceEn.slug}`), mode: 'editor' };
  const pairs = [];
  for (const id of ids) {
    const candidate = englishTableId(id);
    if (!await tableExists(candidate)) return { content: '', mode: 'defer-table', missingTable: candidate, sourceTable: id };
    pairs.push([id, candidate]);
  }
  let content = viContent;
  for (const [from, to] of pairs) content = content.replaceAll(from, to);
  return { content, mode: 'translated-table-reuse', tables: pairs };
}

const legacyViPathCache = new Map();
const normalizeLegacyPath = value => {
  try { return decodeURIComponent(new URL(String(value || ''), source).pathname).replace(/\/+$/, '') || '/'; }
  catch { return ''; }
};

async function legacyVietnamesePath(row) {
  const link = String(row?.link || '');
  if (!link) return '';
  if (legacyViPathCache.has(link)) return legacyViPathCache.get(link);
  let result = '';
  try {
    const url = new URL(link, source);
    const { body: html } = await sourceGet(`${url.pathname}${url.search}`, false);
    const anchors = [...String(html || '').matchAll(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
    for (const match of anchors) {
      const text = plain(match[2] || '').trim();
      if (!/^vi$/i.test(text)) continue;
      const candidate = normalizeLegacyPath(match[1]);
      if (candidate && !candidate.startsWith('/e/')) { result = candidate; break; }
    }
  } catch (error) {
    log('LEGACY_LANG_SWITCH_WARNING', { slug: row?.slug, reason: String(error?.message || error) });
  }
  legacyViPathCache.set(link, result);
  return result;
}

async function sourceViForEnglish(row, sourceMap, sourceRows) {
  const id = translationId(row, 'vi');
  if (id && sourceMap.has(id)) return sourceMap.get(id);
  const viPath = await legacyVietnamesePath(row);
  if (!viPath) return null;
  const matches = sourceRows.filter(item => langOf(item) !== 'en' && normalizeLegacyPath(item.link) === viPath);
  return matches.length === 1 ? matches[0] : null;
}

async function ensureEnglishPages(n, sourcePages, targetPages) {
  const sourceMap = new Map(sourcePages.map(item => [Number(item.id), item]));
  const english = sourcePages.filter(item => langOf(item) === 'en');
  const results = [];
  for (const sourceEn of english) {
    const sourceVi = await sourceViForEnglish(sourceEn, sourceMap, sourcePages);
    if (!sourceVi) {
      deferred.push({ type: 'page', slug: sourceEn.slug, reason: 'legacy translation pairing unavailable' });
      continue;
    }
    const targetViCandidates = targetPages.filter(item => item.slug === sourceVi.slug && acfValue(item.acf?.product_lang) !== 'en');
    if (targetViCandidates.length !== 1) {
      deferred.push({ type: 'page', slug: sourceEn.slug, sourceViSlug: sourceVi.slug, reason: `target vi page candidates=${targetViCandidates.length}` });
      continue;
    }
    const targetVi = targetViCandidates[0];
    const existing = targetPages.filter(item => acfValue(item.acf?.product_lang) === 'en' &&
      (Number(acfValue(item.acf?.origin_page_id) || 0) === Number(targetVi.id) || item.slug === sourceEn.slug));
    if (existing.length > 1) throw Error(`Duplicate target EN Page ${sourceEn.slug}`);
    if (existing.length === 1) {
      results.push({ slug: sourceEn.slug, id: Number(existing[0].id), state: 'EXISTS' });
      continue;
    }
    const action = acfValue(targetVi.acf?.action);
    const key = acfValue(targetVi.acf?.key);
    if (!action || !key) {
      deferred.push({ type: 'page', slug: sourceEn.slug, sourceViSlug: sourceVi.slug, reason: 'target vi action/key missing' });
      continue;
    }
    const resolved = await contentForEnglishPage(targetVi, sourceEn, n);
    if (resolved.mode === 'defer-table') {
      deferred.push({ type: 'page', slug: sourceEn.slug, sourceViSlug: sourceVi.slug, reason: `missing English ESC Table ${resolved.missingTable}`, sourceTable: resolved.sourceTable });
      continue;
    }
    if (action === 'IntroPage' && plain(resolved.content).length < 10 && !tableIds(resolved.content).length) {
      deferred.push({ type: 'page', slug: sourceEn.slug, sourceViSlug: sourceVi.slug, reason: 'translated content empty' });
      continue;
    }
    const payload = {
      title: plain(sourceEn.title?.rendered), slug: sourceEn.slug, status: 'publish', content: resolved.content,
    };
    const created = await api('POST', '/wp-json/wp/v2/pages', n, payload, 90000);
    assert(created.response.ok() && created.body?.id, `Cannot create EN Page ${sourceEn.slug}: HTTP ${created.response.status()}`);
    const id = Number(created.body.id); writes++;
    await setAcf(n, 'pages', id, { product_lang: 'en', action, key, origin_page_id: String(targetVi.id) });
    const verify = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,title,content,acf`, n);
    assert(verify.response.ok() && verify.body.status === 'publish' && acfValue(verify.body.acf?.product_lang) === 'en'
      && acfValue(verify.body.acf?.action) === action && acfValue(verify.body.acf?.key) === key,
    `EN Page readback failed ${sourceEn.slug}`);
    targetPages.push(verify.body);
    results.push({ slug: sourceEn.slug, id, state: 'CREATED', action, key, mode: resolved.mode });
    log('EN_PAGE', results.at(-1));
  }
  return { sourceEnglish: english.length, results };
}

async function sourceFeaturedUrl(id) {
  if (!Number(id)) return '';
  const { body } = await sourceGet(`/wp-json/wp/v2/media/${Number(id)}?_fields=id,source_url`);
  return String(body?.source_url || '');
}

async function ensureEnglishPosts(n, sourcePosts, targetPosts) {
  const sourceMap = new Map(sourcePosts.map(item => [Number(item.id), item]));
  const english = sourcePosts.filter(item => langOf(item) === 'en');
  let createdCount = 0;
  let existingCount = 0;
  const results = [];
  for (const sourceEn of english) {
    const sourceVi = await sourceViForEnglish(sourceEn, sourceMap, sourcePosts);
    if (!sourceVi) {
      deferred.push({ type: 'post', slug: sourceEn.slug, reason: 'legacy translation pairing unavailable' });
      continue;
    }
    const targetViCandidates = targetPosts.filter(item => item.slug === sourceVi.slug && acfValue(item.acf?.product_lang) !== 'en');
    if (targetViCandidates.length !== 1) {
      deferred.push({ type: 'post', slug: sourceEn.slug, sourceViSlug: sourceVi.slug, reason: `target vi post candidates=${targetViCandidates.length}` });
      continue;
    }
    const targetVi = targetViCandidates[0];
    const existing = targetPosts.filter(item => item.slug === sourceEn.slug && acfValue(item.acf?.product_lang) === 'en');
    if (existing.length > 1) throw Error(`Duplicate target EN Post ${sourceEn.slug}`);
    if (existing.length === 1) {
      const current = existing[0];
      const needed = { product_lang: 'en', action: 'PostDetails', key: 'ssr-post' };
      if (!Object.entries(needed).every(([k, v]) => acfValue(current.acf?.[k]) === v)) await setAcf(n, 'posts', Number(current.id), needed);
      existingCount++;
      results.push({ slug: sourceEn.slug, id: Number(current.id), state: 'EXISTS' });
      continue;
    }
    const content = await localizeHtml(sourceEn.content?.rendered || '', n, `post-en:${sourceEn.slug}`);
    const excerpt = await localizeHtml(sourceEn.excerpt?.rendered || '', n, `post-en-excerpt:${sourceEn.slug}`);
    let featured = 0;
    if (Number(sourceEn.featured_media || 0)) {
      const featuredUrl = await sourceFeaturedUrl(sourceEn.featured_media).catch(() => '');
      if (featuredUrl) featured = (await ensureMedia(n, featuredUrl, `post-featured:${sourceEn.slug}`)).id;
    }
    const payload = {
      title: plain(sourceEn.title?.rendered), slug: sourceEn.slug, status: 'publish',
      content, excerpt, date: sourceEn.date, date_gmt: sourceEn.date_gmt,
      featured_media: featured,
      categories: (targetVi.categories || []).map(Number),
    };
    const created = await api('POST', '/wp-json/wp/v2/posts', n, payload, 90000);
    assert(created.response.ok() && created.body?.id, `Cannot create EN Post ${sourceEn.slug}: HTTP ${created.response.status()}`);
    const id = Number(created.body.id); writes++; createdCount++;
    await setAcf(n, 'posts', id, { product_lang: 'en', action: 'PostDetails', key: 'ssr-post' });
    const verify = await api('GET', `/wp-json/wp/v2/posts/${id}?context=edit&_fields=id,slug,status,categories,acf`, n);
    assert(verify.response.ok() && verify.body.status === 'publish'
      && acfValue(verify.body.acf?.product_lang) === 'en'
      && acfValue(verify.body.acf?.action) === 'PostDetails'
      && acfValue(verify.body.acf?.key) === 'ssr-post', `EN Post readback failed ${sourceEn.slug}`);
    targetPosts.push({ ...created.body, acf: verify.body.acf });
    results.push({ slug: sourceEn.slug, id, state: 'CREATED', sourceViSlug: sourceVi.slug, targetViId: targetVi.id });
    log('EN_POST', results.at(-1));
  }
  log('EN_POST_SUMMARY', { sourceEnglish: english.length, created: createdCount, existing: existingCount });
  return { sourceEnglish: english.length, created: createdCount, existing: existingCount, results };
}

async function readMenus() {
  const response = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_localized_menu=${Date.now()}`), { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } });
  assert(response.ok(), `Menu API HTTP ${response.status()}`);
  const data = await response.json();
  assert(data?.success === true, 'Menu API contract changed');
  return data.menus || {};
}

async function ensureEnglishHeader(n, targetPages) {
  const menus = await readMenus();
  const vi = menus?.Header?.vi;
  const en = menus?.Header?.en;
  if (!vi?.id || !en?.id) {
    deferred.push({ type: 'menu', reason: `Header menu missing vi=${Boolean(vi?.id)} en=${Boolean(en?.id)}` });
    return { changed: false, state: 'DEFERRED' };
  }
  const allNative = await api('GET', '/wp-json/wp/v2/menu-items?context=edit&status=publish&per_page=100&_fields=id,title,url,status,menus,parent,menu_order,type,target', n);
  assert(allNative.response.ok() && Array.isArray(allNative.body), 'Cannot inspect native menu items');
  const enNative = allNative.body.filter(item => Number(item.menus) === Number(en.id));
  const titleOf = item => plain(item?.title?.raw ?? item?.title?.rendered ?? item?.title);
  const groupLabels = new Map([
    ['Giới thiệu', 'About Us'], ['Dịch vụ', 'Services'], ['HSEQ', 'HSEQ'], ['Tin tức', 'News'],
    ['Tuyển dụng', 'Careers'], ['Liên hệ', 'Contact'], ['Trang chủ', 'Home'], ['Home', 'Home'],
    ['Thư mời chào giá', 'Invitation for Quotation'], ['Thư viện PPS', 'PPS Library'],
  ]);
  const pagesViBySlug = new Map(targetPages.filter(p => acfValue(p.acf?.product_lang) !== 'en').map(p => [p.slug, p]));
  const pagesEnByOrigin = new Map(targetPages.filter(p => acfValue(p.acf?.product_lang) === 'en' && Number(acfValue(p.acf?.origin_page_id) || 0) > 0)
    .map(p => [Number(acfValue(p.acf?.origin_page_id)), p]));

  const normalizePath = href => {
    try {
      const u = new URL(String(href || ''), wp);
      if (u.origin !== wp) return null;
      return u.pathname.replace(/^\/+|\/+$/g, '');
    } catch { return null; }
  };
  const desired = [];
  const walk = (items, parentKey = '') => {
    for (const item of items || []) {
      const label = String(item.label || '').trim();
      const path = normalizePath(item.href);
      const isGroup = !path || String(item.href || '') === '#' || String(item.href || '') === '';
      let translated = null;
      if (!isGroup && path) {
        const slug = path.split('/').pop();
        const viPage = pagesViBySlug.get(slug);
        const enPage = viPage ? pagesEnByOrigin.get(Number(viPage.id)) : null;
        if (enPage) translated = { title: plain(enPage.title?.raw ?? enPage.title?.rendered), url: `/${enPage.slug}`, target: item.target || '' };
        else if (/^https?:\/\//i.test(String(item.href || ''))) translated = { title: groupLabels.get(label) || label, url: item.href, target: item.target || '' };
      } else {
        const childStart = desired.length;
        const key = `${parentKey}/${label}`;
        const before = desired.length;
        walk(item.children || [], key);
        const childCount = desired.length - before;
        if (childCount > 0) desired.splice(childStart, 0, { key, title: groupLabels.get(label) || label, url: '#', target: '', parentKey, isGroup: true });
        continue;
      }
      if (translated) desired.push({ key: `${parentKey}/${label}`, ...translated, parentKey, isGroup: false });
      if (item.children?.length) walk(item.children, `${parentKey}/${label}`);
    }
  };
  walk(vi.items || []);

  // Rebuild hierarchy only for records that have a real translation. Existing
  // EN items are reused whenever exact; obsolete items are drafted, never deleted.
  const desiredKeys = new Set(desired.map(x => x.key));
  const reusableByTitle = new Map();
  for (const row of enNative) {
    const title = titleOf(row);
    if (!reusableByTitle.has(title)) reusableByTitle.set(title, []);
    reusableByTitle.get(title).push(row);
  }
  const idByKey = new Map();
  let changed = false;
  for (const entry of desired) {
    const parentId = entry.parentKey ? Number(idByKey.get(entry.parentKey) || 0) : 0;
    const candidates = reusableByTitle.get(entry.title) || [];
    const exact = candidates.find(row => Number(row.parent || 0) === parentId &&
      new URL(String(row.url || '#'), wp).pathname === new URL(String(entry.url || '#'), wp).pathname && String(row.target || '') === String(entry.target || ''));
    if (exact) { idByKey.set(entry.key, Number(exact.id)); continue; }
    assert(candidates.length === 0, `Conflicting Header.en item ${entry.title}; refusing overwrite`);
    const created = await api('POST', '/wp-json/wp/v2/menu-items', n, {
      title: entry.title, type: 'custom', url: entry.url, menus: Number(en.id), status: 'publish',
      parent: parentId, target: entry.target || '', menu_order: idByKey.size + 1,
    });
    assert(created.response.ok() && created.body?.id, `Cannot create Header.en item ${entry.title}`);
    idByKey.set(entry.key, Number(created.body.id)); writes++; changed = true;
  }
  // Draft only obsolete items that are not represented by desired translated labels.
  const desiredTitles = new Set(desired.map(x => x.title));
  for (const row of enNative) {
    if (desiredTitles.has(titleOf(row))) continue;
    const updated = await api('POST', `/wp-json/wp/v2/menu-items/${row.id}`, n, { status: 'draft' });
    assert(updated.response.ok(), `Cannot draft obsolete Header.en item ${titleOf(row)}`);
    changed = true; writes++;
    log('EN_MENU_DRAFTED_OBSOLETE', { id: row.id, title: titleOf(row) });
  }
  log('EN_MENU', { state: 'PASS', desired: desired.map(x => x.title), changed });
  return { changed, state: 'PASS', desired: desired.map(x => x.title) };
}

async function triggerBuildAndWait() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const button = page.locator('#vcs-build-btn-main');
  assert(await button.count() === 1, 'WordPress Build Website button unavailable');
  const state = await page.evaluate(() => ({
    configured: globalThis.vcsBuild?.build_configured,
    active: globalThis.vcsBuild?.initial_active,
    pending: globalThis.vcsBuild?.pending_count,
  }));
  assert(state.configured === true || state.configured === 1 || state.configured === '1', 'WordPress Build Website is not configured');
  if (!state.active) {
    const force = page.locator('#vcs-force-build');
    if (await button.isDisabled()) {
      assert(await force.count() === 1 && !await force.isDisabled(), 'Build disabled and force unavailable');
      await force.check();
    }
    const ack = page.waitForResponse(response => response.url().startsWith(wp + '/wp-admin/admin-ajax.php')
      && response.request().method() === 'POST'
      && String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
    await button.click();
    const response = await ack;
    const body = await response.json().catch(() => null);
    assert(response.ok() && body?.success, 'WordPress Build Website rejected trigger');
    log('BUILD', 'TRIGGERED_VIA_WORDPRESS');
  } else log('BUILD', 'ACTIVE_RECONCILE_EXISTING');
  const build = await waitForWordPressBuild({ page, wpOrigin: wp, logPrefix: 'PTSCPS_LOCALIZED_BUILD' });
  log('BUILD_RESULT', build);
  return build;
}

async function productionQa(viPages, enPosts, targetPages) {
  const qa = await context.newPage();
  const results = [];
  for (const item of viPages) {
    const response = await qa.goto(`${front}/${item.slug}?_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `VI static production route failed ${item.slug}`);
    assert((await qa.locator('main').innerText()).trim().length > 80, `VI static production content empty ${item.slug}`);
    results.push({ route: `/${item.slug}`, status: 200 });
  }
  const englishHome = targetPages.find(p => acfValue(p.acf?.product_lang) === 'en' && acfValue(p.acf?.key) === 'home');
  if (englishHome) {
    const response = await qa.goto(`${front}/${englishHome.slug}?_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, 'English home production route failed');
    const text = await qa.locator('footer').innerText();
    for (const forbidden of ['Sitemap', 'Terms of Service', 'Privacy Policy', 'Điều khoản dịch vụ', 'Chính sách bảo mật']) {
      assert(!text.includes(forbidden), `Untranslated policy label leaked into EN footer: ${forbidden}`);
    }
    results.push({ route: `/${englishHome.slug}`, status: 200, policiesHidden: true });
  }
  const samples = enPosts.results.filter(x => x.state === 'CREATED').slice(0, 3);
  for (const sample of samples) {
    const response = await qa.goto(`${front}/${sample.slug}?_qa=${Date.now()}`, { waitUntil: 'load', timeout: 50000 });
    assert(response?.status() === 200, `EN Post production route failed ${sample.slug}`);
    assert((await qa.locator('main').innerText()).trim().length > 80, `EN Post production content empty ${sample.slug}`);
    results.push({ route: `/${sample.slug}`, status: 200 });
  }
  await writeFile(`${artifactDir}/production-qa.json`, JSON.stringify(results, null, 2));
  await qa.close();
  log('PRODUCTION_QA', { status: 'PASS', results });
}

try {
  await login();
  const n = await nonce();
  const sourcePages = await collectSource('pages', 'id,slug,status,link,title,content,excerpt,featured_media,parent,lang,translations,date,date_gmt');
  const sourcePosts = await collectSource('posts', 'id,slug,status,link,title,content,excerpt,featured_media,categories,tags,lang,translations,date,date_gmt');
  let targetPages = await collectTarget('pages', n, 'id,slug,status,title,content,acf,parent,date,date_gmt');
  let targetPosts = await collectTarget('posts', n, 'id,slug,status,title,content,excerpt,featured_media,categories,acf,date,date_gmt');
  log('INVENTORY', {
    source: { pages: sourcePages.length, pagesEn: sourcePages.filter(x => langOf(x) === 'en').length, posts: sourcePosts.length, postsEn: sourcePosts.filter(x => langOf(x) === 'en').length },
    target: { pages: targetPages.length, pagesEn: targetPages.filter(x => acfValue(x.acf?.product_lang) === 'en').length, posts: targetPosts.length, postsEn: targetPosts.filter(x => acfValue(x.acf?.product_lang) === 'en').length },
  });

  const viStatic = await ensureVietnameseStaticPages(n, sourcePages, targetPages);
  targetPages = await collectTarget('pages', n, 'id,slug,status,title,content,acf,parent,date,date_gmt');
  const enPages = await ensureEnglishPages(n, sourcePages, targetPages);
  targetPages = await collectTarget('pages', n, 'id,slug,status,title,content,acf,parent,date,date_gmt');
  const enPosts = await ensureEnglishPosts(n, sourcePosts, targetPosts);
  await ensureEnglishHeader(n, targetPages);

  await writeFile(`${artifactDir}/deferred.json`, JSON.stringify(deferred, null, 2));
  const summary = {
    status: deferred.length ? 'PARTIAL_WITH_DEFERRED' : 'PASS', writes,
    viStatic, enPages: { sourceEnglish: enPages.sourceEnglish, handled: enPages.results.length },
    enPosts: { sourceEnglish: enPosts.sourceEnglish, created: enPosts.created, existing: enPosts.existing },
    deferredCount: deferred.length,
  };
  await writeFile(`${artifactDir}/summary.json`, JSON.stringify(summary, null, 2));
  log('SUMMARY', summary);

  if (writes > 0) await triggerBuildAndWait();
  else log('BUILD', 'NO_CMS_CHANGES_SKIP_TRIGGER');
  await productionQa(viStatic, enPosts, targetPages);
  log('RESULT', deferred.length ? 'PARTIAL_WITH_DEFERRED' : 'PASS');
} finally {
  await browser.close();
}
