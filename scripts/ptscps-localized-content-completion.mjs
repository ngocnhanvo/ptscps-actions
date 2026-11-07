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

async function readTable(id) {
  const response = await page.request.get(uri(`/wp-json/tablepress/v1/table/${encodeURIComponent(id)}?_localized_table=${Date.now()}`), {
    timeout: 30000, headers: { 'Cache-Control': 'no-cache' },
  });
  if (response.status() === 404) return null;
  assert(response.ok(), `ESC Table read failed ${id}: HTTP ${response.status()}`);
  return response.json();
}

const escTextTranslations = new Map([
  ['Sức khỏe · An toàn · Môi trường · Chất lượng', 'Health · Safety · Environment · Quality'],
  ['Chính sách HSEQ', 'HSEQ Policy'],
  ['Mục tiêu HSEQ', 'HSEQ Target'],
  ['Hệ thống quản lý HSEQ', 'HSEQ Management System'],
  ['Giấy chứng nhận HSEQ', 'HSEQ Certification'],
  ['Cam kết về an toàn, sức khỏe và chất lượng dịch vụ', 'Commitment to safety, health and service quality'],
  ['Liên tục cải tiến, đảm bảo an toàn và bảo vệ môi trường', 'Continuous improvement, safety assurance and environmental protection'],
  ['Hệ thống quản lý tích hợp theo các tiêu chuẩn quốc tế', 'Integrated management system aligned with international standards'],
  ['Các chứng nhận hệ thống quản lý chất lượng, môi trường và an toàn', 'Quality, environmental and occupational health & safety management certifications'],
  ['Xem chi tiết', 'View details'],
  ['Phóng to tài liệu', 'Enlarge document'],
  ['Mở tài liệu PDF', 'Open PDF'],
  ['Phóng to sơ đồ', 'Enlarge diagram'],
  ['Phóng to chứng nhận', 'Enlarge certificate'],
  ['Công ty cung cấp dịch vụ với chất lượng quốc tế, đảm bảo an toàn cho tất cả các khách hàng với cam kết:', 'The Company provides professional quality services with international standards and safety standards for all customers with the following commitments:'],
  ['Mục tiêu liên tục nâng cao chất lượng dịch vụ phục vụ khách hàng, đảm bảo yếu tố an toàn, không gây tác động xấu tới môi trường, cộng đồng và các bên liên quan.', 'Our objective is to continuously improve the quality of customer services, ensure the highest safety standards, and minimize impacts on the environment, the community and all related parties.'],
  ['Hệ thống quản lý của Công ty được xây dựng trên nguyên tắc áp dụng hài hòa và đồng bộ các tiêu chuẩn quốc tế về hệ thống quản lý: Chất lượng (ISO 9001:2015), Sức khỏe nghề nghiệp và an toàn (ISO 45001:2018) và Môi trường (ISO 14001:2015) để cung cấp các dịch vụ đảm bảo chất lượng, an toàn, không gây tác động xấu tới môi trường, cộng đồng và các bên quan tâm.', 'The Company’s Management System is developed on the principle of harmoniously and synchronously applying international standards on management systems: Quality (ISO 9001:2015), Occupational Health and Safety (ISO 45001:2018) and Environmental Management (ISO 14001:2015), ensuring quality and safe services with minimal adverse impact on the environment, community and interested parties.'],
  ['Hệ thống quản lý của Công ty được xây dựng trên nguyên tắc tiếp cận theo quá trình với 3 hoạt động cơ bản là Điều hành, Hỗ trợ và Kiểm soát.', 'The Company’s Management System is built on a process-based approach with three core activities: Administration, Support and Control.'],
  ['Các hệ thống quản lý của công ty đáp ứng những tiêu chuẩn ISO về chất lượng, môi trường và sức khỏe nghề nghiệp, an toàn.', 'PTSC Production Services JSC has been certified by BSI (British Standards Institution) for ISO 9001:2015, ISO 14001:2015 and ISO 45001:2018 management systems covering quality, environment, occupational health and safety.'],
  ['Liên hệ', 'Contact'],
  ['Kết nối với PTSC Production Services để được tư vấn và hỗ trợ.', 'Connect with PTSC Production Services for consultation and support.'],
  ['Địa chỉ', 'Address'],
  ['Điện thoại', 'Phone'],
  ['Gửi yêu cầu liên hệ', 'Contact Request'],
  ['Vui lòng để lại thông tin, chúng tôi sẽ liên hệ với bạn trong thời gian sớm nhất.', 'Please leave your information. We will contact you as soon as possible.'],
  ['Họ và tên', 'Full name'],
  ['Số điện thoại', 'Phone number'],
  ['Tiêu đề', 'Subject'],
  ['Nội dung', 'Message'],
  ['Gửi tin', 'Send'],
  ['Google Maps - mã nhúng (Share > Embed a map)', 'Google Maps - embed code (Share > Embed a map)'],
  ['Google Maps - đường dẫn mở', 'Google Maps - external link'],
  ['Tầng 16, Khách sạn Dầu khí, số 9-11 Hoàng Diệu, Phường Vũng Tàu, Thành phố Hồ Chí Minh.', '16th Floor, Petroleum Hotel, 9-11 Hoang Dieu, Vung Tau Ward, Ho Chi Minh City.'],
]);

