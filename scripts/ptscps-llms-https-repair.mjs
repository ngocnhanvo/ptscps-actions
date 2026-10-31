import { chromium } from 'playwright';

const wpOrigin = process.env.WP_ORIGIN;
const clientOrigin = process.env.CLIENT_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!wpOrigin || !clientOrigin || !/^https:\/\/[^/]+$/.test(wpOrigin) ||
    !/^https:\/\/[^/]+$/.test(clientOrigin) || !username || !password) {
  throw Error('PTSCPS_LLMS_FIX=BLOCKED: missing validated WordPress configuration');
}
const oldLink = '](' + clientOrigin.replace(/^https:/, 'http:') + '/';
const newLink = '](' + clientOrigin + '/';
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
async function read() {
  const response = await page.request.get(wpOrigin + '/wp-json/esc-seo-files/v1/public', {
    headers: { 'Cache-Control': 'no-cache' }, timeout: 30000,
  });
  if (!response.ok()) throw Error('PTSCPS_LLMS_FIX=BLOCKED: SEO REST HTTP ' + response.status());
  return response.json();
}
try {
  const before = await read();
  if (before.site !== clientOrigin) throw Error('PTSCPS_LLMS_FIX=BLOCKED: origin changed');
  const original = String(before.llms || '');
  if (original.includes(newLink) && !original.includes(oldLink)) {
    console.log('PTSCPS_LLMS_FIX=ALREADY_CANONICAL; no write');
  } else {
    if (original.split(oldLink).length !== 2 || original.includes(newLink) ||
        !original.startsWith('# PTSC') || original.length > 20000) {
      throw Error('PTSCPS_LLMS_FIX=BLOCKED: content differs from verified WordPress llms');
    }
    const replacement = original.replace(oldLink, newLink);
    await page.goto(wpOrigin + '/wp-login.php', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    await Promise.all([
      page.waitForURL(url => url.origin === wpOrigin && url.pathname.startsWith('/wp-admin/'), { timeout: 45000 }),
      page.locator('#wp-submit').click(),
    ]);
    await page.goto(wpOrigin + '/wp-admin/options-general.php?page=esc-seo-files&tab=llms', {
      waitUntil: 'domcontentloaded', timeout: 45000,
    });
    const editor = page.locator('#esc-seo-llms');
    await editor.waitFor({ state: 'attached', timeout: 25000 });
    if ((await editor.inputValue()).trim() !== original.trim()) {
      throw Error('PTSCPS_LLMS_FIX=BLOCKED: WordPress editor differs from public REST');
    }
    await editor.fill(replacement);
    const form = page.locator('form:has(input[name="action"][value="esc_seo_files_save"])');
    const navigation = page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 45000 });
    await form.locator('input[type="submit"]').click();
    const result = await navigation;
    if (result?.status() !== 200 || new URL(page.url()).origin !== wpOrigin) {
      throw Error('PTSCPS_LLMS_FIX=BLOCKED: WordPress save returned HTTP ' + result?.status());
    }
    const saved = await read();
    if (saved.site !== clientOrigin || String(saved.llms || '').trim() !== replacement.trim() ||
        !String(saved.llms || '').includes(newLink) || String(saved.llms || '').includes(oldLink)) {
      throw Error('PTSCPS_LLMS_FIX=BLOCKED: read-after-write mismatch');
    }
    console.log('PTSCPS_LLMS_FIX=PASS; corrected only PTSCPS homepage link http to https via WordPress UI');
  }
} finally {
  await browser.close();
}
