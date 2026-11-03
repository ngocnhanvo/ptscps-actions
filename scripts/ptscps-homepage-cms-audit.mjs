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

  // Verify the live Builder maps the current ESC Table cells to distinct rendered images.
  const builderUrl = origin + '/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page=82467';
  await p.goto(builderUrl, { waitUntil: 'domcontentloaded', timeout: 50000 });
  const builderFrame = p.frameLocator('#esc-vb-frame');
  await builderFrame.locator('[data-tablepress-preview]').first().waitFor({ state: 'visible', timeout: 50000 });
  await p.waitForTimeout(1200);
  const targets = await builderFrame.locator('body').evaluate(() => {
    const rows = [];
    for (const img of Array.from(document.querySelectorAll('[data-tablepress-preview] img'))) {
      const marker = img.closest('[data-esc-builder-image-row]');
      const root = img.closest('[data-tablepress-preview]');
      const tableId = root?.getAttribute('data-tablepress-preview') || '';
      const row = Number(marker?.getAttribute('data-esc-builder-image-row'));
      const field = marker?.getAttribute('data-esc-builder-image-field') ||
        (tableId === 'home_01' && marker ? 'img' : '');
      if (!marker || !field || !Number.isSafeInteger(row) || row < 0) continue;
      rows.push({ tableId, row, field, renderedSrc: img.currentSrc || img.getAttribute('src') || '' });
    }
    const unique = new Map();
    for (const item of rows) {
      const key = item.tableId + ':' + item.row + ':' + item.field;
      if (!unique.has(key)) unique.set(key, item);
    }
    return [...unique.values()];
  });
  const builderLamSon = targets.filter((item) => {
    try { return decodeURIComponent(new URL(item.renderedSrc).pathname).toLowerCase().endsWith('/' + targetFilename.toLowerCase()); }
    catch { return false; }
  });
  console.log('BUILDER_IMAGE_TARGETS=' + JSON.stringify(targets));
  console.log('BUILDER_IMAGE_LAM_SON=' + JSON.stringify(builderLamSon));
  console.log('BUILDER_IMAGE_RENDER_AUDIT=' + JSON.stringify({
    status: builderLamSon.length === 1 && builderLamSon[0].tableId === 'home_04' && builderLamSon[0].row === 0 ? 'PASS' : 'FAIL',
    targets: targets.length,
    lamSonTargets: builderLamSon.length,
    writes: 0,
  }));
  if (builderLamSon.length !== 1 || builderLamSon[0].tableId !== 'home_04' || builderLamSon[0].row !== 0) {
    throw Error('Live Builder maps FPSO-PTSC-LAM-SON.jpg outside the expected home_04 row 0 cell');
  }

  // Verify the actually deployed production homepage, not only live WordPress/Builder data.
  const clientOrigin = process.env.CLIENT_ORIGIN;
  if (!clientOrigin) throw Error('Frontend production origin missing');
  const response = await p.goto(clientOrigin + '/', { waitUntil: 'domcontentloaded', timeout: 50000 });
  if (!response || !response.ok()) throw Error('Production homepage HTTP ' + (response?.status() || 'NO_RESPONSE'));
  await p.waitForTimeout(2500);
  const production = await p.evaluate((filename) => {
    const needle = filename.toLowerCase();
    const context = (el) => {
      let node = el;
      for (let depth = 0; node && depth < 7; depth++, node = node.parentElement) {
        const heading = node.querySelector?.('h1,h2,h3,h4,h5,h6')?.textContent?.trim() || '';
        if (heading) return { tag: node.tagName, id: node.id || '', className: String(node.className || '').slice(0, 180), heading: heading.slice(0, 180) };
      }
      return { tag: el.tagName, id: el.id || '', className: String(el.className || '').slice(0, 180), heading: '' };
    };
    const imageMatches = [];
    const imageFiles = [];
    for (const img of Array.from(document.images)) {
      const refs = [img.currentSrc, img.getAttribute('src') || '', img.getAttribute('srcset') || ''].filter(Boolean);
      const primary = refs[0] || '';
      try { imageFiles.push(decodeURIComponent(new URL(primary, location.href).pathname).split('/').pop() || ''); } catch {}
      if (refs.some((value) => value.toLowerCase().includes(needle))) {
        imageMatches.push({
          src: img.currentSrc || img.getAttribute('src') || '',
          srcAttr: img.getAttribute('src') || '',
          alt: img.getAttribute('alt') || '',
          context: context(img),
        });
      }
    }
    const backgroundMatches = [];
    for (const el of Array.from(document.querySelectorAll('body *'))) {
      const bg = getComputedStyle(el).backgroundImage || '';
      if (bg.toLowerCase().includes(needle)) backgroundMatches.push({ backgroundImage: bg, context: context(el) });
    }
    return {
      href: location.href,
      title: document.title,
      imageCount: document.images.length,
      imageFiles: [...new Set(imageFiles.filter(Boolean))].slice(0, 120),
      imageMatches,
      backgroundMatches,
    };
  }, targetFilename);
  const productionTargetCount = production.imageMatches.length + production.backgroundMatches.length;
  console.log('PRODUCTION_IMAGE_AUDIT=' + JSON.stringify({
    status: productionTargetCount === 1 ? 'PASS' : 'FAIL',
    href: production.href,
    imageCount: production.imageCount,
    targetFilename,
    targetElements: productionTargetCount,
    imageMatches: production.imageMatches,
    backgroundMatches: production.backgroundMatches,
    writes: 0,
  }));
  console.log('PRODUCTION_IMAGE_FILES=' + JSON.stringify(production.imageFiles));
  if (productionTargetCount !== 1) {
    throw Error('Production homepage renders ' + productionTargetCount + ' elements using ' + targetFilename + '; expected exactly 1');
  }

  console.log('CMS_AUDIT=PASS; IMAGE_DATA_AUDITED=YES; BUILDER_RENDER_AUDITED=YES; PRODUCTION_RENDER_AUDITED=YES; WRITES=0');
} finally {
  await browser.close();
}