const escLinkTranslations = new Map([
  ['/hseq/chinh-sach-skatmtcl', '/hseq/hseq-policy'],
  ['/hseq/muc-tieu-skatmtcl', '/hseq/hseq-target'],
  ['/hseq/he-thong-quan-ly-skatmtcl', '/hseq/hseq-management-system'],
  ['/hseq/giay-chung-nhan-skatmtcl', '/hseq/hseq-certification'],
]);

const englishTableSpecs = [
  { sourceId: 'hseq_00_vi', targetId: 'hseq_00_en', title: 'HSEQ', description: 'Health · Safety · Environment · Quality' },
  { sourceId: 'hseq_01_vi', targetId: 'hseq_01_en', title: 'HSEQ Policy', description: 'Commitment to safety, health and service quality' },
  { sourceId: 'hseq_02_vi', targetId: 'hseq_02_en', title: 'HSEQ Target', description: 'Continuous improvement, safety assurance and environmental protection' },
  { sourceId: 'hseq_03_vi', targetId: 'hseq_03_en', title: 'HSEQ Management System', description: 'Integrated management system aligned with international standards' },
  { sourceId: 'hseq_04_vi', targetId: 'hseq_04_en', title: 'HSEQ Certification', description: 'Quality, environmental and occupational health & safety management certifications' },
  { sourceId: 'contact_01_vi', targetId: 'contact_01_en', title: 'Contact', description: 'Connect with PTSC Production Services for consultation and support.' },
  { sourceId: 'contact_00_vi', targetId: 'contact_00_en', title: 'Contact Request', description: 'Please leave your information. We will contact you as soon as possible.' },
];

function translateEscCell(value) {
  let output = String(value ?? '');
  for (const [from, to] of escLinkTranslations) output = output.split(from).join(to);
  for (const [from, to] of escTextTranslations) output = output.split(from).join(to);
  output = output.replace(/Tài liệu Mục tiêu HSEQ\s+(\d+)/g, 'HSEQ Target Document $1');
  output = output.replace(/Mô hình quản lý HSEQ/g, 'HSEQ Management System');
  return output;
}

