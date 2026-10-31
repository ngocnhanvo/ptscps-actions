import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (![wp, front, username, password].every(Boolean)) throw Error('Missing configured audit input');
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext();
const page = await context.newPage();
const report = (key, value) => console.log(`HEADER_AUDIT_${key}=${JSON.stringify(value)}`);
const requestJSON = async (path, required = false) => {
  const res = await page.request.get(`${wp}${path}`, { timeout: 25000 });
  const out = { status: res.status(), value: res.ok() ? await res.json() : null };
  if (required && !res.ok()) throw Error(`Required REST route failed: ${path.split('?')[0]} HTTP ${res.status()}`);
  return out;
};
const safeHref = (item) => ({ label: String(item?.label || item?.title || '').slice(0, 80), slug: String(item?.slug || '').slice(0, 120), href: String(item?.href || '').slice(0, 180), children: Array.isArray(item?.children) ? item.children.length : 0 });
try {
  const initial = await requestJSON('/wp-json/esc-api/v1/menus', true);
  const responseMenus = initial.value;
  const header = responseMenus?.menus?.Header?.vi;
  report('ESC_MENU_ROUTE_STATUS', initial.status);
  report('ESC_MENU_RESPONSE_SUCCESS', responseMenus?.success === true);
  report('HEADER_VI', header ? { name: header.name, code: header.code, lang: header.lang, id: header.id, item_count: header.items?.length ?? null, items: (header.items || []).map(safeHref).slice(0, 30) } : null);
  const menuList = await requestJSON('/wp-json/wp/v2/menus?per_page=100');
  report('WP_NATIVE_MENUS', { status: menuList.status, menus: Array.isArray(menuList.value) ? menuList.value.map(x => ({ id:x.id,name:x.name,slug:x.slug,count:x.count,locations:x.locations })).slice(0,30) : null });
  const pages = await requestJSON('/wp-json/wp/v2/pages?per_page=100&status=publish&_fields=id,slug,link,title,parent,status', true);
  const posts = await requestJSON('/wp-json/wp/v2/posts?per_page=5&status=publish&_fields=id,slug,link,title,status', true);
  const published = Array.isArray(pages.value) ? pages.value : [];
  report('PUBLISHED_PAGES', published.map(x => ({ id:x.id,slug:x.slug,link:x.link,parent:x.parent,title:String(x.title?.rendered||'').replace(/<[^>]*>/g,'').slice(0,90) })).slice(0,100));
  report('PUBLISHED_POSTS_SAMPLE', Array.isArray(posts.value) ? posts.value.map(x=>({ id:x.id,slug:x.slug,link:x.link })) : []);
  const frontResponse = await page.request.get(front, {timeout:25000});
  report('FRONT_PAGE_HTTP', frontResponse.status());
  if (!frontResponse.ok()) throw Error(`Frontend GET failed HTTP ${frontResponse.status()}`);
  const frontHtml = await frontResponse.text();
  const ids = [...frontHtml.matchAll(/<section\b[^>]*\bid=["']([^"']+)["']/gi)].map(x=>x[1]);
  report('FRONT_SECTION_IDS', [...new Set(ids)].slice(0,50));
  if (!header?.items?.length) report('NEXT_STATE', published.length === 0 ? 'BLOCKED_BY_NO_PUBLISHED_TARGET_PAGES; HOME_ROOT_EXISTS' : 'PUBLISHED_PAGES_AVAILABLE; REVIEW_NATIVE_MENU_SETUP');
  else report('NEXT_STATE','HEADER_VI_EXISTS; VALIDATE_LINKS_AND_DEPLOY_POLICY');
  await page.goto(`${wp}/wp-login.php`, {waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//, {timeout:50000}),page.locator('#wp-submit').click()]);
  report('WP_ADMIN_AUTH','PASS');
  await page.goto(`${wp}/wp-admin/nav-menus.php`,{waitUntil:'domcontentloaded',timeout:30000});
  const nativeMenus = await page.locator('#select-menu-to-edit option').evaluateAll(elements => elements.map(el=>({label:el.textContent.trim().slice(0,80),value:el.value}))).catch(()=>[]);
  report('NATIVE_MENU_MANAGER_OPTIONS',nativeMenus);
  const nativeState = await page.evaluate(() => {
    const sample = (q) => [...document.querySelectorAll(q)].slice(0,20).map(el => ({ id:el.id, name:el.getAttribute('name'), text:(el.value||el.textContent||'').trim().slice(0,100), form:el.form?.id||null, visible:!!el.getClientRects().length }));
    return {
      url:location.pathname+location.search,
      title:document.title,
      menuName:document.querySelector('#menu-name')?.value||'',
      menuId:document.querySelector('input[name="menu"]')?.value||'',
      forms:sample('form'),
      selects:sample('select'),
      saveButtons:sample('[name="save_menu"]'),
      identity:sample('#esc-menu-code,#esc-menu-lang,#esc-menu-type'),
      notices:sample('.notice,.error,.updated,.wrap > .message'),
      navigationHeading:(document.querySelector('#menu-management')?.textContent||'').trim().slice(0,500),
      wpApiNoncePresent:!!window.wpApiSettings?.nonce,
    };
  });
  report('NATIVE_MENU_MANAGER_DIAGNOSTIC',nativeState);
  const afterAuthNonce = await page.evaluate(()=>window.wpApiSettings?.nonce||'');
  if (afterAuthNonce) {
    const nativeResponse = await page.request.get(`${wp}/wp-json/wp/v2/menus?per_page=100`,{headers:{'X-WP-Nonce':afterAuthNonce},timeout:25000});
    const responseBody = nativeResponse.ok() ? await nativeResponse.json().catch(()=>null) : null;
    report('AUTH_NATIVE_REST_MENUS',{status:nativeResponse.status(),items:Array.isArray(responseBody)?responseBody.map(x=>({id:x.id,name:x.name,slug:x.slug,count:x.count})).slice(0,30):null});
  }

  // New validation scope: this release added the first real Header.vi menu item.
  // Check the *deployed* desktop/mobile navigation, not historical homepage sections.
  if (header?.id !== 1767 || header.items?.length !== 1 || header.items[0].label !== 'Trang chủ' || header.items[0].key !== 'home') {
    throw Error('Live WordPress Header.vi no longer contains the verified single home item');
  }
  const desktop = await context.newPage();
  await desktop.setViewportSize({ width: 1440, height: 900 });
  const desktopResponse = await desktop.goto(`${front}/`, { waitUntil: 'load', timeout: 50000 });
  if (desktopResponse?.status() !== 200) throw Error('Live desktop homepage did not return HTTP 200');
  const desktopLink = desktop.locator('#desktop-menu a').filter({ hasText: 'Trang chủ' }).first();
  await desktopLink.waitFor({ state: 'visible', timeout: 12000 });
  const desktopHref = await desktopLink.getAttribute('href');
  if (!desktopHref || new URL(desktopHref, front).pathname !== '/') throw Error('Desktop Header home link does not lead to /');
  await desktop.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
  await desktop.waitForTimeout(350);
  const stickyDesktop = await desktop.evaluate(() => {
    const header = document.querySelector('#main-header');
    const logo = document.querySelector('#header-brandbar a[aria-label="Về trang chủ"]');
    const menu = document.querySelector('#header-navrow');
    const bounds = element => element?.getBoundingClientRect();
    return {
      scrollY: window.scrollY,
      headerTop: bounds(header)?.top,
      logoTop: bounds(logo)?.top,
      menuTop: bounds(menu)?.top,
      logoWidth: bounds(logo)?.width,
      menuWidth: bounds(menu)?.width,
      headerPosition: header ? getComputedStyle(header).position : null,
    };
  });
  if (stickyDesktop.scrollY < 200 || stickyDesktop.headerPosition !== 'sticky'
      || Math.abs(stickyDesktop.headerTop) > 3 || stickyDesktop.logoTop < -3
      || Math.abs(stickyDesktop.menuTop) > 3 || stickyDesktop.logoWidth < 40
      || stickyDesktop.menuWidth < 40) {
    throw Error(`Desktop header lost logo or menu on scroll: ${JSON.stringify(stickyDesktop)}`);
  }
  report('DESKTOP_STICKY_QA', stickyDesktop);
  await desktop.close();

  const mobile = await context.newPage();
  await mobile.setViewportSize({ width: 390, height: 844 });
  const mobileResponse = await mobile.goto(`${front}/`, { waitUntil: 'load', timeout: 50000 });
  if (mobileResponse?.status() !== 200) throw Error('Live mobile homepage did not return HTTP 200');
  const toggle = mobile.locator('#hamburger-btn');
  await toggle.waitFor({ state: 'visible', timeout: 12000 });
  await mobile.evaluate(() => window.scrollTo({ top: 480, behavior: 'instant' }));
  await mobile.waitForTimeout(350);
  const stickyMobile = await mobile.evaluate(() => {
    const logo = document.querySelector('#header-brandbar a[aria-label="Về trang chủ"]');
    const menuButton = document.querySelector('#hamburger-btn');
    return {
      scrollY: window.scrollY,
      logoTop: logo?.getBoundingClientRect().top,
      buttonTop: menuButton?.getBoundingClientRect().top,
      fixed: document.querySelector('#main-header')?.classList.contains('mobile-header-fixed'),
    };
  });
  if (stickyMobile.scrollY < 200 || !stickyMobile.fixed || stickyMobile.logoTop < -3
      || stickyMobile.logoTop > 8 || stickyMobile.buttonTop < -3 || stickyMobile.buttonTop > 72) {
    throw Error(`Mobile header lost logo or menu button on scroll: ${JSON.stringify(stickyMobile)}`);
  }
  report('MOBILE_STICKY_QA', stickyMobile);
  await toggle.click();
  const mobileMenu = mobile.locator('#mobile-menu-container');
  await mobileMenu.waitFor({ state: 'visible', timeout: 12000 });
  const mobileLink = mobileMenu.locator('a').filter({ hasText: 'Trang chủ' }).first();
  await mobileLink.waitFor({ state: 'visible', timeout: 12000 });
  const mobileHref = await mobileLink.getAttribute('href');
  if (!mobileHref || new URL(mobileHref, front).pathname !== '/') throw Error('Mobile Header home link does not lead to /');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') throw Error('Mobile hamburger aria-expanded not updated');
  report('PUBLIC_NAV_QA', { desktop: 'PASS', mobile: 'PASS', label: 'Trang chủ', href: '/' });
  await mobile.close();
  report('AUDIT_RESULT','PASS_READ_ONLY');
} finally { await browser.close(); }
