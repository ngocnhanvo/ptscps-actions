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
  const url = origin + '/wp-json/wp/v2/media?per_page=50&search=' + encodeURIComponent(stem) + '&_fields=id,source_url,alt_text,slug';
  // A temporary REST socket reset must not cause a duplicate media upload.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await page.request.get(url, { timeout:20000 });
      if (!response.ok()) throw new Error('WordPress media REST HTTP ' + response.status());
      const items = await response.json();
      if (!Array.isArray(items)) throw new Error('Invalid WordPress media REST list');
      return items;
    } catch (error) {
      console.warn('CMS_MEDIA_LOOKUP_RETRY=' + attempt + ' type=' + (error?.name || 'Error'));
      if (attempt === 3) throw new Error('Media lookup unavailable after bounded retries');
      await page.waitForTimeout(attempt * 1200);
    }
  }
  return [];
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
    const selected = window.tp?.helpers?.selection?.columns?.[0] === imageCol &&
      window.tp?.helpers?.selection?.rows?.[0] === row;
    return { api, selected };
  }, { dataRow, imageCol });
  assert(selection.api && selection.selected, `Native cell selection failed in ${table}`);
  console.log(`CMS_MEDIA_SELECTION=${table}:${dataRow} api=${selection.api}`);
  // ESC Table's own Insert Image workflow registers the helper textarea and
  // sends the WordPress media editor's inserted HTML back to the selected cell.
  const nativeInsert = await page.evaluate(() => {
    const open = window.tp?.callbacks?.insert_image?.open_dialog;
    if (typeof open !== 'function') return false;
    open();
    return true;
  });
  assert(nativeInsert, `Native TablePress Insert Image unavailable in ${table}`);
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
  // Scope the tab to the WordPress media modal: an admin sidebar link has
  // the same Vietnamese label and cannot be clicked through the modal overlay.
  const modal = page.locator('.media-modal:visible').last();
  const uploadTab = modal.locator('#menu-item-upload, .media-menu-item').filter({
    hasText: /^(Upload files|Tải tệp lên)$/i,
  }).first();
  if (await uploadTab.count()) await uploadTab.click();
  const inputs = modal.locator('input[type="file"]');
  assert(await inputs.count() > 0, 'WordPress media file input unavailable');
  await inputs.last().setInputFiles(file);
  await modal.locator('.attachment.selected, .attachment.details').first().waitFor({ state:'visible', timeout:45000 });
}

async function finishSelection(alt, basename) {
  const altInput = page.locator('.media-modal input[data-setting="alt"], .media-modal textarea[data-setting="alt"]').last();
  if (await altInput.count()) {
    await altInput.waitFor({ state:'visible', timeout:10000 });
    await altInput.fill(alt);
  }
  // The media frame's insert state may have an empty selection model even when
  // the visible attachment tile is selected. Verify the tile via WP's own REST.
  const selected = page.locator('.media-modal .attachment.selected[data-id], .media-modal .attachment.details[data-id]').last();
  const mediaId = await selected.getAttribute('data-id');
  assert(mediaId && /^\d+$/.test(mediaId), 'No selected WP media attachment tile');
  const response = await page.request.get(origin + '/wp-json/wp/v2/media/' + mediaId + '?_fields=id,source_url,mime_type', { timeout:20000 });
  assert(response.ok(), 'Selected WordPress media record could not be verified');
  const wpMedia = await response.json();
  assert(wpMedia?.mime_type?.startsWith('image/') && typeof wpMedia.source_url === 'string', 'Selected WordPress media is not an image');
  const uploaded = new URL(wpMedia.source_url);
  const stem = basename.replace(/\.[^.]+$/, '').toLowerCase();
  const filename = decodeURIComponent(uploaded.pathname.split('/').pop() || '').toLowerCase();
  assert(uploaded.origin === origin && uploaded.pathname.startsWith('/wp-content/uploads/') && filename.startsWith(stem),
    'Selected WordPress media does not match verified homepage source filename');
  const attachment = { id:wpMedia.id, url:wpMedia.source_url, type:'image' };
  const insert = page.locator('.media-modal button.media-button-insert:visible').last();
  assert(await insert.count() > 0, 'WordPress native Insert into post button unavailable');
  await insert.click();
  await page.locator('.media-modal').waitFor({ state:'hidden', timeout:20000 });
  await page.waitForTimeout(200); // Wait for the native helper textarea change callback.
  return attachment;
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
      const attachment = await finishSelection(spec.alt, spec.basename);
      // Use the native TablePress helper callback. If WordPress's asynchronous
      // send-to-editor response leaves it empty, rebuild the same image from the
      // selected WP library attachment (never from the legacy URL).
      const nativeBridge = await page.evaluate(({ attachment, alt, origin }) => {
        const helper = document.querySelector('#textarea-insert-helper');
        const callback = window.tp?.helpers?.editor?.insert_from_helper_textarea;
        if (!helper || typeof callback !== 'function') throw new Error('Native TablePress image callback missing');
        const imageUrl = new URL(attachment.url);
        if (imageUrl.origin !== origin || !imageUrl.pathname.startsWith('/wp-content/uploads/'))
          throw new Error('WordPress media URL is not in the verified destination uploads origin');
        let html = String(helper.value || '');
        const nativeHTML = /<img\b/i.test(html);
        if (!nativeHTML) {
          const img = document.createElement('img');
          img.src = imageUrl.href;
          img.alt = alt;
          img.loading = 'lazy';
          helper.value = img.outerHTML;
          html = helper.value;
        }
        callback.call(helper);
        return { helperLength:html.length, helperHasImage:/<img\b/i.test(html),
          usedSelectedMediaFallback:!nativeHTML, nativeHandler:true };
      }, { attachment, alt:spec.alt, origin });
      console.log('CMS_MEDIA_NATIVE_BRIDGE=' + JSON.stringify({ table, row:spec.row, ...nativeBridge }));
      // Read-only structural evidence from the native TablePress editor after Insert Image.
      // Never log cell content, authentication state or image URLs.
      const cellProbe = await page.evaluate(({ dataRow, imageCol }) => {
        const editor = window.tp?.editor;
        const grid = editor?.getData?.() || [];
        const coords = [dataRow, dataRow + 1, dataRow + 2].flatMap(y =>
          [imageCol, imageCol + 1].map(x => {
            const value = String(editor?.getValueFromCoords?.(x, y) ?? grid?.[y]?.[x] ?? '');
            return { x, y, length:value.length, img:/<img\b/i.test(value) };
          }));
        const matches = [];
        if (Array.isArray(grid)) grid.forEach((row, y) => {
          if (Array.isArray(row)) row.forEach((value, x) => {
            if (/<img\b/i.test(String(value ?? ''))) matches.push({ x, y });
          });
        });
        return { coords, matches:matches.slice(0,20), gridRows:grid.length,
          selectedType:typeof editor?.selectedCell,
          selectedText:String(editor?.selectedCell?.tagName || ''),
          selectionType:typeof editor?.selection };
      }, { dataRow:spec.row, imageCol });
      console.log('CMS_MEDIA_CELL_PROBE=' + JSON.stringify({ table, row:spec.row, ...cellProbe }));
      assert(cellProbe.matches.length > 0 || cellProbe.coords.some(c => c.img),
        `Native picker did not insert image ${table} row ${spec.row}`);
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