async function ensureEnglishTable(spec) {
  const existing = await readTable(spec.targetId);
  if (existing?.items?.length) {
    log('EN_TABLE', { id: spec.targetId, state: 'PRESERVE_EXISTING', items: existing.items.length });
    return false;
  }
  const sourceTable = await readTable(spec.sourceId);
  assert(sourceTable?.items?.length, `Source ESC Table missing ${spec.sourceId}`);
  const fields = (sourceTable.fields || []).map(field => String(field?.key || '')).filter(Boolean);
  assert(fields.length > 0, `Source ESC Table fields missing ${spec.sourceId}`);
  const rows = sourceTable.items.map(item => fields.map(key => translateEscCell(item?.[key])));
  let current = existing;
  if (!current) {
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'), { waitUntil: 'domcontentloaded', timeout: 50000 });
    await page.locator('input[name="table[name]"]').fill(spec.title);
    await page.locator('textarea[name="table[description]"]').fill(spec.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill(String(fields.length));
    await page.getByRole('button', { name: /^(Add Table|Thêm bảng)$/i }).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/, { timeout: 50000 });
    let confirmed = false;
    page.once('dialog', async dialog => { confirmed = true; await dialog.accept(); });
    await page.locator('#table-id').fill(spec.targetId);
    await page.locator('#table-name').click();
    for (let attempt = 0; attempt < 12 && !confirmed; attempt++) await sleep(100);
    assert(confirmed, `ESC Table ID confirmation missing ${spec.targetId}`);
    await page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i }).last().click();
    for (let attempt = 0; attempt < 12; attempt++) {
      await sleep(700); current = await readTable(spec.targetId).catch(() => null); if (current) break;
    }
    assert(current, `ESC Table renaming failed ${spec.targetId}`);
  }
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(spec.targetId)}`), { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.waitForFunction(() => Boolean(globalThis.tp?.editor?.options?.data && globalThis.tp?.callbacks?.append), null, { timeout: 30000 });
  await page.locator('#table-name').fill(spec.title);
  await page.locator('#table-description').fill(spec.description);
  await page.evaluate(({ fields, rows }) => {
    const editor = globalThis.tp.editor;
    if (editor.options.columns.length !== fields.length) throw Error('Unexpected translated ESC Table column count');
    const required = rows.length + 2;
    if (editor.options.data.length < required) globalThis.tp.callbacks.append('rows', required - editor.options.data.length);
    if (editor.options.data.length > required) throw Error('Unexpected translated ESC Table row count');
    fields.forEach((key, column) => { editor.setValueFromCoords(column, 0, key); editor.setValueFromCoords(column, 1, key); });
    rows.forEach((row, index) => fields.forEach((_, column) => editor.setValueFromCoords(column, index + 2, String(row[column] ?? ''))));
    globalThis.tp.helpers.unsaved_changes.set();
  }, { fields, rows });
  await page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i }).last().click();
  for (let attempt = 0; attempt < 12; attempt++) {
    await sleep(700); current = await readTable(spec.targetId).catch(() => null); if (current?.items?.length === rows.length) break;
  }
  assert(current?.items?.length === rows.length, `Translated ESC Table readback failed ${spec.targetId}`);
  writes++;
  log('EN_TABLE', { id: spec.targetId, state: 'CREATED', items: rows.length, source: spec.sourceId });
  return true;
}

async function ensureEnglishSupportTables() {
  let changed = 0;
  for (const spec of englishTableSpecs) if (await ensureEnglishTable(spec)) changed++;
  log('EN_TABLES', { status: 'PASS', changed, total: englishTableSpecs.length });
}


const representedServicePages = new Set();
const representedServicePosts = new Set();

async function listProductCategories(n) {
  const out = [];
  for (let p = 1; p <= 10; p++) {
    const { response, body } = await api('GET', `/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&per_page=100&page=${p}&_fields=id,name,slug,parent,description`, n);
    if (response.status() === 400 && p > 1) break;
    assert(response.ok() && Array.isArray(body), `Target product_cat HTTP ${response.status()} page=${p}`);
    out.push(...body);
    const max = Number(response.headers()['x-wp-totalpages'] || 1);
    if (p >= max || body.length < 100) break;
  }
  return out;
}

const normalizeMatchText = value => plain(value).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const productCategoryIds = product => Array.isArray(product?.product_categories)
  ? product.product_categories.map(item => Number(item?.id || item)).filter(Boolean)
  : Array.isArray(product?.product_cat) ? product.product_cat.map(Number).filter(Boolean) : [];

async function termThumbnailId(termId) {
  await page.goto(uri(`/wp-admin/term.php?taxonomy=product_cat&tag_ID=${Number(termId)}&post_type=product&esc_full_admin=1`), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const input = page.locator('#product_cat_thumbnail_id');
  if (await input.count() !== 1) return 0;
  return Number(await input.inputValue() || 0);
}

async function setTermThumbnailId(termId, mediaId) {
  if (!Number(mediaId)) return;
  await page.goto(uri(`/wp-admin/term.php?taxonomy=product_cat&tag_ID=${Number(termId)}&post_type=product&esc_full_admin=1`), { waitUntil: 'domcontentloaded', timeout: 50000 });
  const input = page.locator('#product_cat_thumbnail_id');
  assert(await input.count() === 1, `WooCommerce thumbnail field missing term=${termId}`);
  if (Number(await input.inputValue() || 0) === Number(mediaId)) return;
  await input.evaluate((el, id) => { el.value = String(id); el.dispatchEvent(new Event('change', { bubbles: true })); }, Number(mediaId));
  const form = page.locator('form#edittag').first();
  assert(await form.count() === 1, `Native product_cat edit form missing term=${termId}`);
  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 }).catch(() => null),
    form.evaluate(el => { if (!(el instanceof HTMLFormElement)) throw Error('Invalid product_cat form'); el.requestSubmit(); }),
  ]);
}

async function ensureProductCategory(n, spec) {
  let rows = await listProductCategories(n);
  const matches = rows.filter(item => item.slug === spec.slug);
  assert(matches.length <= 1, `Duplicate target product_cat ${spec.slug}`);
  let row = matches[0] || null;
  const payload = { name: spec.name, slug: spec.slug, parent: Number(spec.parent || 0), description: String(spec.description || '') };
  if (!row) {
    const created = await api('POST', '/wp-json/wp/v2/product_cat', n, payload);
    assert(created.response.ok() && created.body?.id, `Cannot create EN product_cat ${spec.slug}: HTTP ${created.response.status()}`);
    row = created.body; writes++;
    log('EN_SERVICE_CATEGORY', { slug: spec.slug, id: row.id, state: 'CREATED', parent: payload.parent });
  } else {
    const currentDescription = String(row.description?.raw ?? row.description ?? '');
    const changed = plain(row.name) !== plain(spec.name) || Number(row.parent || 0) !== payload.parent || plain(currentDescription) !== plain(payload.description);
    if (changed) {
      const updated = await api('POST', `/wp-json/wp/v2/product_cat/${row.id}`, n, payload);
      assert(updated.response.ok(), `Cannot update EN product_cat ${spec.slug}: HTTP ${updated.response.status()}`);
      row = updated.body; writes++;
      log('EN_SERVICE_CATEGORY', { slug: spec.slug, id: row.id, state: 'UPDATED', parent: payload.parent });
    } else log('EN_SERVICE_CATEGORY', { slug: spec.slug, id: row.id, state: 'EXISTS', parent: payload.parent });
  }
  if (Number(spec.thumbnailId || 0)) {
    await setTermThumbnailId(Number(row.id), Number(spec.thumbnailId));
  }
  rows = await listProductCategories(n);
  const verified = rows.find(item => Number(item.id) === Number(row.id));
  assert(verified && verified.slug === spec.slug && Number(verified.parent || 0) === payload.parent, `EN product_cat readback failed ${spec.slug}`);
  return verified;
}

async function ensureEnglishServicesTable(rootId) {
  const id = 'services_00_en';
  let table = await readTable(id);
  const matches = value => String(value?.meta?.api || '') === 'ProductCategory'
    && String(value?.items?.[0]?.['api-key'] || '') === String(rootId)
    && String(value?.items?.[0]?.['api-children'] || '') === 'children';
  if (table && matches(table)) {
    log('EN_TABLE', { id, state: 'PRESERVE_EXISTING', api: 'ProductCategory', rootId });
    return false;
  }
  let currentId = id;
  if (!table) {
    await page.goto(uri('/wp-admin/admin.php?page=tablepress_add&esc_full_admin=1'), { waitUntil: 'domcontentloaded', timeout: 50000 });
    await page.locator('input[name="table[name]"]').fill('Services');
    await page.locator('textarea[name="table[description]"]').fill('Services landing using ProductCategory');
    await page.locator('input[name="table[rows]"]').fill('3');
    await page.locator('input[name="table[columns]"]').fill('2');
    const add = page.getByRole('button', { name: /Add Table|Thêm bảng/i }).first();
    assert(await add.count() === 1, 'ESC Table Add Table button missing for services_00_en');
    await Promise.all([page.waitForURL(/table_id=[a-zA-Z0-9_-]+/, { timeout: 45000 }), add.click()]);
    currentId = new URL(page.url()).searchParams.get('table_id') || '';
    assert(currentId, 'New services_00_en TablePress ID missing');
  }
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(currentId)}&esc_full_admin=1`), { waitUntil: 'load', timeout: 50000 });
  await page.waitForFunction(() => Boolean(globalThis.tp?.editor?.options?.data), null, { timeout: 30000 });
  await page.locator('#table-name').fill('Services');
  await page.locator('#table-description').fill('Services landing using ProductCategory');
  await page.locator('#js_custom_api').waitFor({ state: 'visible', timeout: 15000 });
  await page.locator('#js_custom_api').fill('ProductCategory');
  if (currentId !== id) {
    page.once('dialog', dialog => dialog.accept());
    await page.locator('#table-id').fill(id);
    await page.locator('#table-id').press('Tab');
  }
  await page.evaluate(({ rootId }) => {
    const editor = globalThis.tp.editor;
    const values = [['api-key', 'api-children'], ['Root category', 'Service categories'], [String(rootId), 'children']];
    if (editor.options.data.length !== 3 || editor.options.columns.length !== 2) throw Error('services_00_en must be 3x2');
    values.forEach((row, y) => row.forEach((value, x) => editor.setValueFromCoords(x, y, value)));
    globalThis.tp.helpers.unsaved_changes.set();
  }, { rootId });
  const save = page.getByRole('button', { name: /Save Changes|Lưu thay đổi|Lưu các thay đổi/i }).first();
  const ackPromise = page.waitForResponse(resp => resp.url().startsWith(wp + '/wp-admin/admin-ajax.php') && String(resp.request().postData() || '').includes('action=tablepress_save_table'), { timeout: 45000 });
  await save.click();
  const ack = await ackPromise;
  assert(ack.ok(), `services_00_en save HTTP ${ack.status()}`);
  for (let attempt = 0; attempt < 8; attempt++) {
    await sleep(700); table = await readTable(id).catch(() => null); if (table && matches(table)) break;
  }
  assert(table && matches(table), 'services_00_en readback mismatch');
  writes++;
  log('EN_TABLE', { id, state: 'CREATED_OR_UPDATED', api: 'ProductCategory', rootId });
  return true;
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

