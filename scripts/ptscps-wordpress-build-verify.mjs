import { chromium } from 'playwright';

const origin = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!origin || !/^https:\/\/[^/]+$/.test(origin) || !username || !password) {
  throw new Error('PTSCPS_WORDPRESS_BUILD=BLOCKED: missing validated WP origin/admin credentials');
}
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1300, height: 900 } });
try {
  await page.goto(`${origin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([
    page.waitForURL(url => url.origin === origin && url.pathname.startsWith('/wp-admin/'), { timeout: 45000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin}/wp-admin/admin.php?page=vcs-build-trigger`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#vcs-build-btn-main').waitFor({ state: 'attached', timeout: 30000 });
  const initial = await page.evaluate(() => {
    const data = window.vcsBuild || {};
    return {
      configured: data.build_configured,
      active: data.initial_active,
      pending: data.pending_count,
      btnDisabled: document.querySelector('#vcs-build-btn-main')?.disabled,
    };
  });
  console.log('WP_BUILD_TOOL='+JSON.stringify(initial));
  if (!(initial.configured === true || initial.configured === '1' || initial.configured === 1)) {
    throw new Error('PTSCPS_WORDPRESS_BUILD=BLOCKED: WP Build Website is not configured');
  }
  if (initial.active) {
    console.log('PTSCPS_WORDPRESS_BUILD=ALREADY_RUNNING; no duplicate build triggered');
  } else {
    // The owner's auto-build mode permits force build via the existing WP tool.
    await page.locator('#vcs-force-build').check();
    const btn = page.locator('#vcs-build-btn-main');
    await btn.waitFor({ state: 'visible' });
    if (await btn.isDisabled()) throw new Error('PTSCPS_WORDPRESS_BUILD=BLOCKED: WordPress build control disabled');
    const responsePromise = page.waitForResponse(r =>
      r.url().startsWith(`${origin}/wp-admin/admin-ajax.php`) &&
      r.request().method() === 'POST' &&
      String(r.request().postData() || '').includes('action=vcs_trigger_build'),
      { timeout: 45000 }
    );
    await btn.click();
    const response = await responsePromise;
    const body = await response.json();
    if (!body?.success) throw new Error('PTSCPS_WORDPRESS_BUILD=BLOCKED: '+String(body?.data?.message || body?.data?.code || 'WP rejected build'));
    console.log('PTSCPS_WORDPRESS_BUILD=TRIGGERED_VIA_NATIVE_WP_TOOL');
    console.log('WP_BUILD_RESPONSE='+JSON.stringify({ code:body.data?.code,build_active:body.data?.build_active,pending_count:body.data?.pending_count }));
  }
} finally {
  await browser.close();
}
