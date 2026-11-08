import { chromium } from '../.qa/node_modules/playwright/index.mjs';

const origin = process.env.WP_ORIGIN || 'https://admin-ptscps.thegioihosting.io.vn';
const { WP_ADMIN_USERNAME: username, WP_ADMIN_PASSWORD: password } = process.env;
if (!username || !password) throw new Error('WordPress admin credentials missing');
const targets = [
  { id: 'home_05', lang: 'vi' },
  { id: 'home_05_en', lang: 'en' },
];
const newsUrl = (lang) => `/wp-json/wp/v2/posts?cat=tin-tuc&lang=${lang}&_embed=true&status=publish&orderby=date&order=desc&per_page=3`;
const browser = await chromium.launch({headless: true});
const page = await browser.newPage({viewport:{width:1400,height:950}});
const readTable = async id => {
  const response = await page.request.get(`${origin}/wp-json/tablepress/v1/table/${encodeURIComponent(id)}`);
  if (!response.ok()) throw new Error(`ESC Table ${id}: REST ${response.status()}`);
  const json = await response.json();
  if (String(json?.id) !== id) throw new Error(`Incorrect ESC Table identity: ${id}`);
  return json;
};
try {
  await page.goto(`${origin}/wp-login.php`, {waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([
    page.waitForURL(/\/wp-admin\//,{timeout:50000}),
    page.locator('#wp-submit').click(),
  ]);
  for (const {id,lang} of targets) {
    const api = newsUrl(lang);
    const before = await readTable(id);
    const results = await page.request.get(`${origin}${api}`, {timeout:25000});
    if (!results.ok()) throw new Error(`${id}: configured Posts API HTTP ${results.status()}`);
    const posts = await results.json();
    if (!Array.isArray(posts) || posts.some(post => !post?.id || !post?.slug || !post?.title?.rendered))
      throw new Error(`${id}: Posts API must return WordPress post records`);
    if (lang === 'vi' && posts.length === 0) throw new Error(`${id}: no published posts; refusing to replace active source`);
    if (String(before?.meta?.api||'') === api) {
      console.log(`HOME05_SOURCE_ALREADY_SET=${id}`);
      continue;
    }
    await page.goto(`${origin}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(id)}`,{waitUntil:'domcontentloaded',timeout:50000});
    const row = page.locator('tr').filter({hasText:/Nguồn dữ liệu\s*\/\s*API|Data source\s*\/\s*API/i}).first();
    const sourceSelect = row.locator('select').first();
    if (!await sourceSelect.count()) throw new Error(`${id}: native API selector missing`);
    const choices = await sourceSelect.locator('option').evaluateAll(opts=>opts.map(o=>({value:o.value,label:o.textContent?.trim()})));
    const custom = choices.find(x=>/API tùy chỉnh|Custom API/i.test(x.label||''));
    if (!custom) throw new Error(`${id}: Custom API option unavailable`);
    await sourceSelect.selectOption(custom.value);
    const input = row.locator('input[type="text"],input:not([type]),input[type="url"]').first();
    if (!await input.count()) throw new Error(`${id}: API URL input missing`);
    await input.fill(api);
    const save = page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i}).last();
    const saved = page.waitForResponse(r=>r.url().includes('admin-ajax.php') && (r.request().postData()||'').includes('tablepress_save_table'),{timeout:25000});
    await save.click();
    const ack = await saved;
    const json = await ack.json().catch(()=>null);
    if (!ack.ok() || (json && json.success === false)) throw new Error(`${id}: native save failed HTTP ${ack.status()}`);
    const after = await readTable(id);
    if (String(after?.meta?.api||'') !== api) throw new Error(`${id}: REST readback meta.api mismatch`);
    if (JSON.stringify(before.data)!==JSON.stringify(after.data)) throw new Error(`${id}: source rows changed during API setting`);
    console.log(`HOME05_CUSTOM_API_SAVED=${id} POST_COUNT=${posts.length} SOURCE=${api}`);
  }
  console.log('PTSCPS_HOME05_CUSTOM_API_CONFIG=PASS');
} finally {
  await browser.close();
}