function isDescendantPage(row, rootId, byId) {
  let current = row;
  const seen = new Set();
  while (current && Number(current.id) > 0 && !seen.has(Number(current.id))) {
    if (Number(current.id) === Number(rootId)) return true;
    seen.add(Number(current.id));
    current = byId.get(Number(current.parent || 0));
  }
  return false;
}

async function ensureEnglishServiceTaxonomy(n, sourcePages) {
  const sourceById = new Map(sourcePages.map(item => [Number(item.id), item]));
  const sourceViRoot = sourcePages.find(item => langOf(item) !== 'en' && item.slug === 'dich-vu');
  assert(sourceViRoot, 'Legacy VI Services root Page missing');
  const enByViSlug = new Map();
  for (const en of sourcePages.filter(item => langOf(item) === 'en')) {
    const vi = await sourceViForEnglish(en, sourceById, sourcePages);
    if (vi) enByViSlug.set(vi.slug, en);
  }
  const categories = await listProductCategories(n);
  const byId = new Map(categories.map(item => [Number(item.id), item]));
  const viRoot = categories.find(item => item.slug === 'dich-vu' && Number(item.parent || 0) === 0);
  assert(viRoot, 'Current VI Services product_cat root missing');
  const currentViTerms = categories.filter(item => isDescendantTerm(item, Number(viRoot.id), byId));
  const depthOf = row => { let depth = 0, current = row; const seen = new Set(); while (current && Number(current.parent || 0) && !seen.has(Number(current.id))) { seen.add(Number(current.id)); depth++; current = byId.get(Number(current.parent || 0)); } return depth; };
  currentViTerms.sort((a, b) => depthOf(a) - depthOf(b));
  const byViId = new Map();
  const translatedViSlugs = new Set();
  for (const viTerm of currentViTerms) {
    const sourceEn = enByViSlug.get(viTerm.slug);
    if (!sourceEn) continue;
    const parentId = Number(viTerm.id) === Number(viRoot.id) ? 0 : Number(byViId.get(Number(viTerm.parent || 0))?.id || 0);
    if (Number(viTerm.id) !== Number(viRoot.id) && !parentId) continue;
    const description = Number(viTerm.id) === Number(viRoot.id) ? '' : await localizeHtml(sourceEn.content?.rendered || '', n, `service-category:${sourceEn.slug}`);
    const thumbnailId = Number(viTerm.id) === Number(viRoot.id) ? 0 : await termThumbnailId(Number(viTerm.id));
    const enTerm = await ensureProductCategory(n, {
      name: plain(sourceEn.title?.rendered) || viTerm.name,
      slug: sourceEn.slug,
      parent: parentId,
      description,
      thumbnailId,
    });
    byViId.set(Number(viTerm.id), enTerm);
    translatedViSlugs.add(viTerm.slug);
    if (Number(viTerm.id) !== Number(viRoot.id)) representedServicePages.add(sourceEn.slug);
  }
  const enRoot = byViId.get(Number(viRoot.id));
  assert(enRoot, 'English Services product_cat root could not be created');
  const legacyTrackRecord = sourcePages.find(item => langOf(item) === 'en' && item.slug === 'track-record');
  if (legacyTrackRecord) {
    representedServicePages.add(legacyTrackRecord.slug);
    log('EN_SERVICE_PAGE', { slug: legacyTrackRecord.slug, state: 'OMITTED_WITH_CURRENT_VI_LAYOUT', representedBy: 'services-products' });
  }
  await ensureEnglishServicesTable(Number(enRoot.id));

  for (const en of sourcePages.filter(item => langOf(item) === 'en')) {
    const vi = await sourceViForEnglish(en, sourceById, sourcePages);
    if (!vi || Number(vi.id) === Number(sourceViRoot.id) || !isDescendantPage(vi, Number(sourceViRoot.id), sourceById)) continue;
    if (!translatedViSlugs.has(vi.slug)) {
      representedServicePages.add(en.slug);
      log('EN_SERVICE_PAGE', { slug: en.slug, sourceViSlug: vi.slug, state: 'OMITTED_WITH_CURRENT_VI_LAYOUT' });
    }
  }
  log('EN_SERVICE_TAXONOMY', { state: 'PASS', translatedCategories: byViId.size, root: enRoot.slug });
  return { viRoot, enRoot, byViId };
}

