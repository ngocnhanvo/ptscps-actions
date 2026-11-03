import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert.ok(wp && username && password, 'Configured WordPress/admin inputs missing');

const legacyUrl = 'https://ptscps.com.vn/thu-ngo.htm';
const awards = [
  { title: 'Bằng khen của Thủ tướng Chính phủ', alt: 'Bằng khen của Thủ tướng Chính phủ - PTSC PPS' },
  { title: 'Huân chương lao động hạng Ba', alt: 'Huân chương lao động hạng Ba - PTSC PPS' },
];
const workDir = '/tmp/ptscps-intro-awards';
await mkdir(workDir, { recursive: true });

const safeName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop() || 'award.jpg').replace(/[^A-Za-z0-9._-]/g, '_');
const imageHtml = (value) => /<img\b/i.test(String(value || ''));

async function readTable(page) {
  const response = await page.request.get(`${wp}/wp-json/tablepress/v1/table/about_00`, {
    timeout: 25000,
    headers: { 'Cache-Control': 'no-cache' },
  });
  assert.ok(response.ok(), `Unable to read about_00: HTTP ${response.status()}`);
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

  assert.deepEqual(keys.slice(0, 6), ['type', 'group', 'title', 'content', 'meta', 'href'], 'Unexpected about_00 schema before image migration');
  await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=about_00`, { waitUntil: 'domcontentloaded', timeout: 45000 });
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
      console.log(`INTRO_AWARD_SCHEMA=PASS image_col=${imageCol}`);
      return imageCol;
    }
  }
  throw new Error('about_00 img column did not persist');
}

async function discoverLegacyImages(context) {
  const legacy = await context.newPage();
  const response = await legacy.goto(legacyUrl, { waitUntil: 'load', timeout: 50000 });
  assert.equal(response?.status(), 200, `Legacy intro page HTTP ${response?.status()}`);
  const discovered = [];

  for (const award of awards) {
    const caption = legacy.getByText(award.title, { exact: true }).first();
    await caption.waitFor({ state: 'visible', timeout: 15000 });
    const url = await caption.evaluate((element) => {
      const captionRect = element.getBoundingClientRect();
      const candidates = Array.from(document.images).map((img) => {
        const rect = img.getBoundingClientRect();
        const anchor = img.closest('a');
        const anchorHref = anchor?.href || '';
        const imageHref = /\.(?:jpe?g|png|webp)(?:[?#].*)?$/i.test(anchorHref)
          ? anchorHref
          : (img.currentSrc || img.src || '');
        const horizontal = Math.abs((rect.left + rect.width / 2) - (captionRect.left + captionRect.width / 2));
        const vertical = Math.abs(captionRect.top - rect.bottom);
        return { imageHref, width: rect.width, height: rect.height, bottom: rect.bottom, horizontal, vertical };
      }).filter((item) => item.imageHref && item.width > 120 && item.height > 90 && item.bottom <= captionRect.top + 80);
      candidates.sort((a, b) => (a.vertical + a.horizontal * 0.65) - (b.vertical + b.horizontal * 0.65));
      return candidates[0]?.imageHref || '';
    });
    assert.match(url, /^https?:\/\//i, `Legacy award image not found: ${award.title}`);
    discovered.push({ ...award, url });
  }
  await legacy.close();
  assert.equal(new Set(discovered.map((item) => item.url)).size, awards.length, 'Legacy award images resolved to duplicate source');
  console.log(`INTRO_AWARD_LEGACY_DISCOVERY=PASS images=${discovered.length}`);
  return discovered;
}

async function downloadAward(spec) {
  const response = await fetch(spec.url, { redirect: 'follow', headers: { 'User-Agent': 'PTSCPS-Intro-Award-Migration/1.0' } });
  assert.ok(response.ok, `Legacy award image HTTP ${response.status}`);
  const type = response.headers.get('content-type') || '';
  assert.match(type, /^image\//i, 'Legacy award source is not an image');
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length > 2048, 'Legacy award image is unexpectedly small');
  const basename = safeName(spec.url);
  const file = path.join(workDir, basename);
  await writeFile(file, bytes);
  return { ...spec, file, basename };
}

async function mediaCandidates(page, basename) {
  const stem = basename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await page.request.get(`${wp}/wp-json/wp/v2/media?per_page=50&search=${encodeURIComponent(stem)}&_fields=id,source_url,mime_type`, { timeout: 20000 });
      if (!response.ok()) throw new Error(`WordPress media REST HTTP ${response.status()}`);
      const result = await response.json();
      return Array.isArray(result) ? result : [];
    } catch (error) {
      if (attempt === 3) throw error;
      await page.waitForTimeout(attempt * 1000);
    }
  }
  return [];
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
  assert.equal(selected, true, `Native award image cell selection failed row=${dataRow}`);
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
  const search = modal.locator('input.media-search-input, input[type="search"]').last();
  if (await search.count()) {
    await search.fill(basename.replace(/\.[^.]+$/, ''));
    await page.waitForTimeout(800);
  }
  const attachment = modal.locator(`.attachment[data-id="${mediaId}"]`).first();
  if (!(await attachment.count())) return false;
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
  assert.match(String(mediaId || ''), /^\d+$/, 'Uploaded award media has no valid attachment ID');
  return Number(mediaId);
}

async function finishSelection(page, spec, mediaId) {
  const modal = page.locator('.media-modal:visible').last();
  const altInput = modal.locator('input[data-setting="alt"], textarea[data-setting="alt"]').last();
  if (await altInput.count()) await altInput.fill(spec.alt);

  const response = await page.request.get(`${wp}/wp-json/wp/v2/media/${mediaId}?_fields=id,source_url,mime_type`, { timeout: 20000 });
  assert.ok(response.ok(), `Selected award media REST HTTP ${response.status()}`);
  const media = await response.json();
  assert.match(String(media?.mime_type || ''), /^image\//, 'Selected award media is not image');
  const mediaUrl = new URL(String(media?.source_url || ''), wp);
  assert.equal(mediaUrl.origin, wp, 'Selected award media escaped configured WordPress origin');
  assert.ok(mediaUrl.pathname.startsWith('/wp-content/uploads/'), 'Selected award media is outside uploads');

  const insert = modal.locator('button.media-button-insert:visible').last();
  if (await insert.count() && await insert.isEnabled()) await insert.click();
  else await page.evaluate(() => window.wp?.media?.frame?.close?.());
  await page.locator('.media-modal').waitFor({ state: 'hidden', timeout: 20000 });
  await page.waitForTimeout(200);

  const bridge = await page.evaluate(({ sourceUrl, alt }) => {
    const helper = document.querySelector('#textarea-insert-helper');
    const callback = window.tp?.helpers?.editor?.insert_from_helper_textarea;
    if (!helper || typeof callback !== 'function') throw new Error('Native TablePress image bridge unavailable');
    if (!/<img\b/i.test(String(helper.value || ''))) {
      const image = document.createElement('img');
      image.src = sourceUrl;
      image.alt = alt;
      image.loading = 'lazy';
      helper.value = image.outerHTML;
    }
    callback.call(helper);
    return /<img\b/i.test(String(helper.value || ''));
  }, { sourceUrl: mediaUrl.href, alt: spec.alt });
  assert.equal(bridge, true, 'Native TablePress image bridge produced no image HTML');
}

async function saveAndVerifyRow(page, row, alt) {
  await saveTable(page);
  for (let attempt = 0; attempt < 12; attempt++) {
    await page.waitForTimeout(800);
    const saved = await readTable(page).catch(() => null);
    const html = String(saved?.items?.[row]?.img || '');
    if (imageHtml(html) && html.includes(alt)) return saved;
  }
  throw new Error(`Award image read-back failed row=${row}`);
}

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
const page = await context.newPage();
try {
  const discovered = await discoverLegacyImages(context);
  const resolved = [];
  for (const spec of discovered) resolved.push(await downloadAward(spec));
  console.log(`INTRO_AWARD_ASSET_PREFLIGHT=PASS images=${resolved.length}`);

  await page.goto(`${wp}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 50000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout: 50000 }), page.locator('#wp-submit').click()]);
  assert.equal(new URL(page.url()).origin, wp, 'WordPress award migration escaped configured origin');
  console.log('INTRO_AWARD_ADMIN_AUTH=PASS');

  let table = await readTable(page);
  assert.deepEqual((table?.items || []).filter((item) => item?.type === 'award').map((item) => String(item?.title || '')), awards.map((item) => item.title), 'about_00 award rows differ from expected checkpoint');
  const imageCol = await ensureImageColumn(page, table);
  table = await readTable(page);

  const pending = resolved.map((spec) => ({
    ...spec,
    row: (table.items || []).findIndex((item) => String(item?.type || '') === 'award' && String(item?.title || '') === spec.title),
  })).filter((spec) => {
    assert.ok(spec.row >= 0, `Award row not found: ${spec.title}`);
    return !imageHtml(table.items?.[spec.row]?.img);
  });

  if (!pending.length) {
    console.log('INTRO_AWARD_MEDIA=ALREADY_READY images=2');
  } else {
    for (const spec of pending) {
      await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=about_00`, { waitUntil: 'domcontentloaded', timeout: 45000 });
      await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data), null, { timeout: 30000 });
      await openPicker(page, spec.row, imageCol);

      const candidates = await mediaCandidates(page, spec.basename);
      const wantedStem = spec.basename.replace(/\.[^.]+$/, '').toLowerCase();
      const exact = candidates.find((item) => {
        try {
          const filename = decodeURIComponent(new URL(item.source_url).pathname.split('/').pop() || '').toLowerCase();
          return filename === spec.basename.toLowerCase() || filename.startsWith(`${wantedStem}-`);
        } catch { return false; }
      });
      const reused = exact?.id ? await selectExisting(page, exact.id, spec.basename) : false;
      const mediaId = reused ? Number(exact.id) : await uploadCurrent(page, spec.file);
      await finishSelection(page, spec, mediaId);
      await saveAndVerifyRow(page, spec.row, spec.alt);
      console.log(`INTRO_AWARD_ROW=PASS row=${spec.row} reused=${reused ? 'YES' : 'NO'}`);
    }
  }

  const finalTable = await readTable(page);
  const finalAwards = (finalTable.items || []).filter((item) => item?.type === 'award');
  assert.equal(finalAwards.length, 2, 'Final about_00 award row count changed');
  assert.ok(finalAwards.every((item) => imageHtml(item.img)), 'Final about_00 award images incomplete');
  console.log('INTRO_AWARD_MEDIA=PASS images=2 native_insert_image=YES cms_field=img');
} finally {
  await browser.close();
}
