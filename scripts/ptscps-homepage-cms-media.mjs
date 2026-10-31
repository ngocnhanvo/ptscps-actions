import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const origin = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!origin || !username || !password) throw new Error('WordPress configuration missing');

const specs = [
  { table:'home_00', row:0, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/ruby-banner.jpg', alt:'FPSO Ruby II hoạt động ngoài khơi - PTSC PPS' },
  { table:'home_01', row:0, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/fpsohome.jpg', alt:'Vận hành và bảo dưỡng FPSO FSO MOPU - PTSC PPS' },
  { table:'home_01', row:1, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/cungungkythuat.jpg', alt:'Đội ngũ nhân sự kỹ thuật PTSC PPS' },
  { table:'home_01', row:2, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/muasamgiacong.jpg', alt:'Thiết kế mua sắm và gia công chế tạo PTSC PPS' },
  { table:'home_01', row:3, url:'https://ptscps.com.vn/wp-content/uploads/2020/10/Bảo-dưỡng-FPSO-Ruby-II.png', alt:'Bảo dưỡng và sửa chữa công trình dầu khí - PTSC PPS' },
  { table:'home_02', row:0, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/banner3.jpg', alt:'Đội ngũ PTSC PPS trên công trình ngoài khơi' },
  { table:'home_04', row:0, url:'https://ptscps.com.vn/wp-content/uploads/2019/10/FPSO-PTSC-LAM-SON.jpg', alt:'FPSO PTSC Lam Son - dự án tiêu biểu PTSC PPS' },
  { table:'home_04', row:1, url:'https://ptscps.com.vn/wp-content/uploads/2023/09/dichvuPPS01-1.png', alt:'FSO PPS 01 - dự án tiêu biểu PTSC PPS' },
  { table:'home_04', row:2, url:'https://ptscps.com.vn/wp-content/uploads/2024/01/FPSO-LEWEK-EMAS.jpg', alt:'FPSO Lewek Emas - dự án tiêu biểu PTSC PPS' },
  { table:'home_05', row:0, url:'https://ptscps.com.vn/wp-content/uploads/2026/10/10-2026-001.jpg', alt:'Lan tỏa Văn Hóa Số tại PTSC PPS năm 2026' },
  { table:'home_05', row:1, url:'https://ptscps.com.vn/wp-content/uploads/2026/09/09-2026-041.jpg', alt:'Đêm hội Trung thu đoàn viên PTSC PPS 2026' },
  { table:'home_05', row:2, url:'https://ptscps.com.vn/wp-content/uploads/2026/09/09-2026-021.jpg', alt:'PTSC PPS chinh phục dự án năng lượng tái tạo Baltica 2' },
];

const assert = (value, message) => { if (!value) throw new Error(message); };
const safeName = (url) => decodeURIComponent(new URL(url).pathname.split('/').pop() || '').replace(/[^A-Za-z0-9._-]/g, '_');
const workDir = '/tmp/ptscps-home-media';
await mkdir(workDir, { recursive:true });

async function download(spec) {
  const response = await fetch(spec.url, { redirect:'follow', headers:{'User-Agent':'PTSCPS-Homepage-Media-Migration/1.0'} });
  assert(response.ok, `Legacy image HTTP ${response.status}: ${spec.url}`);
  const type = response.headers.get('content-type') || '';
  assert(type.startsWith('image/'), `Legacy asset is not an image: ${spec.url} (${type})`);
  const bytes = Buffer.from(await response.arrayBuffer());
  assert(bytes.length > 2048, `Legacy image is unexpectedly small: ${spec.url}`);
  const file = path.join(workDir, safeName(spec.url));
  await writeFile(file, bytes);
  return { ...spec, file, basename:new URL(spec.url).pathname.split('/').pop() || path.basename(file) };
}

// Fail before WordPress writes if any legacy source asset is unavailable.
const resolved = [];
for (const spec of specs) resolved.push(await download(spec));
console.log(`CMS_MEDIA_PREFLIGHT=PASS assets=${resolved.length}`);

const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
const page = await context.newPage();

async function mediaCandidates(basename) {
  const stem = basename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
  const response = await page.request.get(origin + '/wp-json/wp/v2/media?per_page=50&search=' + encodeURIComponent(stem) + '&_fields=id,source_url,alt_text,slug');
  if (!response.ok()) return [];
  const items = await response.json();
  return Array.isArray(items) ? items : [];
}

async function openPicker(table, dataRow, imageCol) {
  const selection = await page.evaluate(({ dataRow, imageCol }) => {
    const editor = window.tp?.editor;
    if (!editor) throw new Error('TablePress editor unavailable');
    const row = dataRow + 2;
    let api = '';
    if (typeof editor.updateSelectionFromCoords === 'function') {
      editor.updateSelectionFromCoords(imageCol, row, imageCol, row);
      api = 'editor.updateSelectionFromCoords';
    } else if (typeof editor.setSelectionFromCoords === 'function') {
      editor.setSelectionFromCoords(imageCol, row, imageCol, row);
      api = 'editor.setSelectionFromCoords';
    } else {
      const cell = typeof editor.getCellFromCoords === 'function'
        ? editor.getCellFromCoords(imageCol, row)
        : null;
      if (!cell) return { api:'', selected:false };
      cell.dispatchEvent(new MouseEvent('mousedown', { bubbles:true, cancelable:true, view:window }));
      cell.dispatchEvent(new MouseEvent('mouseup', { bubbles:true, cancelable:true, view:window }));
      cell.click();
      api = 'editor.getCellFromCoords+DOM';
    }
    const selected = Boolean(editor.selectedCell || editor.selection || editor.highlighted);
    return { api, selected };
  }, { dataRow, imageCol });
  assert(selection.api && selection.selected, `Native cell selection failed in ${table}`);
  console.log(`CMS_MEDIA_SELECTION=${table}:${dataRow} api=${selection.api}`);
  const button = page.locator('#js_btn_upload_image');
  assert(await button.count() === 1, `Native image button unavailable in ${table}`);
  await button.click();
  await page.locator('.media-modal').waitFor({ state:'visible', timeout:20000 });
}

async function selectExisting(mediaId, basename) {
  const search = page.locator('.media-modal input.media-search-input, .media-modal input[type="search"]').last();
  if (await search.count()) {
    await search.fill(basename.replace(/\.[^.]+$/, ''));
    await page.waitForTimeout(900);
  }
  const attachment = page.locator(`.media-modal .attachment[data-id="${mediaId}"]`);
  if (!(await attachment.count())) return false;
  await attachment.first().click();
  return true;
}

async function uploadCurrent(file) {
  const uploadTab = page.getByText(/^(Upload files|Tải tệp lên)$/i).last();
  if (await uploadTab.count()) await uploadTab.click();
  await page.waitForTimeout(300);
  const inputs = page.locator('.media-modal input[type="file"]');
  assert(await inputs.count() > 0, 'WordPress media file input unavailable');
  await inputs.last().setInputFiles(file);
  await page.locator('.media-modal .attachment.selected, .media-modal .attachment.details').first().waitFor({ state:'visible', timeout:45000 });
}

async function finishSelection(alt) {
  const altInput = page.locator('.media-modal input[data-setting="alt"], .media-modal textarea[data-setting="alt"]').last();
  if (await altInput.count()) {
    await altInput.waitFor({ state:'visible', timeout:10000 });
    await altInput.fill(alt);
  }
  const select = page.locator('.media-modal button.media-button-select:visible').last();
  assert(await select.count() > 0, 'WordPress media Select button unavailable');
  await select.click();
  await page.locator('.media-modal').waitFor({ state:'hidden', timeout:20000 });
}

async function saveAndReadBack(table, expectedRows) {
  const save = page.getByRole('button', { name:/^(Save Changes|Lưu thay đổi)$/i });
  assert(await save.count() > 0, `Save Changes unavailable ${table}`);
  await save.last().click();
  for (let i=0;i<10;i++) {
    await page.waitForTimeout(850);
    const response = await page.request.get(origin + '/wp-json/tablepress/v1/table/' + table);
    if (!response.ok()) continue;
    const data = await response.json();
    const rows = Array.isArray(data.items) ? data.items : [];
    if (expectedRows.every(({row,alt}) => String(rows[row]?.image || '').includes('<img') && String(rows[row]?.image || '').includes(alt))) return data;
  }
  throw new Error(`Image read-back failed ${table}`);
}

try {
  await page.goto(origin + '/wp-login.php', { waitUntil:'domcontentloaded', timeout:45000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//, { timeout:45000 }), page.locator('#wp-submit').click()]);
  assert(page.url().startsWith(origin + '/wp-admin/'), 'WordPress admin authentication not confirmed');
  console.log('CMS_MEDIA_ADMIN_AUTH=PASS');

  for (const table of [...new Set(resolved.map(x => x.table))]) {
    const tableSpecs = resolved.filter(x => x.table === table);
    const api = origin + '/wp-json/tablepress/v1/table/' + table;
    const beforeResponse = await page.request.get(api);
    assert(beforeResponse.ok(), `Missing table ${table}`);
    const before = await beforeResponse.json();
    const imageCol = (before.fields || []).findIndex(field => field?.key === 'image');
    assert(imageCol >= 0, `Image field missing ${table}`);
    const pending = tableSpecs.filter(spec => {
      const html = String(before.items?.[spec.row]?.image || '');
      return !(html.includes('<img') && html.includes(spec.alt));
    });
    if (!pending.length) {
      console.log(`CMS_MEDIA_TABLE=${table} ALREADY_READY`);
      continue;
    }

    await page.goto(origin + '/wp-admin/admin.php?page=tablepress&action=edit&table_id=' + encodeURIComponent(table), { waitUntil:'domcontentloaded', timeout:45000 });
    await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data), null, { timeout:30000 });
    const editorShape = await page.evaluate(() => ({
      keys:Object.keys(window.tp?.editor || {}).slice(0,80),
      nestedSelectors:Object.entries(window.tp?.editor || {}).flatMap(([key,value]) => value && typeof value === 'object'
        ? Object.keys(value).filter(name => /select.*cell|cell.*select/i.test(name)).map(name => `${key}.${name}`)
        : []),
    }));
    console.log('CMS_MEDIA_EDITOR_SHAPE=' + JSON.stringify(editorShape));

    for (const spec of pending) {
      await openPicker(table, spec.row, imageCol);
      const candidates = await mediaCandidates(spec.basename);
      const exact = candidates.find(item => {
        try { return decodeURIComponent(new URL(item.source_url).pathname.split('/').pop() || '').toLowerCase() === decodeURIComponent(spec.basename).toLowerCase(); }
        catch { return false; }
      });
      let reused = false;
      if (exact?.id) reused = await selectExisting(exact.id, spec.basename);
      if (!reused) await uploadCurrent(spec.file);
      await finishSelection(spec.alt);
      const cell = await page.evaluate(({ dataRow, imageCol }) => String(window.tp.editor.getDataAtCell(dataRow + 2, imageCol) || ''), { dataRow:spec.row, imageCol });
      assert(cell.includes('<img'), `Native picker did not insert image ${table} row ${spec.row}`);
      console.log(`CMS_MEDIA_CELL=${table}:${spec.row} native_insert=PASS reused=${reused ? 'YES':'NO'}`);
    }

    await saveAndReadBack(table, tableSpecs);
    console.log(`CMS_MEDIA_TABLE=${table} SAVE_READBACK=PASS images=${tableSpecs.length}`);
  }
  console.log(`CMS_MEDIA=PASS assets=${resolved.length} native_insert_image=YES alt_text=YES`);
} catch (error) {
  // Structural diagnostics only; no credentials/cookies/HTML dumps.
  console.error('CMS_MEDIA_FAILURE=' + (error instanceof Error ? error.message : String(error)));
  try {
    const diagnostics = await page.evaluate(() => ({
      url: location.pathname,
      mediaModal: Boolean(document.querySelector('.media-modal')),
      imageButton: Boolean(document.querySelector('#js_btn_upload_image')),
      fileInputs: document.querySelectorAll('.media-modal input[type="file"]').length,
      selectButtons: document.querySelectorAll('.media-modal button.media-button-select').length,
      editorReady: Boolean(window.tp?.editor),
      editorKeys: Object.keys(window.tp?.editor || {}).slice(0,80),
      nestedSelectors: Object.entries(window.tp?.editor || {}).flatMap(([key,value]) => value && typeof value === 'object'
        ? Object.keys(value).filter(name => /select.*cell|cell.*select/i.test(name)).map(name => `${key}.${name}`)
        : []),
    }));
    console.error('CMS_MEDIA_DIAGNOSTICS=' + JSON.stringify(diagnostics));
  } catch {}
  throw error;
} finally {
  await browser.close();
}