const productSlugAliases = new Map([
  ['fso-pps-01-e-translation', 'fso-pps-01'],
  ['fpso-thai-binh-vn-2', 'fpso-thai-binh-vn'],
  ['fso-orkid-2', 'fso-orkid'],
  ['fso-mv12-2', 'fso-mv12'],
  ['fso-golden-star-2', 'fso-golden-star'],
  ['648', 'fpso-ptsc-lam-son'],
  ['fso-ptsc-bien-dong-01-2', 'fso-ptsc-bien-dong-01'],
  ['fpso-ruby-ii-2', 'fpso-ruby-ii'],
  ['fso-ptsc-bach-ho-2', 'fso-ptsc-bach-ho'],
  ['fpso-ruby-princess-2', 'fpso-ruby-princess'],
  ['upstream-plant-long-son-petrochemical-complex', 'khu-vuc-thuong-nguon-nha-may-hoa-dau-long-son'],
]);

async function ensureEnglishProducts(n, sourcePosts, targetProducts, serviceContext) {
  const sourceById = new Map(sourcePosts.map(item => [Number(item.id), item]));
  let created = 0;
  let existing = 0;
  const results = [];
  for (const sourceEn of sourcePosts.filter(item => langOf(item) === 'en')) {
    const sourceVi = await sourceViForEnglish(sourceEn, sourceById, sourcePosts);
    const wantedSlug = productSlugAliases.get(sourceEn.slug) || sourceVi?.slug || '';
    let candidates = wantedSlug ? targetProducts.filter(item => item.slug === wantedSlug && acfValue(item.acf?.product_lang) !== 'en') : [];
    if (!candidates.length) {
      const titleKeys = new Set([normalizeMatchText(sourceEn.title?.rendered), normalizeMatchText(sourceVi?.title?.rendered)].filter(Boolean));
      candidates = targetProducts.filter(item => acfValue(item.acf?.product_lang) !== 'en' && titleKeys.has(normalizeMatchText(item.title?.raw ?? item.title?.rendered)));
    }
    if (candidates.length !== 1) {
      if (productSlugAliases.has(sourceEn.slug)) {
        representedServicePosts.add(sourceEn.slug);
        results.push({ slug: sourceEn.slug, state: 'OMITTED_WITH_CURRENT_VI_LAYOUT' });
        log('EN_PRODUCT', results.at(-1));
      }
      continue;
    }
    const viProduct = candidates[0];
    const viCategoryId = productCategoryIds(viProduct)[0];
    const enCategory = serviceContext.byViId.get(Number(viCategoryId || 0));
    if (!enCategory) continue;
    representedServicePosts.add(sourceEn.slug);
    const current = targetProducts.filter(item => acfValue(item.acf?.product_lang) === 'en' &&
      (Number(acfValue(item.acf?.origin_product_id) || 0) === Number(viProduct.id) || item.slug === sourceEn.slug));
    assert(current.length <= 1, `Duplicate EN Product ${sourceEn.slug}`);
    if (current.length === 1) {
      const row = current[0];
      const needed = { product_lang: 'en', origin_product_id: String(viProduct.id) };
      if (!Object.entries(needed).every(([key, value]) => String(acfValue(row.acf?.[key]) || '') === String(value))) {
        await setAcf(n, 'product', Number(row.id), needed); writes++;
      }
      existing++;
      results.push({ slug: sourceEn.slug, id: Number(row.id), state: 'EXISTS', origin: Number(viProduct.id) });
      continue;
    }
    const content = await localizeHtml(sourceEn.content?.rendered || '', n, `product-en:${sourceEn.slug}`);
    const excerpt = await localizeHtml(sourceEn.excerpt?.rendered || '', n, `product-en-excerpt:${sourceEn.slug}`);
    if (plain(content).length < 10) {
      deferred.push({ type: 'product', slug: sourceEn.slug, sourceViSlug: sourceVi?.slug || wantedSlug, reason: 'English Product content empty' });
      representedServicePosts.delete(sourceEn.slug);
      continue;
    }
    const payload = {
      title: plain(sourceEn.title?.rendered), slug: sourceEn.slug, status: 'publish', content, excerpt,
      featured_media: Number(viProduct.featured_media || 0), menu_order: Number(viProduct.menu_order || 0), product_cat: [Number(enCategory.id)],
    };
    const response = await api('POST', '/wp-json/wp/v2/product', n, payload, 90000);
    assert(response.response.ok() && response.body?.id, `Cannot create EN Product ${sourceEn.slug}: HTTP ${response.response.status()}`);
    const id = Number(response.body.id); writes++; created++;
    await setAcf(n, 'product', id, { product_lang: 'en', origin_product_id: String(viProduct.id) });
    const verify = await api('GET', `/wp-json/wp/v2/product/${id}?context=edit&_fields=id,slug,status,title,content,excerpt,featured_media,product_categories,acf`, n);
    assert(verify.response.ok() && verify.body.status === 'publish' && acfValue(verify.body.acf?.product_lang) === 'en'
      && Number(acfValue(verify.body.acf?.origin_product_id) || 0) === Number(viProduct.id), `EN Product readback failed ${sourceEn.slug}`);
    targetProducts.push(verify.body);
    results.push({ slug: sourceEn.slug, id, state: 'CREATED', origin: Number(viProduct.id), category: enCategory.slug });
    log('EN_PRODUCT', results.at(-1));
  }
  log('EN_PRODUCT_SUMMARY', { created, existing, represented: results.length });
  return { created, existing, results };
}

