import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert.ok(wp && username && password, 'Configured WordPress/admin inputs missing');

const tableId = 'about_03';
const workDir = '/tmp/ptscps-intro-history';
const history = [
  { year: '2002', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/2002.jpg', alt: 'Tập thể PTSC PPS trong giai đoạn thành lập năm 2002' },
  { year: '2003', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/sutuden-665x405.jpg', alt: 'Công trình ngoài khơi trong quá trình phát triển PTSC PPS năm 2003' },
  { year: '2005', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/sutuden-665x405.jpg', alt: 'Công trình ngoài khơi trong quá trình phát triển PTSC PPS năm 2005' },
  { year: '2006', url: 'https://ptscps.com.vn/wp-content/uploads/2019/10/banner2.jpg', alt: 'Công trình dầu khí ngoài khơi của PTSC PPS năm 2006' },
  { year: '2008', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/2008.jpg', alt: 'Lễ ký hợp đồng FSO Orkid trong quá trình phát triển PTSC PPS năm 2008' },
  { year: '2010', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/2010-300x186.jpg', alt: 'FPSO Ruby II trong hoạt động PTSC PPS năm 2010' },
  { year: '2011', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/lamson-300x169.jpg', alt: 'FPSO PTSC Lam Son trong quá trình phát triển PTSC PPS năm 2011' },
  { year: '2013', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/taubiendong-780x500.jpg', alt: 'FSO PTSC Bien Dong 01 trong quá trình phát triển PTSC PPS năm 2013' },
  { year: '2014', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/lamson-300x169.jpg', alt: 'FPSO PTSC Lam Son trong hoạt động PTSC PPS năm 2014' },
  { year: '2017', url: 'https://ptscps.com.vn/wp-content/uploads/2019/10/03pvn-600x399-1-220x150.jpg', alt: 'Dịch vụ bảo dưỡng sửa chữa thiết bị của PTSC PPS năm 2017' },
  { year: '2018', url: 'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-RUBY-II-2-780x500.jpg', alt: 'FPSO Ruby II trong hoạt động PTSC PPS năm 2018' },
  { year: '2019', url: 'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-RUBY-II-2-780x500.jpg', alt: 'FPSO Ruby II trong hoạt động PTSC PPS năm 2019' },
  { year: '2021', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/2021.jpg', alt: 'Chứng nhận Interim Document of Compliance của PTSC PPS năm 2021' },
  { year: '2022', url: 'https://ptscps.com.vn/wp-content/uploads/2019/09/2022.jpg', alt: 'FPSO Lewek Emas trong hoạt động PTSC PPS năm 2022' },
  { year: '2023', url: 'https://ptscps.com.vn/wp-content/uploads/2019/10/12-2024-009-455x500.jpg', alt: 'Khu vực thượng nguồn dự án Long Sơn trong hoạt động PTSC PPS năm 2023' },
  { year: '2024', url: 'https://ptscps.com.vn/wp-content/uploads/2024/12/12-2024-001-780x500.png', alt: 'FSO PPS 01 trong quá trình phát triển PTSC PPS năm 2024' },
];

await mkdir(workDir, { recursive: true });
const imageHtml = (value) => /<img\b/i.test(String(value || ''));
const safeName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop() || 'history.jpg').replace(/[^A-Za-z0-9._-]/g, '_');

async function readTable(page) {
  const response = await page.request.get(`${wp}/wp-json/tablepress/v1/table/${tableId}`, {
    timeout: 25000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert.ok(response.ok(), `Unable to read ${tableId}: HTTP ${response.status()}`);
  return response.json();
}

async function saveTable(page) {
  const save = page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i });
  assert.ok(await save.count() > 0, 'Native ESC Table Save Changes unavailable');
  await save.last().click();
}

async function ensureImageColumn(page, table) {
  const keys = (table?.fields || []).map((field) => String(field?.key || ''));
  const existing = keys.indexOf('img');
  if (existing >= 0) return existing;

  assert.deepEqual(keys.slice(0, 6), ['type', 'group', 'title', 'content', 'meta', 'href'], `Unexpected ${tableId} schema before image migration`);
  await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${tableId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append), null, { timeout: 30000 });
  const imageCol = await page.evaluate(() => {
    const editor = window.tp.editor;
    const column = editor.options.columns.length;
    window.tp.callbacks.append('columns', 1);
    editor.setValueFromCoords(column, 0, 'img');
    editor.setValueFromCoords(column, 1, 'Hình ảnh');
    window.tp.helpers.unsaved_changes.set();
    return column;
  });
  await saveTable(page);

  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(800);
    const saved = await readTable(page).catch(() => null);
    const savedKeys = (saved?.fields || []).map((field) => String(field?.key || ''));
    if (savedKeys[imageCol] === 'img') {
      console.log(`INTRO_HISTORY_SCHEMA=PASS image_col=${imageCol}`);
      return imageCol;
    }
  }
  throw new Error(`${tableId} img column did not persist`);
}

async function downloadUniqueAssets() {
  const assets = new Map();
  for (const spec of history) {
    if (assets.has(spec.url)) continue;
    const response = await fetch(spec.url, { redirect: 'follow', headers: { 'User-Agent': 'PTSCPS-Intro-History-Migration/1.0' } });
    assert.ok(response.ok, `Legacy history image HTTP ${response.status}: ${spec.year}`);
    assert.match(response.headers.get('content-type') || '', /^image\//i, `Legacy history source is not image: ${spec.year}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length > 1500, `Legacy history image unexpectedly small: ${spec.year}`);
    const basename = safeName(spec.url);
    const file = path.join(workDir, basename);
    await writeFile(file, bytes);
    assets.set(spec.url, { file, basename });
  }
  assert.equal(assets.size, 13, 'Unexpected unique legacy history image count');
  console.log(`INTRO_HISTORY_ASSET_PREFLIGHT=PASS years=${history.length} unique_images=${assets.size}`);
  return assets;
}

async function mediaCandidates(page, basename) {
  const stem = basename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const response = await page.request.get(`${wp}/wp-json/wp/v2/media?per_page=50&search=${encodeURIComponent(stem)}&_fields=id,source_url,mime_type`, { timeout: 20000 });
  assert.ok(response.ok(), `WordPress media REST HTTP ${response.status()}`);
  const result = await response.json();
  return Array.isArray(result) ? result : [];
}

async function openPicker(page, dataRow, imageCol) {
  const selected = await page.evaluate(({ dataRow, imageCol }) => {
    const editor = window.tp?.editor;
    if (!editor) throw new Error('TablePress editor unavailable');
    const row = dataRow + 2;
    if (typeof editor.updateSelectionFromCoords === 'function') editor.updateSelectionFromCoords(imageCol, row, imageCol, row);
    else if (typeof editor.setSelectionFromCoords === 'function') editor.setSelectionFromCoords(imageCol, row, imageCol, row);
    else throw new Error('Native TablePress cell selection API unavailable');
    return window.tp?.helpers?.selection?.columns?.[0] === imageCol && window.tp?.helpers?.selection?.rows?.[0] === row;
  }, { dataRow, imageCol });
  assert.equal(selected, true, `Native history image cell selection failed row=${dataRow}`);
  const opened = await page.evaluate(() => {
    const open = window.tp?.callbacks?.insert_image?.open_dialog;
    if (typeof open !== 'function') return false;
    open();
    return true;
  });
  assert.equal(opened, true, 'Native TablePress Insert Image unavailable');
  await page.locator('.media-modal').waitFor({ state: 'visible', timeout: 20000 });
}

async function selectExisting(page, mediaId, basename) {
  const modal = page.locator('.media-modal:visible').last();
  const libraryTab = modal.locator('.media-menu-item').filter({ hasText: /^(Media Library|Thư viện phương tiện|Thư viện)$/i }).first();
  if (await libraryTab.count()) {
    await libraryTab.click();
    await page.waitForTimeout(400);
  }
  const search = modal.locator('input.media-search-input, input[type="search"]').last();
  if (await search.count()) {
    await search.fill(basename.replace(/\.[^.]+$/, ''));
    await page.waitForTimeout(900);
  }
  const attachment = modal.locator(`.attachment[data-id="${mediaId}"]`).first();
  if (!(await attachment.count())) return false;
  await attachment.waitFor({ state: 'visible', timeout: 5000 }).catch(() => null);
  if (!(await attachment.isVisible().catch(() => false))) return false;
  await attachment.click();
  return true;
}

async function uploadCurrent(page, file) {
  const modal = page.locator('.media-modal:visible').last();
  const uploadTab = modal.locator('#menu-item-upload, .media-menu-item').filter({ hasText: /^(Upload files|Tải tệp lên)$/i }).first();
  if (await uploadTab.count()) await uploadTab.click();
  const inputs = modal.locator('input[type="file"]');
  assert.ok(await inputs.count() > 0, 'WordPress media upload input unavailable');
  await inputs.last().setInputFiles(file);
  const tile = modal.locator('.attachment.selected[data-id], .attachment.details[data-id]').first();
  await tile.waitFor({ state: 'visible', timeout: 45000 });
  const mediaId = await tile.getAttribute('data-id');
  assert.match(String(mediaId || ''), /^\d+$/, 'Uploaded history media has no valid attachment ID');
  return Number(mediaId);
}

async function finishSelection(page, spec, mediaId) {
  const modal = page.locator('.media-modal:visible').last();
  const altInput = modal.locator('input[data-setting="alt"], textarea[data-setting="alt"]').last();
  if (await altInput.count()) await altInput.fill(spec.alt);

  let response = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      response = await page.request.get(`${wp}/wp-json/wp/v2/media/${mediaId}?_fields=id,source_url,mime_type`, { timeout: 20000 });
      if (response.ok()) break;
      if (attempt === 3) break;
    } catch (error) {
      if (attempt === 3) throw error;
      console.log(`INTRO_HISTORY_MEDIA_RETRY media_id=${mediaId} attempt=${attempt}`);
      await page.waitForTimeout(attempt * 1000);
    }
  }
  assert.ok(response?.ok(), `Selected history media REST HTTP ${response?.status() ?? 'unavailable'}`);
  const media = await response.json();
  assert.match(String(media?.mime_type || ''), /^image\//, 'Selected history media is not image');
  const mediaUrl = new URL(String(media?.source_url || ''), wp);
  assert.equal(mediaUrl.origin, wp, 'Selected history media escaped configured WordPress origin');
  assert.ok(mediaUrl.pathname.startsWith('/wp-content/uploads/'), 'Selected history media is outside uploads');
  const relativeSrc = mediaUrl.pathname;

  const insert = modal.locator('button.media-button-insert:visible').last();
  if (await insert.count() && await insert.isEnabled()) await insert.click();
  else await page.evaluate(() => window.wp?.media?.frame?.close?.());
  await page.locator('.media-modal').waitFor({ state: 'hidden', timeout: 20000 });
  await page.waitForTimeout(200);

  const bridge = await page.evaluate(({ relativeSrc, alt }) => {
    const helper = document.querySelector('#textarea-insert-helper');
    const callback = window.tp?.helpers?.editor?.insert_from_helper_textarea;
    if (!helper || typeof callback !== 'function') throw new Error('Native TablePress image bridge unavailable');
    const wrapper = document.createElement('div');
    wrapper.innerHTML = String(helper.value || '');
    let image = wrapper.querySelector('img');
    if (!image) {
      image = document.createElement('img');
      wrapper.append(image);
    }
    image.setAttribute('src', relativeSrc);
    image.setAttribute('alt', alt);
    image.setAttribute('loading', 'lazy');
    helper.value = image.outerHTML;
    callback.call(helper);
    return { src: relativeSrc, html: image.outerHTML };
  }, { relativeSrc, alt: spec.alt });
  assert.equal(bridge.src, relativeSrc, 'Native TablePress image bridge did not normalize relative source');
  return relativeSrc;
}

async function saveAndVerifyRow(page, row, spec, expectedSrc) {
  await saveTable(page);
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(800);
    const saved = await readTable(page).catch(() => null);
    const html = String(saved?.items?.[row]?.img || '');
    const src = html.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (imageHtml(html) && html.includes(spec.alt) && src === expectedSrc) return saved;
  }
  throw new Error(`History image read-back failed year=${spec.year} row=${row}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  const assets = await downloadUniqueAssets();

  await page.goto(`${wp}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), page.locator('#wp-submit').click()]);
  assert.equal(new URL(page.url()).origin, wp, 'WordPress history migration escaped configured origin');
  console.log('INTRO_HISTORY_ADMIN_AUTH=PASS');

  let table = await readTable(page);
  const timelineItems = (table?.items || []).filter((item) => String(item?.type || '') === 'timeline');
  assert.equal(new Set(timelineItems.map((item) => String(item?.meta || ''))).size, history.length, 'about_03 timeline year checkpoint differs');
  const imageCol = await ensureImageColumn(page, table);
  table = await readTable(page);

  const mediaByUrl = new Map();
  let writes = 0;
  for (const spec of history) {
    const row = (table.items || []).findIndex((item) => String(item?.type || '') === 'timeline' && String(item?.meta || '') === spec.year);
    assert.ok(row >= 0, `Timeline row not found for ${spec.year}`);
    const currentHtml = String(table.items?.[row]?.img || '');
    const currentSrc = currentHtml.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    if (imageHtml(currentHtml) && currentHtml.includes(spec.alt) && currentSrc.startsWith('/wp-content/uploads/')) {
      console.log(`INTRO_HISTORY_ROW=ALREADY_READY year=${spec.year} row=${row}`);
      continue;
    }

    await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${tableId}`, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data), null, { timeout: 30000 });
    await openPicker(page, row, imageCol);

    const asset = assets.get(spec.url);
    assert.ok(asset, `Downloaded asset missing for ${spec.year}`);
    let mediaId = mediaByUrl.get(spec.url) || 0;
    let reused = Boolean(mediaId);
    if (!mediaId) {
      const candidates = await mediaCandidates(page, asset.basename);
      const wantedStem = asset.basename.replace(/\.[^.]+$/, '').toLowerCase();
      const exact = candidates.find((item) => {
        try {
          const filename = decodeURIComponent(new URL(item.source_url).pathname.split('/').pop() || '').toLowerCase();
          return filename === asset.basename.toLowerCase() || filename.startsWith(`${wantedStem}-`);
        } catch { return false; }
      });
      if (exact?.id) {
        reused = await selectExisting(page, exact.id, asset.basename);
        if (reused) mediaId = Number(exact.id);
      }
      if (!mediaId) mediaId = await uploadCurrent(page, asset.file);
      mediaByUrl.set(spec.url, mediaId);
    } else {
      reused = await selectExisting(page, mediaId, asset.basename);
      assert.equal(reused, true, `Cached WordPress media not selectable for ${spec.year}`);
    }

    const relativeSrc = await finishSelection(page, spec, mediaId);
    table = await saveAndVerifyRow(page, row, spec, relativeSrc);
    writes++;
    console.log(`INTRO_HISTORY_ROW=PASS year=${spec.year} row=${row} reused=${reused ? 'YES' : 'NO'} src=${relativeSrc}`);
  }

  const finalTable = await readTable(page);
  const finalTimeline = (finalTable.items || []).filter((item) => String(item?.type || '') === 'timeline');
  const firstByYear = history.map((spec) => finalTimeline.find((item) => String(item?.meta || '') === spec.year));
  const srcs = firstByYear.map((item, index) => {
    const html = String(item?.img || '');
    assert.ok(imageHtml(html), `Final history image missing year=${history[index].year}`);
    assert.ok(html.includes(history[index].alt), `Final history alt missing year=${history[index].year}`);
    const src = html.match(/\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || '';
    assert.match(src, /^\/wp-content\/uploads\//, `Final history image is not relative year=${history[index].year}`);
    return src;
  });
  assert.equal(new Set(srcs).size, 13, 'Final history unique image count changed');
  console.log(`INTRO_HISTORY_MEDIA=PASS years=${history.length} unique_images=${new Set(srcs).size} writes=${writes} native_insert_image=YES relative_paths=YES`);
} finally {
  await browser.close();
}
