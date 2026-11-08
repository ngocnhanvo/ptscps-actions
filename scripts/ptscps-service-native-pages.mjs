import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert(wp && front && user && password, 'Missing PTSCPS native Page migration inputs');
const marker = 'PTSCPS_SERVICE_PAGE_BRIDGE_20261108';
const entries = [
  {slug:'van-hanh-va-bao-duong-fpso-fso-mopu',title:'Vận hành và bảo dưỡng FPSO/FSO/MOPU'},
  {slug:'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',title:'Dịch vụ thiết kế, mua sắm, gia công, chế tạo'},
  {slug:'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',title:'Cung ứng nhân lực kỹ thuật vận hành và bảo dưỡng'},
  {slug:'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep',title:'Dịch vụ sửa chữa bảo dưỡng các thiết bị và công trình công nghiệp'},
];
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:900}});
const page = await context.newPage();
const created = [];
let nonce = '';
const report = (label,data)=>console.log(marker+'_'+label+'='+JSON.stringify(data));

async function request(method,path,data) {
  const url = wp + path;
  const res = await page.request.fetch(url, {
    method, timeout:35000,
    headers:{'X-WP-Nonce':nonce,'Cache-Control':'no-cache',...(data ? {'Content-Type':'application/json'} : {})},
    ...(data ? {data} : {}),
  });
  let body;
  try { body=await res.json(); } catch { body={}; }
  return {res,body};
}
async function setAcf(name,value) {
  const row=page.locator(`[data-name="${name}"]`).first();
  assert.equal(await row.count(),1,`ACF ${name} missing`);
  const select=row.locator('select').first();
  if (await select.count()) {await select.selectOption(String(value));return;}
  const field=row.locator('input[type="text"],input:not([type])').first();
  assert(await field.count(),`ACF ${name} input missing`);
  await field.fill(String(value));
}
async function insertNativeTable(tableId) {
  const textTab=page.locator('#content-html');
  if (await textTab.isVisible().catch(()=>false)) await textTab.click();
  const editor=page.locator('#content');
  assert.equal(await editor.count(),1,'Native WordPress editor missing');
  await editor.evaluate(el=>{el.focus();const end=el.value.length;el.setSelectionRange(end,end);});
  const native=page.locator('#qt_content_tablepress_quicktags_button');
  assert.equal(await native.count(),1,'ESC Table Insert Code unavailable');
  await native.click();
  await page.locator('#TB_iframeContent').waitFor({state:'visible',timeout:20000});
  const frame=page.frameLocator('#TB_iframeContent');
  await frame.locator('#tablepress-page').waitFor({state:'visible',timeout:20000});
  let insert=frame.locator(`.insert-shortcode[title*="id=${tableId}"]`).first();
  if (await insert.count()===0) {
    const search=frame.locator('#tables_search-search-input, input[type="search"][name="s"], input[name="s"]').first();
    await search.waitFor({state:'visible',timeout:15000});
    await search.fill(tableId);
    const submit=frame.locator('#search-submit').first();
    await submit.click();
    insert=frame.locator(`.insert-shortcode[title*="id=${tableId}"]`).first();
    await insert.waitFor({state:'visible',timeout:15000});
  }
  assert.equal(await insert.count(),1,`Native picker missing ${tableId}`);
  await insert.click();
  await page.locator('#TB_window').waitFor({state:'hidden',timeout:15000});
}
async function pageBySlug(slug) {
  const {res,body}=await request('GET','/wp-json/wp/v2/pages?context=edit&status=any&slug='+encodeURIComponent(slug)+'&per_page=100&_fields=id,slug,status,parent,title,acf,content');
  assert(res.ok() && Array.isArray(body),`Cannot query WordPress Page ${slug}: ${res.status()}`);
  assert(body.length <= 1,`Duplicate WordPress Page slug ${slug}`);
  return body[0] || null;
}
async function verifyPage(id,rootId,spec) {
  const {res,body}=await request('GET',`/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,parent,title,acf,content`);
  assert(res.ok(),`Page readback HTTP ${res.status()}`);
  const actualLang=body?.acf?.product_lang?.value || body?.acf?.product_lang;
  const raw=String(body?.content?.raw || body?.content?.rendered || '');
  const tableId='pub_service_'+spec.slug;
  assert.equal(body.slug,spec.slug);
  assert.equal(body.status,'publish');
  assert.equal(Number(body.parent),rootId);
  assert.equal(body.acf?.action,'IntroPage');
  assert.equal(body.acf?.key,'ssr-service');
  assert.equal(actualLang,'vi');
  assert(raw.includes(`[table id=${tableId}`),`Page does not reference native ESC Table ${tableId}`);
  return body;
}
async function createPage(rootId,spec) {
  const tableId='pub_service_'+spec.slug;
  const table=await page.request.get(wp+`/wp-json/tablepress/v1/table/${encodeURIComponent(tableId)}`);
  assert(table.ok(),`Referenced ESC Table missing: ${tableId}`);
  const pre=await pageBySlug(spec.slug);
  if (pre) {
    await verifyPage(pre.id,rootId,spec);
    report('SKIP_EXISTING',{id:pre.id,slug:spec.slug,tableId});
    return;
  }

  await page.goto(wp+'/wp-admin/post-new.php?post_type=page&esc_full_admin=1',{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#title').fill(spec.title);
  await setAcf('key','ssr-service');
  await setAcf('action','IntroPage');
  await setAcf('product_lang','vi');
  const save=page.locator('#save-post');
  assert.equal(await save.count(),1,'Native Save Draft missing');
  await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:45000}),save.click()]);
  const id=Number(await page.locator('#post_ID').inputValue());
  assert(Number.isSafeInteger(id) && id>0,'Draft Page ID missing');
  created.push({id,slug:spec.slug});

  // WordPress Page owns path identity. No overwrite of existing category data.
  const update=await request('POST',`/wp-json/wp/v2/pages/${id}`,{slug:spec.slug,parent:rootId});
  assert(update.res.ok() && update.body.slug===spec.slug && Number(update.body.parent)===rootId,
    `Cannot set Page slug and parent for ${spec.slug}`);
  await page.goto(wp+`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`,{waitUntil:'domcontentloaded',timeout:50000});
  await insertNativeTable(tableId);
  const publish=page.locator('#publish');
  assert.equal(await publish.count(),1,'Native Publish button missing');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:50000}).catch(()=>null),publish.click()]);
  await verifyPage(id,rootId,spec);
  report('CREATED',{id,slug:spec.slug,tableId,parent:rootId,nativeInsert:true});
}
async function cleanupCreatedPages() {
  for (const item of created.reverse()) {
    try {
      const {res,body}=await request('DELETE',`/wp-json/wp/v2/pages/${item.id}`);
      if (!res.ok() || body?.status!=='trash') throw new Error(`cleanup HTTP ${res.status()}`);
      report('CLEANUP_TRASH',{id:item.id,slug:item.slug,success:true});
    } catch (error) {
      report('CLEANUP_FAILED',{id:item.id,slug:item.slug,reason:String(error?.message||'unknown')});
      throw error;
    }
  }
}
try {
  await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  const nr=await page.request.post(wp+'/wp-admin/admin-ajax.php',{form:{action:'rest-nonce'},timeout:25000});
  nonce=(await nr.text()).trim();
  assert(nr.ok() && /^[a-f\d]{8,20}$/i.test(nonce),'Authenticated REST nonce missing');
  const root=await pageBySlug('dich-vu');
  assert(root && root.status==='publish' && root.acf?.action==='ProductsSSRPage','Root service Page source mismatch');
  report('ROOT',{id:root.id,slug:root.slug});
  for (const spec of entries) await createPage(Number(root.id),spec);
  // Public category routes remain from the original WooCommerce service taxonomy.
  for (const spec of entries) {
    const resp=await page.request.get(front+'/dich-vu/'+spec.slug,{timeout:35000});
    assert.equal(resp.status(),200,`Public service route regression: ${spec.slug}`);
  }
  report('DONE',{pages:entries.length,created:created.length,publicRoutes:'PASS'});
} catch (error) {
  report('ERROR',{message:String(error?.message||error)});
  if (created.length) await cleanupCreatedPages();
  throw error;
} finally {
  await browser.close();
}