async function contentForEnglishPage(targetVi, sourceEn, n) {
  const viContent = String(targetVi.content?.raw ?? targetVi.content?.rendered ?? '');
  const ids = tableIds(viContent);
  if (!ids.length) {
    const localized = await localizeHtml(sourceEn.content?.rendered || '', n, `page-en:${sourceEn.slug}`);
    if (sourceEn.slug === 'library' && plain(localized).length < 10 && plain(viContent).length > 10) {
      return { content: viContent, mode: 'media-layout-reuse' };
    }
    return { content: localized, mode: 'editor' };
  }
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
    if (representedServicePages.has(sourceEn.slug)) {
      results.push({ slug: sourceEn.slug, state: 'REPRESENTED_BY_SERVICE_TAXONOMY' });
      continue;
    }
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

async function ensureEnglishPosts(n, sourcePosts, targetPosts, targetPages) {
  const sourceMap = new Map(sourcePosts.map(item => [Number(item.id), item]));
  const english = sourcePosts.filter(item => langOf(item) === 'en');
  let createdCount = 0;
  let existingCount = 0;
  const results = [];
  for (const sourceEn of english) {
    if (representedServicePosts.has(sourceEn.slug)) {
      results.push({ slug: sourceEn.slug, state: 'REPRESENTED_BY_PRODUCT' });
      continue;
    }
    const sourceVi = await sourceViForEnglish(sourceEn, sourceMap, sourcePosts);
    if (!sourceVi) {
      deferred.push({ type: 'post', slug: sourceEn.slug, reason: 'legacy translation pairing unavailable' });
      continue;
    }
    const targetViCandidates = targetPosts.filter(item => item.slug === sourceVi.slug && acfValue(item.acf?.product_lang) !== 'en');
    if (targetViCandidates.length !== 1) {
      const targetViPages = targetPages.filter(item => item.slug === sourceVi.slug && acfValue(item.acf?.product_lang) !== 'en');
      if (targetViCandidates.length === 0 && targetViPages.length === 1) {
        const targetViPage = targetViPages[0];
        const existingPage = targetPages.find(item => acfValue(item.acf?.product_lang) === 'en' &&
          (Number(acfValue(item.acf?.origin_page_id) || 0) === Number(targetViPage.id) || item.slug === sourceEn.slug));
        if (existingPage) {
          results.push({ slug: sourceEn.slug, id: Number(existingPage.id), state: 'REPRESENTED_BY_PAGE' });
          continue;
        }
        const action = acfValue(targetViPage.acf?.action);
        const key = acfValue(targetViPage.acf?.key);
        if (action && key) {
          const resolved = await contentForEnglishPage(targetViPage, sourceEn, n);
          if (resolved.mode !== 'defer-table') {
            const createdPage = await api('POST', '/wp-json/wp/v2/pages', n, {
              title: plain(sourceEn.title?.rendered), slug: sourceEn.slug, status: 'publish', content: resolved.content,
            }, 90000);
            assert(createdPage.response.ok() && createdPage.body?.id, `Cannot create EN Page from legacy Post ${sourceEn.slug}`);
            const id = Number(createdPage.body.id); writes++;
            await setAcf(n, 'pages', id, { product_lang: 'en', action, key, origin_page_id: String(targetViPage.id) });
            const verifyPage = await api('GET', `/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,title,content,acf`, n);
            assert(verifyPage.response.ok() && verifyPage.body.status === 'publish' && acfValue(verifyPage.body.acf?.product_lang) === 'en',
              `EN Page from legacy Post readback failed ${sourceEn.slug}`);
            targetPages.push(verifyPage.body);
            results.push({ slug: sourceEn.slug, id, state: 'CREATED_AS_PAGE', sourceViSlug: sourceVi.slug });
            log('EN_PAGE_FROM_LEGACY_POST', results.at(-1));
            continue;
          }
          deferred.push({ type: 'post', slug: sourceEn.slug, sourceViSlug: sourceVi.slug,
            reason: `matching VI Page requires missing English ESC Table ${resolved.missingTable}`, sourceTable: resolved.sourceTable });
          continue;
        }
      }
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
    ['Hồ sơ năng lực', 'Company Brochure'],
  ]);
  const pagesViBySlug = new Map(targetPages.filter(p => acfValue(p.acf?.product_lang) !== 'en').map(p => [p.slug, p]));
  const pagesEnByOrigin = new Map(targetPages.filter(p => acfValue(p.acf?.product_lang) === 'en' && Number(acfValue(p.acf?.origin_page_id) || 0) > 0)
    .map(p => [Number(acfValue(p.acf?.origin_page_id)), p]));
  const homeVi = targetPages.find(p => acfValue(p.acf?.product_lang) !== 'en' && acfValue(p.acf?.key) === 'home');
  const homeEn = targetPages.find(p => acfValue(p.acf?.product_lang) === 'en' && acfValue(p.acf?.key) === 'home')
    || (homeVi ? pagesEnByOrigin.get(Number(homeVi.id)) : null);
  const internalOrigins = new Set([new URL(wp).origin, new URL(front).origin]);

  const resolveHref = href => {
    try {
      const u = new URL(String(href || ''), wp);
      return { external: !internalOrigins.has(u.origin), path: u.pathname.replace(/^\/+|\/+$/g, '') };
    } catch { return null; }
  };
  const desired = [];
  const walk = (items, parentKey = '') => {
    for (const item of items || []) {
      const label = String(item.label || '').trim();
      const rawHref = String(item.href || '').trim();
      const resolvedHref = resolveHref(rawHref);
      const isPlaceholder = !rawHref || rawHref === '#';
      let translated = null;
      if (!isPlaceholder && resolvedHref) {
        if (resolvedHref.external) {
          translated = { title: groupLabels.get(label) || label, url: rawHref, target: item.target || '' };
        } else if (!resolvedHref.path) {
          if (homeEn) translated = { title: groupLabels.get(label) || plain(homeEn.title?.raw ?? homeEn.title?.rendered) || 'Home', url: `/${homeEn.slug}`, target: item.target || '' };
        } else {
          const slug = resolvedHref.path.split('/').pop();
          const viPage = pagesViBySlug.get(slug);
          const enPage = viPage ? pagesEnByOrigin.get(Number(viPage.id)) : null;
          if (enPage) translated = { title: plain(enPage.title?.raw ?? enPage.title?.rendered), url: `/${enPage.slug}`, target: item.target || '' };
        }
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
  const force = page.locator('#vcs-force-build');
  if (state.active || await button.isDisabled()) {
    assert(await force.count() === 1 && !await force.isDisabled(), 'Active/stale build requires force control');
    if (!await force.isChecked()) await force.check();
  }
  const ack = page.waitForResponse(response => response.url().startsWith(wp + '/wp-admin/admin-ajax.php')
    && response.request().method() === 'POST'
    && String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
  await button.click();
  const response = await ack;
  const body = await response.json().catch(() => null);
  assert(response.ok() && body?.success, 'WordPress Build Website rejected trigger');
  log('BUILD', state.active ? 'TRIGGERED_VIA_WORDPRESS_FORCE_STALE_ACTIVE' : 'TRIGGERED_VIA_WORDPRESS');
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
  let targetProducts = await collectTarget('product', n, 'id,slug,status,title,content,excerpt,featured_media,menu_order,product_categories,acf,date,date_gmt');
  log('INVENTORY', {
    source: { pages: sourcePages.length, pagesEn: sourcePages.filter(x => langOf(x) === 'en').length, posts: sourcePosts.length, postsEn: sourcePosts.filter(x => langOf(x) === 'en').length },
    target: { pages: targetPages.length, pagesEn: targetPages.filter(x => acfValue(x.acf?.product_lang) === 'en').length, posts: targetPosts.length, postsEn: targetPosts.filter(x => acfValue(x.acf?.product_lang) === 'en').length, products: targetProducts.length, productsEn: targetProducts.filter(x => acfValue(x.acf?.product_lang) === 'en').length },
  });

  const viStatic = await ensureVietnameseStaticPages(n, sourcePages, targetPages);
  const serviceContext = await ensureEnglishServiceTaxonomy(n, sourcePages);
  await ensureEnglishSupportTables();
  targetPages = await collectTarget('pages', n, 'id,slug,status,title,content,acf,parent,date,date_gmt');
  const enPages = await ensureEnglishPages(n, sourcePages, targetPages);
  targetPages = await collectTarget('pages', n, 'id,slug,status,title,content,acf,parent,date,date_gmt');
  const enProducts = await ensureEnglishProducts(n, sourcePosts, targetProducts, serviceContext);
  targetProducts = await collectTarget('product', n, 'id,slug,status,title,content,excerpt,featured_media,menu_order,product_categories,acf,date,date_gmt');
  const enPosts = await ensureEnglishPosts(n, sourcePosts, targetPosts, targetPages);
  await ensureEnglishHeader(n, targetPages);

  await writeFile(`${artifactDir}/deferred.json`, JSON.stringify(deferred, null, 2));
  const summary = {
    status: deferred.length ? 'PARTIAL_WITH_DEFERRED' : 'PASS', writes,
    viStatic, enPages: { sourceEnglish: enPages.sourceEnglish, handled: enPages.results.length },
    enProducts: { created: enProducts.created, existing: enProducts.existing, represented: enProducts.results.length },
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
