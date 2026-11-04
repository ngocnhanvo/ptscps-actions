import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && front && user && pass, 'Missing configured PTSCPS origins or WordPress admin credentials');

const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const uri = path => wp + path;
const clean = value => String(value ?? '').replace(/<[^>]+>/g, '').trim();
const report = (key, value) => console.log(`EN_HEADER_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);

const translations = [
  { origin: 82642, label: 'Top Message', expectedSlug: 'top-message' },
  { origin: 82645, label: 'Introduction' },
  { origin: 82647, label: 'Board of Directors' },
  { origin: 82649, label: 'Our History' },
  { origin: 82651, label: 'Mission & Vision' },
];

const langOf = item => String(item?.acf?.product_lang?.value ?? item?.acf?.product_lang ?? '').trim();
const originOf = item => {
  const value = item?.acf?.origin_page_id;
  const raw = value?.value ?? value?.ID ?? value?.id ?? value;
  const parsed = Number(raw || 0);
  return Number.isInteger(parsed) ? parsed : 0;
};
const keyOf = item => String(item?.acf?.key ?? '').trim();
const escHref = url => {
  const value = String(url || '').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value;
  if (value === '/' || value === '') return value;
  return value.replace(/^\/+|\/+$/g, '');
};

async function readMenus() {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await page.request.get(uri(`/wp-json/esc-api/v1/menus?_en_header=${Date.now()}`), {
        timeout: 30000,
        headers: { 'Cache-Control': 'no-cache' },
      });
      assert(res.ok(), `Menu API HTTP ${res.status()}`);
      const data = await res.json();
      assert(data?.success === true, 'Unexpected menu API contract');
      return data.menus || {};
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(1000 * attempt);
    }
  }
}

async function publishedEnglishPages() {
  const res = await page.request.get(uri('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,acf,status'), { timeout: 30000 });
  assert(res.ok(), `Published Pages HTTP ${res.status()}`);
  const all = await res.json();
  const en = all.filter(item => langOf(item) === 'en');
  const top = en.filter(item => item.slug === 'top-message');
  assert(top.length === 1, `Expected exactly one published English Top Message, got ${top.length}`);
  assert(top[0].id === 82715 && originOf(top[0]) === 82642 && keyOf(top[0]) === 'about-letter', 'Top Message translation checkpoint changed');
  report('PUBLISHED_EN_PAGES', en.map(item => ({ id:item.id, slug:item.slug, title:clean(item.title?.rendered), origin:originOf(item), key:keyOf(item) })));
  return en;
}

async function login() {
  await page.goto(uri('/wp-login.php'), { waitUntil:'domcontentloaded', timeout:50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([
    page.waitForURL(/\/wp-admin\//, { timeout:50000 }),
    page.locator('#wp-submit').click(),
  ]);
  assert(new URL(page.url()).origin === wp, 'WordPress authentication escaped configured origin');
  report('ADMIN_AUTH', 'PASS');
}

async function getRestNonce(menuId = 0) {
  const candidates = [
    `/wp-admin/nav-menus.php${menuId ? `?action=edit&menu=${menuId}` : ''}&esc_full_admin=1`.replace('?&','?'),
    '/wp-admin/post.php?post=82715&action=edit&esc_full_admin=1',
  ];
  for (const path of candidates) {
    await page.goto(uri(path), { waitUntil:'domcontentloaded', timeout:50000 });
    const nonce = await page.evaluate(() => String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  throw Error('WordPress REST nonce unavailable');
}

async function ensureNativeEnglishMenu() {
  let menus = await readMenus();
  const existing = menus?.Header?.en || null;
  if (existing?.id) {
    assert(existing.code === 'Header' && existing.lang === 'en', 'Existing Header.en identity mismatch');
    report('NATIVE_MENU', { state:'EXISTING', id:existing.id, item_count:existing.items?.length || 0 });
    return { menuId:Number(existing.id), created:false };
  }

  await page.goto(uri('/wp-admin/nav-menus.php'), { waitUntil:'domcontentloaded', timeout:45000 });
  const options = await page.locator('#select-menu-to-edit option').evaluateAll(nodes => nodes.map(n => ({ id:n.value, text:n.textContent.trim() })));
  const named = options.filter(item => item.text === 'Header English' && /^\d+$/.test(item.id) && Number(item.id) > 0);
  assert(named.length <= 1, 'Multiple Header English native menus; refusing write');

  let menuId = Number(named[0]?.id || 0);
  if (!menuId) {
    const currentMenuId = Number(new URL(page.url()).searchParams.get('menu') || await page.locator('input[name="menu"]').first().inputValue().catch(()=>0) || 0);
    const currentName = await page.locator('#menu-name').inputValue().catch(()=> '');
    if (currentMenuId > 0 && currentName.trim() !== 'Header English') {
      await page.goto(uri('/wp-admin/nav-menus.php?action=edit&menu=0'), { waitUntil:'domcontentloaded', timeout:45000 }).catch(()=>null);
    }
    const menuName = page.locator('#menu-name');
    assert(await menuName.count(), 'Native Create Menu name field missing');
    await menuName.fill('Header English');
    const code = page.locator('#esc-menu-code');
    const lang = page.locator('#esc-menu-lang');
    const type = page.locator('#esc-menu-type');
    assert(await code.count() && await lang.count() && await type.count(), 'Native ESC menu identity controls missing');
    const choices = await lang.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
    assert(choices.includes('en'), 'English menu language is not enabled in WordPress');
    await code.fill('Header');
    await lang.selectOption('en');
    await type.selectOption('dropdown');
    const create = page.locator('input[name="save_menu"]:visible, button[name="save_menu"]:visible').first();
    assert(await create.count(), 'Native Create Menu button missing');
    const posted = [];
    page.on('request', req => {
      if (req.method() !== 'POST' || !req.url().includes('/wp-admin/nav-menus.php')) return;
      posted.push(req.url());
    });
    await create.click({ timeout:12000 });
    await page.waitForLoadState('domcontentloaded');
    await sleep(500);
    if (!posted.length) {
      const safe = await page.evaluate(() => {
        const form = document.querySelector('form#update-nav-menu');
        return !!form && form.querySelector('#menu-name')?.value === 'Header English'
          && form.querySelector('#esc-menu-code')?.value === 'Header'
          && form.querySelector('#esc-menu-lang')?.value === 'en'
          && [...form.elements].some(el => /nonce/i.test(el.name || ''));
      });
      assert(safe, 'Native WordPress Create Menu form failed safety checks');
      await Promise.all([
        page.waitForNavigation({ waitUntil:'domcontentloaded', timeout:40000 }),
        page.evaluate(() => {
          const form = document.querySelector('form#update-nav-menu');
          const action = form.querySelector('input[name="action"]');
          action.value = 'update';
          const submit = document.createElement('input');
          submit.type='hidden'; submit.name='save_menu'; submit.value='Create Menu';
          form.appendChild(submit);
          HTMLFormElement.prototype.submit.call(form);
        }),
      ]);
    }
    const after = await page.locator('#select-menu-to-edit option').evaluateAll(nodes => nodes.map(n => ({ id:n.value, text:n.textContent.trim() })));
    const matches = after.filter(item => item.text === 'Header English' && /^\d+$/.test(item.id) && Number(item.id) > 0);
    assert(matches.length === 1, `Header English native create mismatch count=${matches.length}`);
    menuId = Number(matches[0].id);
  }

  await page.goto(uri(`/wp-admin/nav-menus.php?menu=${menuId}`), { waitUntil:'domcontentloaded', timeout:45000 });
  const code = page.locator('#esc-menu-code');
  const lang = page.locator('#esc-menu-lang');
  const type = page.locator('#esc-menu-type');
  assert(await code.count() && await lang.count() && await type.count(), 'Native menu identity controls missing after create');
  await page.evaluate(() => {
    const form=document.querySelector('form#update-nav-menu');
    const fields=document.querySelector('#esc-menu-identity-fields');
    if (!form || !fields) throw Error('Native WordPress edit form or identity controls not found');
    if (!form.contains(fields)) form.appendChild(fields);
  });
  await code.fill('Header');
  await lang.selectOption('en');
  await type.selectOption('dropdown');
  const save = page.locator('input[name="save_menu"]:visible, button[name="save_menu"]:visible').first();
  assert(await save.count(), 'Native Save Menu button missing');
  await save.click({ timeout:12000 });
  await page.waitForLoadState('domcontentloaded');
  await sleep(700);

  menus = await readMenus();
  const active = menus?.Header?.en;
  assert(Number(active?.id) === menuId && active.code === 'Header' && active.lang === 'en', 'Header.en identity did not persist');
  report('NATIVE_MENU', { state:'CREATED', id:menuId });
  return { menuId, created:true };
}

async function brochureFromVietnameseMenu(restHeaders) {
  const menus = await readMenus();
  const vi = menus?.Header?.vi;
  assert(vi?.id && Array.isArray(vi.items), 'Header.vi missing while sourcing brochure link');
  const intro = vi.items.find(item => item.label === 'Giới thiệu');
  const brochure = intro?.children?.find(item => item.label === 'Company Brochure');
  assert(brochure?.id, 'Verified Company Brochure child missing from Header.vi');
  const response = await page.request.get(uri(`/wp-json/wp/v2/menu-items/${brochure.id}?context=edit&_fields=id,title,url,target,status,menus,parent,type`), { headers:restHeaders, timeout:30000 });
  assert(response.ok(), `Cannot read native brochure menu item HTTP ${response.status()}`);
  const item = await response.json();
  assert(item.status === 'publish' && item.type === 'custom' && item.target === '_blank', 'Company Brochure native target changed');
  const parsed = new URL(item.url, wp);
  assert(parsed.origin === wp && parsed.pathname.startsWith('/wp-content/uploads/'), 'Company Brochure is no longer a local Media Library PDF');
  return { title:'Company Brochure', url:parsed.pathname + parsed.search, target:'_blank' };
}

async function desiredMenuEntries(enPages, restHeaders) {
  const available = [];
  for (const spec of translations) {
    const matches = enPages.filter(item => originOf(item) === spec.origin);
    assert(matches.length <= 1, `Duplicate published English translation for origin ${spec.origin}`);
    if (!matches.length) continue;
    const item = matches[0];
    if (spec.expectedSlug) assert(item.slug === spec.expectedSlug, `English translation slug changed for ${spec.label}`);
    available.push({ title:spec.label, url:`/${item.slug}`, target:'', pageId:item.id });
  }
  assert(available.some(item => item.title === 'Top Message'), 'Top Message is not available for English Header');
  const brochure = await brochureFromVietnameseMenu(restHeaders);
  const home = enPages.find(item => keyOf(item) === 'home');
  return {
    roots: home ? [{ title:'Home', url:home.slug ? `/${home.slug}` : '/', target:'' }] : [],
    about: available,
    brochure,
  };
}

function exactHeader(header, desired) {
  if (!header || !Array.isArray(header.items)) return false;
  const roots = header.items;
  const expectedRootCount = desired.roots.length + 1;
  if (roots.length !== expectedRootCount) return false;
  for (const root of desired.roots) {
    const found = roots.find(item => item.label === root.title);
    if (!found || String(found.href || '') !== escHref(root.url) || (found.children || []).length) return false;
  }
  const about = roots.find(item => item.label === 'About Us');
  if (!about) return false;
  const children = about.children || [];
  const expected = [...desired.about, desired.brochure];
  return children.length === expected.length && expected.every(entry => children.some(child => child.label === entry.title && String(child.href || '') === escHref(entry.url) && !(child.children || []).length));
}

async function ensureMenuItems(menuId, desired, restHeaders) {
  let menus = await readMenus();
  const current = menus?.Header?.en;
  if (exactHeader(current, desired)) {
    report('ITEMS', { state:'ALREADY_CORRECT_SKIP_WRITE', roots:current.items.length, about_children:current.items.find(x=>x.label==='About Us')?.children?.length || 0 });
    return false;
  }

  const batch = [
    ...desired.roots.map((item, index) => ({ ...item, parentTitle:'', menuOrder:index + 1 })),
    { title:'About Us', url:'#', target:'', parentTitle:'', menuOrder:desired.roots.length + 1 },
    ...[...desired.about, desired.brochure].map((item, index) => ({ ...item, parentTitle:'About Us', menuOrder:desired.roots.length + 2 + index })),
  ];
  const titleOf = item => clean(item?.title?.raw ?? item?.title?.rendered ?? item?.title ?? '');
  const listNative = async () => {
    const response = await page.request.get(uri('/wp-json/wp/v2/menu-items?context=edit&status=publish&per_page=100&_fields=id,title,url,status,menus,parent,menu_order,type,target'), {
      headers:restHeaders,
      timeout:30000,
    });
    assert(response.ok(), `Cannot inspect published menu items: HTTP ${response.status()}`);
    const rows = await response.json();
    return rows.filter(item => Number(item?.menus) === menuId);
  };
  const urlMatches = (actual, expected) => {
    const a = new URL(String(actual || ''), wp);
    const e = new URL(String(expected || ''), wp);
    return a.origin === e.origin && a.pathname === e.pathname && a.search === e.search && a.hash === e.hash;
  };
  const findExact = (items, expected, parentId) => items.filter(item =>
    titleOf(item) === expected.title
    && String(item?.type || '') === 'custom'
    && Number(item?.parent || 0) === Number(parentId || 0)
    && urlMatches(item?.url, expected.url)
    && String(item?.target || '') === String(expected.target || '')
  );
  const expectedTitles = new Set(batch.map(item => item.title));
  let items = await listNative();
  const unexpected = items.filter(item => !expectedTitles.has(titleOf(item)));
  assert(unexpected.length === 0, `Header.en contains unexpected native items: ${unexpected.map(item=>titleOf(item)).join(', ')}`);
  for (const title of expectedTitles) {
    assert(items.filter(item => titleOf(item) === title).length <= 1, `Duplicate Header.en item ${title}`);
  }
  if (items.length) report('PARTIAL_RECOVERY', items.map(item => ({ id:item.id, title:titleOf(item), url:item.url, parent:item.parent, target:item.target })));

  async function ensureOne(expected, parentId) {
    items = await listNative();
    let exact = findExact(items, expected, parentId);
    if (exact.length === 1) return Number(exact[0].id);
    assert(exact.length === 0, `Duplicate exact Header.en item ${expected.title}`);
    const sameTitle = items.filter(item => titleOf(item) === expected.title);
    assert(sameTitle.length === 0, `Existing Header.en item differs for ${expected.title}; refusing overwrite`);

    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await page.request.post(uri('/wp-json/wp/v2/menu-items'), {
          headers:restHeaders,
          timeout:30000,
          data:{ title:expected.title, type:'custom', url:expected.url, menus:menuId, status:'publish', parent:parentId, menu_order:expected.menuOrder, target:expected.target || '' },
        });
        const body = await response.json().catch(()=>({}));
        if (response.ok() && Number(body?.id) > 0) return Number(body.id);
        report('ITEM_CREATE_RETRY', { title:expected.title, attempt, http:response.status(), code:body?.code || '' });
      } catch (error) {
        report('ITEM_CREATE_RETRY', { title:expected.title, attempt, transport:error?.message || error?.name || 'error' });
      }
      await sleep(1200 * attempt);
      items = await listNative();
      exact = findExact(items, expected, parentId);
      if (exact.length === 1) {
        report('ITEM_CREATE_READBACK_RECOVERED', { title:expected.title, id:exact[0].id, attempt });
        return Number(exact[0].id);
      }
      assert(items.filter(item => titleOf(item) === expected.title).length === 0, `Ambiguous readback after failed create ${expected.title}`);
    }
    throw Error(`WordPress menu-item create failed after retry: ${expected.title}`);
  }

  for (const item of batch.filter(x => !x.parentTitle && x.title !== 'About Us')) await ensureOne(item, 0);
  const parent = batch.find(x => x.title === 'About Us' && !x.parentTitle);
  const parentId = await ensureOne(parent, 0);
  for (const item of batch.filter(x => x.parentTitle === 'About Us')) await ensureOne(item, parentId);

  for (let attempt = 1; attempt <= 14; attempt++) {
    await sleep(850);
    menus = await readMenus();
    const header = menus?.Header?.en;
    if (exactHeader(header, desired)) {
      report('ITEMS', { state:'PASS_RECONCILED', roots:header.items.length, about_children:header.items.find(x=>x.label==='About Us')?.children?.length || 0 });
      return true;
    }
  }
  throw Error('Header.en read-after-write mismatch');
}

async function buildViaWordPress() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'), { waitUntil:'domcontentloaded', timeout:45000 });
  const button = page.locator('#vcs-build-btn-main');
  assert(await button.count() === 1, 'WordPress Build Website tool unavailable');
  let state = await page.evaluate(() => ({
    configured:window.vcsBuild?.build_configured,
    active:window.vcsBuild?.initial_active,
    pending:window.vcsBuild?.pending_count,
    buttonDisabled:document.querySelector('#vcs-build-btn-main')?.disabled,
    forceDisabled:document.querySelector('#vcs-force-build')?.disabled,
  }));
  report('BUILD_NATIVE_STATE', state);
  assert(state.configured === true || state.configured === '1' || state.configured === 1, 'WordPress native build is not configured');
  if (state.active) {
    const status = await page.waitForResponse(r => r.url().startsWith(wp + '/wp-admin/admin-ajax.php') && r.request().method() === 'POST' && String(r.request().postData() || '').includes('action=vcs_check_build_status'), { timeout:20000 }).catch(()=>null);
    if (status) {
      const info = await status.json().catch(()=>({}));
      report('BUILD_RECONCILE', { status:info?.data?.status, active:info?.data?.build_active });
    }
    await page.reload({ waitUntil:'domcontentloaded', timeout:45000 });
    state = await page.evaluate(() => ({ configured:window.vcsBuild?.build_configured, active:window.vcsBuild?.initial_active, pending:window.vcsBuild?.pending_count }));
  }
  if (state.active) {
    report('BUILD', 'OTHER_BUILD_RUNNING_SKIP_DUPLICATE');
    return;
  }
  const force = page.locator('#vcs-force-build');
  if (await button.isDisabled()) {
    assert(await force.count() === 1 && !await force.isDisabled(), 'WordPress Build disabled and force-build unavailable');
    await force.check();
  }
  assert(!await button.isDisabled(), 'WordPress Build Website button remains disabled');
  const response = page.waitForResponse(r => r.url().startsWith(wp + '/wp-admin/admin-ajax.php') && r.request().method() === 'POST' && String(r.request().postData() || '').includes('action=vcs_trigger_build'), { timeout:45000 });
  await button.click();
  const ack = await response;
  assert(ack.ok(), `WordPress Build HTTP ${ack.status()}`);
  const body = await ack.json();
  assert(body?.success, 'WordPress Build rejected request');
  report('BUILD', 'TRIGGERED_VIA_WORDPRESS');
}

async function menuIsLive(desired) {
  const response = await context.request.get(`${front}/top-message?_en_header=${Date.now()}`, { timeout:30000, headers:{'Cache-Control':'no-cache'} }).catch(()=>null);
  if (response?.status() !== 200) return false;
  const html = await response.text();
  const hasLabel = label => html.includes(label)
    || html.includes(String(label).replaceAll('&', '&amp;'));
  return html.includes('About Us') && html.includes('Top Message') && html.includes('Company Brochure')
    && desired.about.every(entry => hasLabel(entry.title));
}

async function verifyProduction(desired) {
  for (let attempt = 1; attempt <= 52; attempt++) {
    if (await menuIsLive(desired)) break;
    report('WAIT', { attempt });
    await sleep(15000);
    if (attempt === 52) throw Error('English Header did not appear on production after WordPress build');
  }
  await mkdir('artifacts/ptscps-header-menu-en', { recursive:true });

  const desktop = await context.newPage();
  await desktop.setViewportSize({ width:1440, height:900 });
  const response = await desktop.goto(`${front}/top-message`, { waitUntil:'load', timeout:50000 });
  assert(response?.status() === 200, 'Top Message production route failed');
  const nav = desktop.locator('#desktop-menu');
  await nav.waitFor({ state:'visible', timeout:12000 });
  const about = nav.locator('button[data-menu-trigger]').filter({ hasText:/^About Us$/ }).first();
  await about.waitFor({ state:'visible', timeout:12000 });
  await about.hover();
  await desktop.waitForTimeout(400);
  assert(await about.getAttribute('aria-expanded') === 'false', 'Desktop submenu opened on hover; expected click/tap only');
  await about.click();
  assert(await about.getAttribute('aria-expanded') === 'true', 'Desktop About Us did not open on click');
  const panelId = await about.getAttribute('aria-controls');
  assert(panelId, 'Desktop About Us panel id missing');
  const panel = desktop.locator('#' + panelId);
  await panel.waitFor({ state:'visible', timeout:8000 });
  for (const entry of desired.about) {
    const link = panel.getByRole('link', { name:entry.title, exact:true });
    assert(await link.count() === 1, `Desktop English submenu missing ${entry.title}`);
    assert(new URL(await link.getAttribute('href'), front).pathname === new URL(entry.url, front).pathname, `Desktop href mismatch ${entry.title}`);
  }
  const brochure = panel.getByRole('link', { name:'Company Brochure', exact:true });
  assert(await brochure.count() === 1, 'Desktop English submenu missing Company Brochure');
  assert(await brochure.getAttribute('target') === '_blank', 'Desktop Company Brochure lost target=_blank');
  await desktop.screenshot({ path:'artifacts/ptscps-header-menu-en/desktop-top-message-en-menu.png', fullPage:true });
  report('DESKTOP_QA', 'PASS');
  await desktop.close();

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width:390, height:844 });
  const mobileResponse = await mobile.goto(`${front}/top-message`, { waitUntil:'load', timeout:50000 });
  assert(mobileResponse?.status() === 200, 'Mobile Top Message production route failed');
  const hamburger = mobile.locator('#hamburger-btn');
  await hamburger.waitFor({ state:'visible', timeout:12000 });
  await hamburger.click();
  const mobileMenu = mobile.locator('#mobile-menu-container');
  await mobileMenu.waitFor({ state:'visible', timeout:8000 });
  const mobileAbout = mobileMenu.locator('button').filter({ hasText:/^About Us$/ }).first();
  await mobileAbout.waitFor({ state:'visible', timeout:8000 });
  await mobileAbout.click();
  const mobilePanelId = await mobileAbout.getAttribute('aria-controls');
  assert(mobilePanelId, 'Mobile About Us panel id missing');
  const mobilePanel = mobile.locator('#' + mobilePanelId);
  await mobilePanel.waitFor({ state:'visible', timeout:8000 });
  for (const entry of desired.about) assert(await mobilePanel.getByRole('link', { name:entry.title, exact:true }).count() === 1, `Mobile English submenu missing ${entry.title}`);
  assert(await mobilePanel.getByRole('link', { name:'Company Brochure', exact:true }).count() === 1, 'Mobile English submenu missing Company Brochure');
  await mobile.screenshot({ path:'artifacts/ptscps-header-menu-en/mobile-top-message-en-menu.png', fullPage:true });
  report('MOBILE_QA', 'PASS');
  await mobile.close();
  report('PRODUCTION_QA', { status:'PASS', route:`${front}/top-message`, about_children:[...desired.about.map(x=>x.title),'Company Brochure'] });
}

try {
  const enPages = await publishedEnglishPages();
  await login();
  const { menuId, created } = await ensureNativeEnglishMenu();
  const nonce = await getRestNonce(menuId);
  const restHeaders = { 'X-WP-Nonce':nonce, 'Cache-Control':'no-cache' };
  const desired = await desiredMenuEntries(enPages, restHeaders);
  report('DESIRED', { roots:desired.roots.map(x=>x.title), about:[...desired.about.map(x=>x.title), desired.brochure.title] });
  const itemsChanged = await ensureMenuItems(menuId, desired, restHeaders);
  const changed = created || itemsChanged;
  if (changed || !(await menuIsLive(desired))) await buildViaWordPress();
  else report('BUILD', 'ALREADY_DEPLOYED_SKIP_TRIGGER');
  await verifyProduction(desired);
  report('RESULT', 'PASS');
} finally {
  await browser.close();
}
