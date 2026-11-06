/** Authenticated native Builder acceptance. Private tickets/backups never enter artifacts. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const require = createRequire(path.resolve('.qa/package.json'));
const { chromium } = require('playwright');
const origin = process.env.WP_ORIGIN;
const client = process.env.CLIENT_ORIGIN;
const stage = process.env.BUILDER_STAGE || 'verify';
const expectedAstro = process.env.PTSCPS_ASTRO_SOURCE_SHA;
assert(origin === 'https://admin-ptscps.thegioihosting.io.vn');
assert(client === 'https://ptscps.thegioihosting.io.vn');
assert(/^[a-f0-9]{40}$/.test(expectedAstro || ''));
assert(process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD);
const artifacts = 'artifacts/visual-builder';
await mkdir(artifacts, { recursive: true });
const checks = [];
const log = (event, data = {}) => console.log(event + '=' + JSON.stringify(data));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1600, height: 1100 } });
const page = await context.newPage();
page.setDefaultTimeout(30000);
page.on('dialog', dialog => dialog.accept());
let pageId = 0;
const pending = [];

async function login() {
  await page.goto(origin + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await page.locator('#wp-submit').click();
  await page.waitForURL(url => url.origin === origin &&
    (url.pathname.startsWith('/wp-admin/') || url.searchParams.get('action') === 'confirm_admin_email'), { timeout: 45000 });
  await page.goto(origin + '/wp-admin/', { waitUntil: 'domcontentloaded', timeout: 45000 });
}
async function openBuilder(mode = 'desktop') {
  const url = new URL(origin + '/wp-admin/edit.php');
  url.search = new URLSearchParams({ post_type: 'page', page: 'esc-visual-builder',
    ...(pageId ? { esc_vb_page: String(pageId) } : {}), esc_vb_view: mode }).toString();
  await page.goto(url.href, { waitUntil: 'domcontentloaded', timeout: 45000 });
  if (!pageId && stage !== 'preflight') {
    const preferred = await page.locator('#esc-vb-page option').evaluateAll(options =>
      options.find(option => /^Trang chủ(?:\s|$)/i.test(option.textContent.trim()))?.value);
    if (preferred && preferred !== await page.locator('#esc-vb-page').inputValue()) {
      await page.locator('#esc-vb-page').selectOption(preferred);
      await page.locator('.esc-vb-page-form').getByRole('button', { name: 'Mở trang', exact: true }).click();
      await page.waitForURL(current => current.searchParams.get('esc_vb_page') === preferred);
    }
  }
  const iframe = page.locator('#esc-vb-frame');
  await iframe.waitFor({ state: 'attached' });
  const preview = new URL(await iframe.getAttribute('src'));
  assert.equal(preview.origin, client, 'Builder must use the configured PTSCPS Astro origin');
  assert(/^\/esc-builder\/preview\/\d+$/.test(preview.pathname));
  assert(/^[a-f0-9]{64}$/.test(preview.searchParams.get('ticket') || ''));
  pageId = Number(await page.locator('#esc-vb-page').inputValue());
  assert(pageId > 0);
  if (stage === 'preflight') return null;
  const frame = await iframe.elementHandle().then(handle => handle.contentFrame());
  if (stage === 'diagnose') return frame;
  await frame.locator('html.esc-builder-preview').waitFor({ state: 'attached', timeout: 60000 });
  await frame.locator('[data-tablepress-preview]').first().waitFor({ state: 'attached', timeout: 60000 });
  await page.waitForFunction(() => typeof window.escVBGetTicket === 'function');
  return frame;
}
async function api(endpoint, body) {
  return page.evaluate(async ({ endpoint, body, origin, pageId }) => {
    const nonce = window.wpApiSettings?.nonce ||
      document.documentElement.innerHTML.match(/"nonce"\s*:\s*"([a-f0-9]+)"/)?.[1];
    if (!nonce) throw Error('Native WordPress REST nonce missing');
    const ticket = await window.escVBGetTicket(false);
    const response = await fetch(origin + '/wp-json/esc-builder/v1/' + endpoint, {
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-WP-Nonce': nonce },
      body: JSON.stringify({ ...body, page_id: pageId, ticket }), signal: AbortSignal.timeout(30000),
    });
    return { status: response.status, body: await response.json() };
  }, { endpoint, body, origin, pageId });
}
async function okApi(endpoint, body) {
  const response = await api(endpoint, body);
  assert.equal(response.status, 200, endpoint + ' HTTP ' + response.status + ': ' + response.body?.code);
  return response.body;
}
async function uiSave(panel, endpoint) {
  const responsePromise = page.waitForResponse(response =>
    response.url() === origin + '/wp-json/esc-builder/v1/' + endpoint && response.request().method() === 'POST');
  await panel.getByRole('button', { name: 'Lưu WordPress', exact: true }).click();
  const response = await responsePromise;
  const result = await response.json();
  assert.equal(response.status(), 200, endpoint + ': ' + result?.code);
  assert.equal(result.saved, true);
  assert(/^[a-f0-9]{64}$/.test(result.version || ''));
  return result;
}
async function backup(item) {
  pending.push(item);
  // Ephemeral runner-only backup, excluded from all artifact upload paths.
  await writeFile('.qa/builder-rollback.json', JSON.stringify(pending), { mode: 0o600 });
}
async function restoreAll() {
  for (const item of [...pending].reverse()) {
    if (item.restored) continue;
    const current = await okApi(item.read, item.identity);
    if (current[item.key] === item.before[item.key]) { item.restored = true; continue; }
    assert.equal(current[item.key], item.temporary, 'Concurrent edit: do not overwrite a newer native value');
    if (item.savedVersion) assert.equal(current.version, item.savedVersion, 'Concurrent source version changed');
    const restored = await okApi(item.save, { ...item.identity,
      [item.key]: item.before[item.key], expected_version: current.version });
    assert.equal(restored[item.key], item.before[item.key]);
    const readback = await okApi(item.read, item.identity);
    assert.equal(readback[item.key], item.before[item.key]);
    if (item.read === 'footer-info') {
      assert.equal(readback.version, item.before.version, 'Restore must recover the original Info field');
    } else {
      // Native Menu versions include post_modified_gmt, which correctly changes
      // on each save. Compare every editable field rather than undoing WP history.
      for (const key of ['item_id', 'menu_id', 'lang', 'label', 'description', 'link_mode',
        'menu_type', 'mega_position', 'mega_header_texts', 'parent_id', 'order_position',
        'order_total', 'custom_url', 'reference_id', 'target']) {
        assert.deepEqual(readback[key], item.before[key], 'Restored Menu field differs: ' + key);
      }
    }
    item.restored = true;
    log('PTSCPS_BUILDER_CMS_RESTORE', { source: item.read, verified: true });
  }
  await rm('.qa/builder-rollback.json', { force: true });
}
async function provenance() {
  const evidence = JSON.parse(await readFile(artifacts + '/build.json', 'utf8'));
  return evidence.provenance;
}
async function nativeBuild() {
  const deployed = await provenance();
  if (deployed?.commit === expectedAstro && deployed?.branch === 'master') {
    log('PTSCPS_BUILDER_BUILD', { reused: true, commit: expectedAstro, run: deployed.run_id || null });
    await writeFile(artifacts + '/native-build.json', JSON.stringify({ reused: true, provenance: deployed }, null, 2));
    return;
  }
  await page.goto(origin + '/wp-admin/admin.php?page=vcs-build-trigger', { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#vcs-build-btn-main').waitFor();
  const reconcile = async () => page.evaluate(async () => {
    const cfg = window.vcsBuild;
    if (!cfg?.ajax_url || !cfg?.nonce) throw Error('Native build status configuration missing');
    const response = await fetch(cfg.ajax_url, { method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: new URLSearchParams({ action: 'vcs_check_build_status', nonce: String(cfg.nonce) }),
      signal: AbortSignal.timeout(25000) });
    const body = await response.json();
    if (!response.ok || !body?.success) throw Error('Native build status reconciliation failed');
    return { status: body.data?.status, active: body.data?.build_active };
  });
  await reconcile(); // WordPress releases its own completed-run lock; no direct lock writes.
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
  let state = await page.evaluate(() => ({ configured: window.vcsBuild?.build_configured, active: window.vcsBuild?.initial_active }));
  assert([true, 1, '1'].includes(state.configured), 'Native Build Website is not configured');
  if (state.active) {
    const result = await waitForWordPressBuild({ page, log, expectTriggered: true, buildTimeoutMs: 900000 });
    await reconcile();
    execFileSync('python3', ['scripts/ptscps-visual-builder-provenance.py', 'inspect'], { stdio: 'inherit' });
    if ((await provenance())?.commit === expectedAstro) {
      await writeFile(artifacts + '/native-build.json', JSON.stringify({ ...result, reused_existing: true }, null, 2));
      log('PTSCPS_BUILDER_BUILD', { ...result, reused_existing: true });
      return;
    }
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 45000 });
    state = await page.evaluate(() => ({ active: window.vcsBuild?.initial_active }));
    assert(!state.active, 'WordPress has not released its completed native build lock');
  }
  await page.locator('#vcs-force-build').check();
  const responsePromise = page.waitForResponse(response =>
    response.url().startsWith(origin + '/wp-admin/admin-ajax.php') &&
    String(response.request().postData() || '').includes('action=vcs_trigger_build'), { timeout: 45000 });
  await page.locator('#vcs-build-btn-main').click();
  const response = await responsePromise;
  const body = await response.json();
  assert.equal(body?.success, true, 'Native WordPress rejected build');
  log('PTSCPS_BUILDER_BUILD', { triggered_via_native_wordpress: true });
  const result = await waitForWordPressBuild({ page, log, expectTriggered: true,
    discoveryTimeoutMs: 180000, buildTimeoutMs: 900000 });
  // The next read-only FTPS step verifies the private deployment marker.
  await writeFile(artifacts + '/native-build.json', JSON.stringify(result, null, 2));
  log('PTSCPS_BUILDER_BUILD', result);
}

async function verifyFinalImageControls() {
  assert.equal((await provenance())?.commit, expectedAstro);
  for (const mode of ['desktop','mobile']) {
    const frame=await openBuilder(mode);
    const hero=frame.locator('[data-tablepress-preview="home_00"]').first();
    const editor=hero.locator('[data-esc-builder-image-affordance]:visible').first();
    await editor.waitFor({state:'visible'});
    const beforeUrl=frame.url();
    const waitSlide=async row=>frame.waitForFunction(row=>Array.from(document.querySelectorAll(
      '[data-tablepress-preview="home_00"] img[data-pps-slide][data-esc-builder-image-row]')).some(image=>{
        const bounds=image.getBoundingClientRect();
        return image.getAttribute('data-esc-builder-image-row')===String(row)&&bounds.width>8&&bounds.height>8&&getComputedStyle(image).opacity==='1';
      }),row,{timeout:7000});
    await hero.locator('[data-pps-slide-dot="0"]:visible').first().click();await waitSlide(0);
    await hero.locator('[data-pps-slide-next]:visible').first().click();await waitSlide(1);
    await hero.locator('[data-pps-slide-prev]:visible').first().click();await waitSlide(0);
    const rendered=await editor.getAttribute('data-esc-builder-image-version');
    const row=Number(await editor.getAttribute('data-esc-builder-image-row'));
    const readPromise=page.waitForResponse(response=>response.url()===origin+'/wp-json/esc-builder/v1/editable-images'&&response.request().method()==='POST');
    await editor.click();
    const response=await readPromise;const result=await response.json();
    assert.equal(response.status(),200);assert.equal(result.table_id,'home_00');
    assert.equal(result.field,'image');assert.equal(result.version,rendered);
    assert(result.images.some(image=>image.row===row&&image.editable===true&&image.seo));
    await page.locator('#esc-vb-image-seo').waitFor({state:'visible'});
    assert(frame.url()===beforeUrl,'Preview controls must not navigate');
    assert.equal(context.pages().length,1);
    checks.push({viewport:mode,background_image_selection:'PASS',exact_version:'PASS',
      native_banner_prev_next_dot:'PASS',no_cms_write:true});
    await page.screenshot({path:artifacts+'/live-final-'+mode+'.png',fullPage:true});
    log('PTSCPS_BUILDER_ACCEPTANCE',{viewport:mode,background:'PASS',banner_controls:'PASS',no_cms_write:true});
  }
  await writeFile(artifacts+'/live-final-result.json',JSON.stringify({checks,pageId,astro:expectedAstro,
    source_and_shared_acceptance_run:42167548844,original_image_and_viewport_run:42168288827,restored_all:true},null,2));
}

try {
  await login();
  if (stage === 'preflight') {
    await openBuilder();
    log('PTSCPS_BUILDER_PREFLIGHT', { authenticated: true, native_builder: true, origin_verified: true, pageId });
  } else if (stage === 'diagnose') {
    const frame = await openBuilder();
    const verification = await api('verify', { bootstrap: true });
    log('PTSCPS_BUILDER_WP_DIAGNOSTIC', { status: verification.status,
      pageId: verification.body?.page_id, shared: Object.keys(verification.body?.shared_regions || {}),
      snapshot: Object.keys(verification.body?.shared_regions?.snapshot || {}),
      lang: verification.body?.shared_regions?.snapshot?.lang,
      bootstrap: Object.keys(verification.body?.bootstrap || {}) });
    const previewUrl = await page.locator('#esc-vb-frame').getAttribute('src');
    try {
      const response = await context.request.get(previewUrl, { timeout: 45000 });
      log('PTSCPS_BUILDER_SSR_DIAGNOSTIC', { status: response.status(),
        contentType: response.headers()['content-type'], timing: response.headers()['server-timing'],
        plainError: (await response.text()).trim() === 'Internal server error' ? 'Internal server error' : 'REDACTED' });
    } catch (error) {
      // Playwright errors contain the full bearer-ticket URL: never rethrow them.
      log('PTSCPS_BUILDER_SSR_DIAGNOSTIC', { transportError: /ECONNRESET/.test(String(error?.message)) ? 'ECONNRESET' : String(error?.name || 'request_failure') });
    }
  } else if (stage === 'build') {
    await nativeBuild();
  } else if (process.env.BUILDER_QA_FINAL_CONTROLS === '1') {
    await verifyFinalImageControls();
    log('PTSCPS_VISUAL_BUILDER_FINAL',{result:'PASS',checks:checks.length,no_cms_write:true});
  } else {
    assert.equal((await provenance())?.commit, expectedAstro, 'Pinned deployed source must be verified before live edits');
    let frame = await openBuilder();
    if (process.env.BUILDER_QA_SKIP_SHARED !== '1') {
    const menuNode = frame.locator('[data-esc-vb-menu-item-id]:visible').first();
    const isToggle = await menuNode.locator('button[data-menu-trigger],button[data-submenu-trigger],button[data-menu-toggle]').count() > 0;
    await menuNode.click({ modifiers: isToggle ? ['Alt'] : [] });
    const menuPanel = page.locator('#esc-vb-menu-editor');
    await menuPanel.waitFor({ state: 'visible' });
    await page.locator('#esc-vb-menu-label').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('esc-vb-menu-label')?.disabled &&
      !!document.getElementById('esc-vb-menu-label')?.value);
    const itemId = Number(await menuNode.getAttribute('data-esc-vb-menu-item-id'));
    const menuBefore = await okApi('menu-item', { item_id: itemId });
    const menuTemporary = menuBefore.label.slice(0, 130) + ' · VB QA';
    await page.locator('#esc-vb-menu-label').fill(menuTemporary);
    await menuPanel.getByRole('button', { name: 'Hủy thay đổi', exact: true }).click();
    assert.equal(await page.locator('#esc-vb-menu-label').inputValue(), menuBefore.label);
    assert.equal((await okApi('menu-item', { item_id: itemId })).version, menuBefore.version);
    const menuBackup = { read: 'menu-item', save: 'save-menu-item', identity: { item_id: itemId },
      key: 'label', before: menuBefore, temporary: menuTemporary };
    await backup(menuBackup);
    await page.locator('#esc-vb-menu-label').fill(menuTemporary);
    const menuSaved = await uiSave(menuPanel, 'save-menu-item');
    menuBackup.savedVersion = menuSaved.version;
    assert.equal(menuSaved.label, menuTemporary);
    assert.equal((await okApi('menu-item', { item_id: itemId })).label, menuTemporary);
    frame = await openBuilder();
    assert((await frame.locator('[data-esc-vb-menu-item-id="' + itemId + '"]').first().textContent()).includes(menuTemporary),
      'Reloaded preview must read fresh native Header');
    await restoreAll();
    checks.push({ source: 'Header', select: 'PASS', cancel: 'PASS', save: 'PASS', reload: 'PASS', restore: 'PASS' });
    await writeFile(artifacts + '/live-progress.json', JSON.stringify({ checks, pageId, restored_all: true }, null, 2));
    log('PTSCPS_BUILDER_ACCEPTANCE', { source: 'Header', result: 'PASS', restored: true });

    frame = await openBuilder();
    const footerNode = frame.locator('[data-esc-vb-footer-field="tencongty"]:visible').first();
    await footerNode.click();
    const footerPanel = page.locator('#esc-vb-footer-editor');
    await footerPanel.waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('esc-vb-footer-value')?.disabled);
    const footerBefore = await okApi('footer-info', { field: 'tencongty' });
    const footerTemporary = footerBefore.value.slice(0, 180) + ' · VB QA';
    await page.locator('#esc-vb-footer-value').fill(footerTemporary);
    await footerPanel.getByRole('button', { name: 'Hủy thay đổi', exact: true }).click();
    assert.equal(await page.locator('#esc-vb-footer-value').inputValue(), footerBefore.value);
    assert.equal((await okApi('footer-info', { field: 'tencongty' })).version, footerBefore.version);
    const footerBackup = { read: 'footer-info', save: 'save-footer-info', identity: { field: 'tencongty' },
      key: 'value', before: footerBefore, temporary: footerTemporary };
    await backup(footerBackup);
    await page.locator('#esc-vb-footer-value').fill(footerTemporary);
    const footerSaved = await uiSave(footerPanel, 'save-footer-info');
    footerBackup.savedVersion = footerSaved.version;
    assert.equal(footerSaved.value, footerTemporary);
    assert.equal((await okApi('footer-info', { field: 'tencongty' })).value, footerTemporary);
    frame = await openBuilder();
    assert((await frame.locator('[data-esc-vb-footer-field="tencongty"]').first().textContent()).includes(footerTemporary),
      'Reloaded preview must read fresh native Info');
    await restoreAll();
    checks.push({ source: 'Footer Info', select: 'PASS', cancel: 'PASS', save: 'PASS', reload: 'PASS', restore: 'PASS' });
    await writeFile(artifacts + '/live-progress.json', JSON.stringify({ checks, pageId, restored_all: true }, null, 2));
    log('PTSCPS_BUILDER_ACCEPTANCE', { source: 'Footer Info', result: 'PASS', restored: true });
    }

    frame = await openBuilder();
    if (process.env.BUILDER_QA_SKIP_TEXT !== '1') {
    const textNodes = frame.locator('[data-esc-builder-cell-row][data-esc-builder-cell-field]:visible');
    const textIndex = await textNodes.evaluateAll(nodes => nodes.findIndex(node => {
      const bounds = node.getBoundingClientRect();
      return bounds.width > 8 && bounds.height > 8 && !node.closest('[data-esc-builder-image-row],.sr-only,[aria-hidden="true"]');
    }));
    assert(textIndex >= 0, 'A visible exact text cell must be available');
    const textNode = textNodes.nth(textIndex);
    await textNode.waitFor({ state: 'visible' });
    await textNode.click();
    await page.locator('#esc-vb-text-editor').waitFor({ state: 'visible' });
    await page.waitForFunction(() => !document.getElementById('esc-vb-edit-title')?.disabled);
    const textBefore = await page.locator('#esc-vb-edit-title').inputValue();
    await page.locator('#esc-vb-edit-title').fill(textBefore + ' · bản nháp kiểm tra');
    await page.locator('#esc-vb-edit-cancel').click();
    assert.equal(await page.locator('#esc-vb-edit-title').inputValue(), textBefore);
    const tableId = await textNode.evaluate(node => node.closest('[data-tablepress-preview]').getAttribute('data-tablepress-preview'));
    const stale = await api('editable-text', { table_id: tableId, rendered_version: '0'.repeat(64) });
    assert.equal(stale.status, 409);
    assert.equal(stale.body.code, 'editor_preview_stale');
    checks.push({ source: 'ESC Table', exact_selection: 'PASS', cancel: 'PASS', stale_version: '409' });
    }
    const heroButtons = await frame.locator('[data-tablepress-preview="home_00"] button').evaluateAll(nodes =>
      nodes.map(node => Object.fromEntries(Array.from(node.attributes)
        .filter(attr => attr.name.startsWith('data-') || ['type','aria-label','aria-controls','role'].includes(attr.name))
        .map(attr => [attr.name, attr.value]))));
    log('PTSCPS_BUILDER_NATIVE_CONTROLS', { heroButtons });
    const images = frame.locator('[data-esc-builder-image-row][data-esc-builder-image-field]:not([aria-hidden="true"]):visible');
    assert(await images.count() > 0, 'Live image bindings must exist');
    let clickableImage;
    for (let index = 0; index < Math.min(await images.count(), 20); index++) {
      const candidate = images.nth(index);
      try { await candidate.click({ trial: true, timeout: 1500 }); clickableImage = candidate; break; }
      catch { /* Covered background images are inspected through their own affordance. */ }
    }
    assert(clickableImage, 'A native image must be reachable by an actual pointer click');
    await clickableImage.click();
    await page.locator('#esc-vb-image-editor').waitFor({ state: 'visible' });
    await page.locator('#esc-vb-image-seo').waitFor({ state: 'visible' });
    checks.push({ source: 'ESC Table image', exact_selection: 'PASS', media_inspector: 'PASS', no_media_write: true });
    await writeFile(artifacts + '/live-progress.json', JSON.stringify({ checks, pageId, restored_all: true }, null, 2));
    log('PTSCPS_BUILDER_ACCEPTANCE', { source: 'ESC Table text/image', result: 'PASS', no_cms_write: true });
    await page.screenshot({ path: artifacts + '/live-desktop.png', fullPage: true });
    for (const mode of ['desktop', 'mobile']) {
      frame = await openBuilder(mode);
      await frame.locator('[data-esc-vb-region-state="editable"]').first().waitFor({ state: 'attached' });
      const beforeUrl = frame.url();
      const anchor = frame.locator('a[href]:visible').first();
      await anchor.click({ button: 'middle' });
      assert(frame.url() === beforeUrl, 'Preview must not navigate');
      assert.equal(context.pages().length, 1);
      assert(await frame.locator('[data-esc-vb-region-state="editable"]').count() > 0);
      await page.screenshot({ path: artifacts + '/live-' + mode + '-restored.png', fullPage: true });
      checks.push({ viewport: mode, private_preview: 'PASS', navigation: 'BLOCKED', editability: 'PASS' });
    }
    const publicPage = await context.newPage();
    const publicResponse = await publicPage.goto(client, { waitUntil: 'domcontentloaded', timeout: 45000 });
    assert.equal(publicResponse.status(), 200);
    assert.equal(await publicPage.locator('[data-esc-vb-footer-field], [data-esc-vb-menu-item-id]').count(), 0);
    assert(!(await publicPage.locator('body').innerText()).includes('· VB QA'));
    await publicPage.close();
    await writeFile(artifacts + '/live-result.json', JSON.stringify({ checks, pageId, astro: expectedAstro,
      restored_all: pending.every(item => item.restored), scope: 'Native WordPress Admin + REST + private Astro preview' }, null, 2));
    log('PTSCPS_VISUAL_BUILDER_LIVE', { result: 'PASS', checks: checks.length, restored_all: true });
  }
} catch (error) {
  // Capture visible UI only: never dump iframe URLs, tickets, nonces or backup values.
  if (stage === 'verify') {
    await page.screenshot({ path: artifacts + '/live-failure.png', fullPage: true }).catch(() => {});
    const state = await page.evaluate(() => ({
      menu: document.querySelector('#esc-vb-menu-editor')?.hidden,
      footer: document.querySelector('#esc-vb-footer-editor')?.hidden,
      text: document.querySelector('#esc-vb-text-editor')?.style.display,
      source: document.querySelector('#esc-vb-source-state')?.textContent?.slice(0, 250),
    })).catch(() => ({}));
    log('PTSCPS_BUILDER_FAILURE_STATE', state);
  }
  throw error;
} finally {
  try { if (pending.some(item => !item.restored)) await restoreAll(); }
  finally { await browser.close(); }
}
