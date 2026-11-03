import { chromium } from 'playwright';

const origin = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!origin || !username || !password) throw Error('WordPress configuration missing');

const browser = await chromium.launch({ headless: true });
const p = await browser.newPage({ viewport: { width: 1420, height: 960 } });
const rawImagePattern = /(?:^|\/)(?:wp-content\/uploads\/)?[^/?#]+\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$/i;
const targetFilename = 'FPSO-PTSC-LAM-SON.jpg';

function imageKind(value) {
  const text = String(value ?? '').trim();
  if (!text) return 'EMPTY';
  if (/<img\b[^>]*\bsrc\s*=\s*["'][^"']+["'][^>]*>/i.test(text)) return 'IMG_HTML';
  if (rawImagePattern.test(text) || /\/wp-content\/uploads\//i.test(text)) return 'RAW_URL';
  return 'OTHER';
}

function basename(value) {
  const text = String(value ?? '').trim();
  const src = text.match(/<img\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/i)?.[1] || text;
  try {
    const pathname = new URL(src, origin).pathname;
    return decodeURIComponent(pathname.split('/').pop() || '');
  } catch {
    return src.split(/[?#]/)[0].split('/').pop() || '';
  }
}

try {
  await p.goto(origin + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await p.locator('#user_login').fill(username);
  await p.locator('#user_pass').fill(password);
  await Promise.all([
    p.waitForURL(/\/wp-admin\//, { timeout: 45000 }),
    p.locator('#wp-submit').click(),
  ]);
  console.log('CMS_AUDIT_AUTH=PASS');

  const listRes = await p.request.get(origin + '/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1', { timeout: 30000 });
  if (!listRes.ok()) throw Error('Cannot list ESC Tables HTTP ' + listRes.status());
  const tables = await listRes.json();
  const ids = (Array.isArray(tables) ? tables : [])
    .map((table) => String(table?.id || ''))
    .filter((id) => /^home_\d{2}(?:_[a-z]{2,})?$/i.test(id))
    .sort((a, b) => a.localeCompare(b));
  if (!ids.length) throw Error('No homepage ESC Tables found');

  const rawCells = [];
  const targetCells = [];
  const duplicateRaw = new Map();
  let imgHtmlCount = 0;
  let emptyImageFieldCount = 0;

  for (const id of ids) {
    const res = await p.request.get(origin + '/wp-json/tablepress/v1/table/' + encodeURIComponent(id), { timeout: 30000 });
    if (!res.ok()) throw Error('Missing table ' + id + ' HTTP ' + res.status());
    const data = await res.json();
    if (String(data.id) !== id) throw Error('Wrong Table ID ' + id);

    const items = Array.isArray(data.items) ? data.items : [];
    const fields = Array.isArray(data.fields) ? data.fields : [];
    const fieldKeys = fields.map((field) => String(field?.key || '').trim()).filter(Boolean);
    const imageFields = new Set(fieldKeys.filter((key) => /^(?:image|img|background|thumbnail|photo|logo)$/i.test(key)));
    const tableReport = [];

    items.forEach((item, row) => {
      Object.entries(item || {}).forEach(([field, value]) => {
        const kind = imageKind(value);
        const isDeclaredImageField = imageFields.has(field);
        if (!isDeclaredImageField && kind !== 'RAW_URL' && kind !== 'IMG_HTML') return;

        const file = basename(value);
        const entry = { row, field, kind, file };
        tableReport.push(entry);

        if (kind === 'IMG_HTML') imgHtmlCount += 1;
        if (kind === 'EMPTY' && isDeclaredImageField) emptyImageFieldCount += 1;
        if (kind === 'RAW_URL') {
          rawCells.push({ table: id, ...entry });
          const raw = String(value ?? '').trim();
          duplicateRaw.set(raw, (duplicateRaw.get(raw) || 0) + 1);
        }
        if (file.toLowerCase() === targetFilename.toLowerCase()) {
          targetCells.push({ table: id, ...entry });
        }
      });
    });

    console.log('CMS_IMAGE_TABLE=' + JSON.stringify({
      id,
      title: data.title,
      items: items.length,
      fields: fieldKeys,
      imageFields: [...imageFields],
      imageCells: tableReport,
    }));
  }

  const duplicateRawValues = [...duplicateRaw.entries()]
    .filter(([, count]) => count > 1)
    .map(([value, count]) => ({ file: basename(value), count }))
    .sort((a, b) => b.count - a.count || a.file.localeCompare(b.file));

  console.log('CMS_IMAGE_RAW_CELLS=' + JSON.stringify(rawCells));
  console.log('CMS_IMAGE_DUPLICATE_RAW=' + JSON.stringify(duplicateRawValues));
  console.log('CMS_IMAGE_TARGET=' + JSON.stringify({ filename: targetFilename, count: targetCells.length, cells: targetCells }));
  console.log('CMS_IMAGE_AUDIT=' + JSON.stringify({
    status: rawCells.length ? 'FAIL_RAW_URL' : 'PASS',
    tables: ids.length,
    imgHtmlCount,
    rawUrlCount: rawCells.length,
    emptyImageFieldCount,
    targetCount: targetCells.length,
    writes: 0,
  }));

  // Confirm the native Insert Image control still exists; no save/write occurs.
  const firstTable = ids.find((id) => !/_en$/i.test(id)) || ids[0];
  await p.goto(origin + '/wp-admin/admin.php?page=tablepress&action=edit&table_id=' + encodeURIComponent(firstTable), { waitUntil: 'domcontentloaded', timeout: 45000 });
  const nativeInsert = await p.evaluate(() => ({
    editorReady: Boolean(window.tp?.editor),
    insertImage: typeof window.tp?.callbacks?.insert_image?.open_dialog === 'function',
    insertHelper: typeof window.tp?.helpers?.editor?.insert_from_helper_textarea === 'function',
  }));
  console.log('CMS_IMAGE_NATIVE_INSERT=' + JSON.stringify(nativeInsert));
  if (!nativeInsert.editorReady || !nativeInsert.insertImage || !nativeInsert.insertHelper) {
    throw Error('Native ESC Table Insert Image workflow unavailable');
  }

  console.log('CMS_AUDIT=PASS; IMAGE_DATA_AUDITED=YES; WRITES=0');
} finally {
  await browser.close();
}
