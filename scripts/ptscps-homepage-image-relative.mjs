import assert from 'node:assert/strict';

// Only rewrite image-element attributes whose absolute URL is served by the
// configured WordPress Admin hostname. Never rewrite unrelated origins, paths,
// links, image alts, or plain text in an ESC Table cell.
function relativeMediaUrl(input, adminOrigin) {
  const raw = String(input);
  if (!/^(?:https?:)?\/\//i.test(raw)) return raw;
  try {
    const expected = new URL(adminOrigin);
    const parsed = new URL(raw, expected);
    if (parsed.hostname !== expected.hostname || parsed.username || parsed.password || parsed.port) return raw;
    if (!parsed.pathname.startsWith('/wp-content/')) return raw;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return raw;
  }
}

function normalizeImageHtml(value, adminOrigin) {
  const original = String(value ?? '');
  let changed = 0;
  const result = original.replace(/<img\b[^>]*>/gi, tag =>
    tag.replace(/(\s+)(src|srcset|data-src|data-srcset)(\s*=\s*)(["'])(.*?)\4/gi,
      (all, space, attr, separator, quote, contents) => {
        const normalized = /srcset$/i.test(attr)
          ? contents.replace(/(?:https?:)?\/\/[^\s,]+/gi, url => relativeMediaUrl(url, adminOrigin))
          : relativeMediaUrl(contents, adminOrigin);
        if (normalized === contents) return all;
        changed++;
        return `${space}${attr}${separator}${quote}${normalized}${quote}`;
      })
  );
  return { result, changed };
}

function runUnitTests() {
  const admin = 'https://admin-ptscps.thegioihosting.io.vn';
  const img = `<img alt="FPSO PTSC Lam Son" src="${admin}/wp-content/uploads/2026/10/FPSO-PTSC-LAM-SON.jpg" loading="lazy">`;
  assert.equal(normalizeImageHtml(img, admin).result,
    '<img alt="FPSO PTSC Lam Son" src="/wp-content/uploads/2026/10/FPSO-PTSC-LAM-SON.jpg" loading="lazy">');
  assert.equal(relativeMediaUrl(`${admin}/wp-content/uploads/a.jpg?size=4#image`, admin), '/wp-content/uploads/a.jpg?size=4#image');
  assert.equal(relativeMediaUrl('http://admin-ptscps.thegioihosting.io.vn/wp-content/uploads/a.jpg', admin), '/wp-content/uploads/a.jpg');
  assert.equal(relativeMediaUrl('//admin-ptscps.thegioihosting.io.vn/wp-content/uploads/a.jpg', admin), '/wp-content/uploads/a.jpg');
  for (const external of [
    'https://ptscps.com.vn/wp-content/uploads/a.jpg',
    'https://ptscps.thegioihosting.io.vn/wp-content/uploads/a.jpg',
    'https://cdn.admin-ptscps.thegioihosting.io.vn/wp-content/uploads/a.jpg',
    'https://admin-ptscps.thegioihosting.io.vn.evil.example/wp-content/uploads/a.jpg',
    'https://admin-ptscps.thegioihosting.io.vn:8443/wp-content/uploads/a.jpg',
    `${admin}/wp-json/wp/v2/media/1`,
    '/wp-content/uploads/a.jpg',
  ]) assert.equal(relativeMediaUrl(external, admin), external);
  const mixed = `<img alt="Keep https://admin-ptscps.thegioihosting.io.vn" src="https://ptscps.com.vn/wp-content/uploads/a.jpg" srcset="${admin}/wp-content/uploads/a-1.jpg 1x, https://elsewhere.example/a-2.jpg 2x">`;
  const out = normalizeImageHtml(mixed, admin);
  assert.equal(out.changed, 1);
  assert.ok(out.result.includes('src="https://ptscps.com.vn/wp-content/uploads/a.jpg"'));
  assert.ok(out.result.includes('srcset="/wp-content/uploads/a-1.jpg 1x, https://elsewhere.example/a-2.jpg 2x"'));
  assert.ok(out.result.includes('alt="Keep https://admin-ptscps.thegioihosting.io.vn"'));
  assert.equal(normalizeImageHtml('<a href="https://admin-ptscps.thegioihosting.io.vn/wp-content/uploads/x.jpg">Link</a>', admin).changed, 0);
  assert.equal(normalizeImageHtml(out.result, admin).changed, 0);
  console.log('IMAGE_RELATIVE_UNIT=PASS hostname_exact=YES external_unchanged=YES img_alt_unchanged=YES idempotent=YES');
}

if (process.argv.includes('--self-test')) {
  runUnitTests();
} else {
  const { chromium } = await import('playwright');
  const origin = process.env.WP_ORIGIN;
  const username = process.env.WP_ADMIN_USERNAME;
  const password = process.env.WP_ADMIN_PASSWORD;
  const apply = process.argv.includes('--apply');
  if (!origin || !username || !password) throw Error('WordPress configuration missing');
  const wp = new URL(origin);
  if (wp.protocol !== 'https:' || wp.pathname !== '/' || wp.port || wp.username || wp.password || !wp.hostname) {
    throw Error('Unexpected WordPress origin');
  }
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1420, height: 960 } });
  const report = { tables: 0, changedTables: 0, changedCells: 0, rewrittenAttrs: 0, untouchedImageCells: 0 };
  const tableUrl = id => origin + '/wp-json/tablepress/v1/table/' + encodeURIComponent(id);
  const getTable = async id => {
    let response;
    for (let attempt = 0; attempt < 3; attempt++) {
      response = await page.request.get(tableUrl(id), { timeout: 25000 }).catch(() => null);
      if (response?.ok()) return response.json();
      if (response && response.status() >= 400 && response.status() < 500 && response.status() !== 429) break;
      if (attempt < 2) await page.waitForTimeout(900 * (attempt + 1));
    }
    throw Error(`Cannot read table ${id} (${response?.status() || 'network'})`);
  };
  const snapshots = [];
  try {
    await page.goto(origin + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    await Promise.all([
      page.waitForURL(/\/wp-admin\//, { timeout: 45000 }),
      page.locator('#wp-submit').click(),
    ]);
    assert.ok(page.url().startsWith(origin + '/wp-admin/'), 'WP authentication not confirmed');
    console.log('CMS_IMAGE_RELATIVE_AUTH=PASS');

    const list = await page.request.get(origin + '/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1', { timeout: 30000 });
    assert.ok(list.ok(), 'Cannot list TablePress tables');
    const tableIndex = await list.json();
    assert.ok(Array.isArray(tableIndex), 'Unexpected TablePress list');
    const ids = tableIndex.map(x => String(x?.id || ''))
      .filter(id => /^home_\d{2}(?:_[a-z]{2,})?$/i.test(id))
      .sort((a,b) => a.localeCompare(b));
    assert.ok(ids.length >= 16, 'Homepage inventory unexpectedly incomplete');

    // Preflight every table before ANY write to prevent partial changes from
    // malformed cells or unexpected fields. Whole-table snapshot is used to
    // verify read-after-write without modifying nonimage content.
    for (const id of ids) {
      const before = await getTable(id);
      assert.equal(String(before?.id), id, 'Wrong TablePress ID');
      assert.ok(Array.isArray(before?.fields) && Array.isArray(before?.items), 'Invalid table schema');
      const fields = before.fields.map(x => String(x?.key || ''));
      const expected = structuredClone(before.items);
      const changed = [];
      for (let row = 0; row < before.items.length; row++) {
        for (const [field, value] of Object.entries(before.items[row] || {})) {
          if (typeof value !== 'string' || !/<img\b/i.test(value)) continue;
          const { result, changed: attrs } = normalizeImageHtml(value, origin);
          if (attrs) {
            assert.ok(fields.includes(field), `Unknown image field ${id}:${field}`);
            assert.ok(/<img\b[^>]*\balt\s*=\s*["'][^"']*["']/i.test(result), `Image ALT missing ${id}:${field}:${row}`);
            expected[row][field] = result;
            changed.push({ row, field, col: fields.indexOf(field), original: value, result, attrs });
          } else report.untouchedImageCells++;
        }
      }
      report.tables++;
      report.changedTables += Number(changed.length > 0);
      report.changedCells += changed.length;
      report.rewrittenAttrs += changed.reduce((sum, c) => sum + c.attrs, 0);
      console.log('CMS_IMAGE_RELATIVE_TABLE=' + JSON.stringify({ id, rows: before.items.length, changedCells: changed.length, rewrittenAttrs: changed.reduce((s,c) => s + c.attrs, 0) }));
      snapshots.push({ id, before, expected, changed });
    }
    console.log('CMS_IMAGE_RELATIVE_PLAN=' + JSON.stringify({ ...report, apply }));
    if (!apply) {
      console.log('CMS_IMAGE_RELATIVE_AUDIT=PASS writes=0');
    } else {
      for (const { id, before, expected, changed } of snapshots) {
        if (!changed.length) continue;
        // Make sure no other author changed the CMS during the preflight.
        const current = await getTable(id);
        assert.deepEqual(current.items, before.items, `Concurrent content change in ${id}`);
        await page.goto(origin + '/wp-admin/admin.php?page=tablepress&action=edit&table_id=' + encodeURIComponent(id), { waitUntil: 'domcontentloaded', timeout: 45000 });
        await page.waitForFunction(() => Boolean(window.tp?.editor?.getValueFromCoords && window.tp?.editor?.setValueFromCoords), null, { timeout: 25000 });
        const done = await page.evaluate(cells => {
          const ed = window.tp.editor;
          if (!window.tp?.helpers?.unsaved_changes?.set) throw Error('Native unsaved changes hook missing');
          for (const cell of cells) {
            // Native TablePress spreadsheet contains a two-row header in the
            // editor; verify exact expected original value before editing.
            const y = cell.row + 2;
            const stored = String(ed.getValueFromCoords(cell.col, y) ?? '');
            if (stored !== cell.original) throw Error(`Editor cell mismatch at ${cell.field}:${cell.row}`);
          }
          for (const cell of cells) ed.setValueFromCoords(cell.col, cell.row + 2, cell.result);
          window.tp.helpers.unsaved_changes.set();
          return { updated: cells.length };
        }, changed);
        assert.equal(done.updated, changed.length, `Unexpected native cell count ${id}`);
        const save = page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i });
        assert.ok(await save.count() > 0, `Missing native Save Changes for ${id}`);
        await save.last().click();
        let verified = false;
        for (let n = 0; n < 12; n++) {
          await page.waitForTimeout(1000);
          const fresh = await getTable(id);
          if (JSON.stringify(fresh.items) === JSON.stringify(expected)) { verified = true; break; }
        }
        assert.ok(verified, `Post-save data mismatch for ${id}; inspect before retrying`);
        console.log('CMS_IMAGE_RELATIVE_SAVED=' + JSON.stringify({ id, changedCells: changed.length, readBack: 'PASS' }));
      }
      // Second independent pass checks each targeted cell and untouched cell.
      for (const { id, expected } of snapshots) {
        const actual = await getTable(id);
        assert.deepEqual(actual.items, expected, `Post-migration parity mismatch ${id}`);
        for (const item of actual.items) {
          for (const value of Object.values(item || {})) {
            if (typeof value !== 'string' || !/<img\b/i.test(value)) continue;
            assert.equal(normalizeImageHtml(value, origin).changed, 0, `Admin absolute image URL remains in ${id}`);
          }
        }
      }
      console.log('CMS_IMAGE_RELATIVE_APPLY=PASS; all_tables_parity=PASS; foreign_domains_preserved=PASS');
    }
    console.log('CMS_IMAGE_RELATIVE_RESULT=' + JSON.stringify({ ...report, status: 'PASS', applied: apply }));
  } finally {
    await browser.close();
  }
}
