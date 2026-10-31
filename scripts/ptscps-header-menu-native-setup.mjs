import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (![wp, front, username, password].every(Boolean)) throw Error('Missing configured WordPress access');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const report = (key, val) => console.log(`HEADER_SETUP_${key}=${JSON.stringify(val)}`);
const readMenu = async () => {
  const response = await page.request.get(`${wp}/wp-json/esc-api/v1/menus?_esc_audit=${Date.now()}`, { timeout: 25000, headers: { 'Cache-Control': 'no-cache' } });
  if (!response.ok()) throw Error(`Menu endpoint returned HTTP ${response.status()}`);
  const data = await response.json();
  if (data?.success !== true) throw Error('Unexpected menus API contract');
  return data.menus?.Header?.vi || null;
};
const snapshot = menu => menu && ({ id:menu.id, code:menu.code, lang:menu.lang, type:menu.type, item_count:menu.items?.length ?? -1, items:(menu.items || []).map(it => ({ label:it.label,key:it.key,slug:it.slug,href:it.href,linkMode:it.linkMode,linkType:it.linkType })) });
try {
  const initial = await readMenu();
  report('BEFORE', snapshot(initial));
  if (initial?.items?.length) {
    report('RESULT','NOOP_EXISTING_HEADER_PRESERVED');
    process.exitCode = 0;
  } else {
    const pagesResponse = await page.request.get(`${wp}/wp-json/wp/v2/pages?per_page=100&status=publish&_fields=id,title,slug`, { timeout: 25000 });
    if (!pagesResponse.ok()) throw Error('Cannot verify published target pages');
    const pages = await pagesResponse.json();
    const home = pages.find(p => p.id === 82467 && p.slug === 'trang-chu' && String(p.title?.rendered || '').replace(/<[^>]*>/g,'').trim() === 'Trang chủ');
    if (!home) throw Error('Verified published homepage 82467 changed; no write');
    const frontResponse = await page.request.get(front + '/', { timeout: 25000 });
    if (frontResponse.status() !== 200) throw Error('Verified frontend homepage URL stopped returning 200; no write');
    const existingMenus = await page.request.get(`${wp}/wp-json/esc-api/v1/menus`);
    const allMenus = (await existingMenus.json()).menus || {};
    if (Object.keys(allMenus).some(k => k.toLowerCase() === 'header' && allMenus[k]?.vi)) throw Error('Unexpected Header.vi identity conflict');

    await page.goto(`${wp}/wp-login.php`, { waitUntil:'domcontentloaded', timeout:50000 });
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
    report('AUTH','PASS');
    await page.goto(`${wp}/wp-admin/nav-menus.php`, { waitUntil:'domcontentloaded', timeout:40000 });
    const pageMenuOptions = await page.locator('#select-menu-to-edit option').evaluateAll(nodes => nodes.map(n => ({ id:n.value, text:n.textContent.trim() })));
    report('EXISTING_MENU_OPTIONS',pageMenuOptions);
    const named = pageMenuOptions.filter(item => item.text === 'Header Tiếng Việt' && /^\d+$/.test(item.id) && Number(item.id)>0);
    if (named.length > 1) throw Error('Multiple native Header Tiếng Việt menus; no write');
    const currentMenuId = Number(new URL(page.url()).searchParams.get('menu') || await page.locator('input[name="menu"]').first().inputValue().catch(()=>0) || 0);
    const currentMenuName = await page.locator('#menu-name').inputValue().catch(()=> '');
    if (!initial && named.length === 0 && currentMenuId > 0) {
      if (currentMenuName.trim() !== 'Header Tiếng Việt') throw Error('Menu manager already edits an unrelated native menu; refusing to create duplicate');
      named.push({id:String(currentMenuId),text:'Header Tiếng Việt'});
    }
    report('CURRENT_NATIVE_MENU',{id:currentMenuId,name:currentMenuName});

    if (!initial && named.length === 0) {
      const menuName = page.locator('#menu-name');
      const code = page.locator('#esc-menu-code');
      const lang = page.locator('#esc-menu-lang');
      if (!(await menuName.count()) || !(await code.count()) || !(await lang.count())) throw Error('Native menu identity controls missing; no write');
      const langs = await lang.locator('option').evaluateAll(nodes => nodes.map(n => n.value));
      if (!langs.includes('vi')) throw Error(`Native menu language vi not configured, choices=${langs.join(',')}`);
      await menuName.fill('Header Tiếng Việt');
      await code.fill('Header');
      await lang.selectOption('vi');
      await page.locator('#esc-menu-type').selectOption('dropdown');
      const create = page.locator('input[name="save_menu"]:visible, button[name="save_menu"]:visible').first();
      if (!(await create.count())) throw Error('Cannot find visible native Create Menu button; no write');
      report('NATIVE_CREATE_FORM_BEFORE', await page.evaluate(()=>({
        url:location.pathname+location.search,
        name:document.querySelector('#menu-name')?.value,
        code:document.querySelector('#esc-menu-code')?.value,
        lang:document.querySelector('#esc-menu-lang')?.value,
        action:document.querySelector('form#update-nav-menu input[name="action"]')?.value,
        form:document.querySelector('#save_menu_footer')?.form?.id,
      })));
      const createPosts = [];
      page.on('request', req=>{
        if (req.method()!=='POST' || !req.url().includes('/wp-admin/nav-menus.php')) return;
        const params = new URLSearchParams(req.postData() || '');
        createPosts.push({ path:new URL(req.url()).pathname, action:params.get('action'), menu:params.get('menu'), menuName:params.get('menu-name'), code:params.get('esc_menu_code'), lang:params.get('esc_menu_lang'), save:params.get('save_menu') });
      });
      await create.click({timeout:12000});
      await page.waitForLoadState('domcontentloaded');
      await page.waitForTimeout(450);
      report('NATIVE_CREATE_POST_REQUESTS',createPosts);
      report('NATIVE_CREATE_FORM_AFTER',await page.evaluate(()=>({
        url:location.pathname+location.search,
        name:document.querySelector('#menu-name')?.value,
        notices:[...document.querySelectorAll('.notice,.error,.updated,#message')].map(n=>(n.innerText||'').trim().slice(0,240)).filter(Boolean).slice(0,15),
        header:(document.querySelector('h1')?.innerText||'').trim(),
        formAction:document.querySelector('#update-nav-menu input[name="action"]')?.value,
        menuId:document.querySelector('#update-nav-menu input[name="menu"]')?.value,
      })));
      report('NATIVE_MENU_CREATED','SUBMITTED');
    } else if (named.length === 1) {
      report('NATIVE_MENU_REUSED',named[0]);
      await page.goto(`${wp}/wp-admin/nav-menus.php?menu=${named[0].id}`, {waitUntil:'domcontentloaded', timeout:40000});
    }

    let active = await readMenu();
    if (!active?.id) {
      // Native Create Menu may not include theme-added identity controls on its first POST.
      // On the edit form, submit those native fields through WordPress itself; never SQL/REST-write meta.
      const menuId = Number(new URL(page.url()).searchParams.get('menu') || named[0]?.id || 0);
      if (!menuId || !Number.isInteger(menuId)) throw Error('Cannot identify uniquely created native menu ID; no metadata write');
      await page.goto(`${wp}/wp-admin/nav-menus.php?menu=${menuId}`, { waitUntil:'domcontentloaded', timeout:40000 });
      const code = page.locator('#esc-menu-code');
      const lang = page.locator('#esc-menu-lang');
      const type = page.locator('#esc-menu-type');
      if (!(await code.count()) || !(await lang.count()) || !(await type.count())) throw Error('Cannot edit native WordPress menu identity');
      report('IDENTITY_FORM_STATUS',await page.evaluate(()=>({
        form:document.querySelector('#update-nav-menu')?.id || null,
        codeForm:document.querySelector('#esc-menu-code')?.form?.id || null,
        langForm:document.querySelector('#esc-menu-lang')?.form?.id || null,
        menuId:document.querySelector('input[name="menu"]')?.value || null
      })));
      const choices = await lang.locator('option').evaluateAll(nodes => nodes.map(n=>n.value));
      if (!choices.includes('vi')) throw Error('Language vi not enabled; no metadata write');
      // Ensure the injected controls participate in WordPress's own update-nav-menu POST.
      await page.evaluate(()=>{
        const form=document.querySelector('form#update-nav-menu');
        const fields=document.querySelector('#esc-menu-identity-fields');
        if(!form||!fields)throw Error('Native WordPress edit form or identity controls not found');
        if(!form.contains(fields))form.appendChild(fields);
      });
      await code.fill('Header');
      await lang.selectOption('vi');
      await type.selectOption('dropdown');
      const saveIdentity = page.locator('input[name="save_menu"]:visible, button[name="save_menu"]:visible').first();
      if (!(await saveIdentity.count())) throw Error('Native menu save button missing');
      await saveIdentity.click({timeout:12000});
      await page.waitForLoadState('domcontentloaded');
      report('NATIVE_MENU_IDENTITY_SAVED','SUBMITTED');
      active = await readMenu();
    }
    if (!active?.id || active.code !== 'Header' || active.lang !== 'vi') throw Error('Native Header.vi identity did not persist after edit');
    if ((active.items || []).length) {
      report('RESULT','NOOP_EXISTING_ITEMS_PRESERVED');
    } else {
      await page.goto(`${wp}/wp-admin/nav-menus.php?menu=${active.id}`, { waitUntil:'domcontentloaded', timeout:40000 });
      const pluginAdd = page.locator('#esc-pse-add-empty-menu-item');
      const pluginLabel = page.locator('#esc-pse-new-menu-label');
      if (!(await pluginAdd.count()) || !(await pluginLabel.count())) throw Error('Native ESC menu item UI unavailable; menu remains empty');
      if (!(await pluginAdd.isVisible())) {
        const h = page.locator('#esc-pse-empty-menu-item .hndle');
        if (await h.count()) await h.click();
      }
      await pluginLabel.fill('Trang chủ');
      const ajax = page.waitForResponse(r => r.url().includes('admin-ajax.php') && (r.request().postData() || '').includes('esc_pse_add_empty_menu_item'), { timeout:25000 });
      await pluginAdd.click();
      const addResponse = await ajax;
      const addBody = await addResponse.json().catch(() => ({}));
      if (!addResponse.ok() || addBody.success !== true || !addBody.data?.item_id) throw Error('Native menu item creation failed');
      const itemId = Number(addBody.data.item_id);
      report('NATIVE_ITEM_ID',itemId);
      await page.waitForLoadState('domcontentloaded');
      await page.goto(`${wp}/wp-admin/nav-menus.php?menu=${active.id}`, { waitUntil:'domcontentloaded',timeout:40000 });
      const item = page.locator(`#menu-item-${itemId}`);
      await item.waitFor({state:'attached', timeout:15000});
      const expand = item.locator('.item-edit');
      if (await expand.count()) await expand.click();
      const mode = page.locator(`[name="esc-menu-item-link-type[${itemId}]"]`);
      const href = page.locator(`[name="esc-menu-item-custom-url[${itemId}]"]`);
      const key = page.locator(`[name="esc-menu-item-key[${itemId}]"]`);
      if (!(await mode.count()) || !(await href.count()) || !(await key.count())) throw Error('Native ESC menu item fields missing');
      await mode.selectOption('custom');
      await href.fill('/');
      await key.fill('home');
      const nativeUrl = item.locator(`[name="menu-item-url[${itemId}]"]`);
      if (await nativeUrl.count()) await nativeUrl.fill('/');
      const save = page.locator('input[name="save_menu"]:visible, button[name="save_menu"]:visible').first();
      if (!(await save.count())) throw Error('Native Save Menu button unavailable');
      await save.click({timeout:12000});
      await page.waitForLoadState('domcontentloaded');
      report('NATIVE_ITEM_SAVED','SUBMITTED');
    }
    active = await readMenu();
    report('AFTER',snapshot(active));
    const rootItems = active?.items || [];
    if (rootItems.length !== 1 || rootItems[0].label !== 'Trang chủ' || rootItems[0].key !== 'home' || rootItems[0].linkType !== 'internal' || !['/',''].includes(rootItems[0].slug) || !['/',''].includes(rootItems[0].href)) {
      throw Error('WordPress Header.vi menu read-after-write mismatch');
    }
    report('RESULT','PASS_NATIVE_CMS_MENU_READY_NEEDS_WORDPRESS_BUILD');
    report('UNMIGRATED_DESTINATIONS','Other Header items deferred until their real published pages exist');
  }
} finally {
  await browser.close();
}
