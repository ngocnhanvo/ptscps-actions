/** Read-only Visual Builder QA for native service Pages after migration. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('.qa/package.json'));
const { chromium } = require('playwright');
const wp=process.env.WP_ORIGIN, client=process.env.CLIENT_ORIGIN;
assert.equal(wp,'https://admin-ptscps.thegioihosting.io.vn');
assert.equal(client,'https://ptscps.thegioihosting.io.vn');
assert(process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD);
const cases=[
 ['van-hanh-va-bao-duong-fpso-fso-mopu',85614],
 ['dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',85617],
 ['cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',85620],
 ['dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep',85623],
];
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:900}});
const page=await context.newPage();
try {
 await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
 await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
 await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
 await page.locator('#wp-submit').click();
 await page.waitForURL(u=>u.origin===wp&&u.pathname.startsWith('/wp-admin/'),{timeout:45000});
 const nonceRes=await page.request.post(wp+'/wp-admin/admin-ajax.php',{form:{action:'rest-nonce'}});
 const nonce=(await nonceRes.text()).trim();
 assert(nonceRes.ok()&&/^[a-z0-9_-]{8,32}$/i.test(nonce),'Missing native WordPress nonce');
 for(const [slug,id] of cases){
  const tableId='pub_service_'+slug;
  const native=await page.request.get(wp+'/wp-json/wp/v2/pages/'+id+'?context=edit&_fields=id,slug,parent,status,acf,content',{headers:{'X-WP-Nonce':nonce}});
  assert(native.ok(),'WordPress native Page read failed: '+slug);
  const record=await native.json();
  assert.equal(record.slug,slug);
  assert.equal(record.parent,82755);
  assert.equal(record.status,'publish');
  assert.equal(record.acf?.action,'IntroPage');
  assert.equal(record.acf?.key,'ssr-service');
  assert(String(record.content?.raw||'').includes('[table id='+tableId),'Missing Page ESC shortcode '+slug);
  await page.goto(wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page='+id,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(await page.locator('#esc-vb-page').inputValue(),String(id),'Page picker is not native Page '+slug);
  const iframe=page.locator('#esc-vb-frame');
  const url=new URL(await iframe.getAttribute('src'));
  assert.equal(url.origin,client);
  assert.equal(url.pathname,'/esc-builder/preview/'+id);
  const frame=await iframe.elementHandle().then(h=>h.contentFrame());
  await frame.locator('html.esc-builder-preview').waitFor({state:'attached',timeout:60000});
  const table=frame.locator('[data-tablepress-preview="'+tableId+'"]').first();
  await table.waitFor({state:'visible',timeout:60000});
  const markers=await table.locator('[data-esc-builder-cell-row][data-esc-builder-cell-field]')
   .evaluateAll(nodes=>nodes.map(el=>({row:el.getAttribute('data-esc-builder-cell-row'),field:el.getAttribute('data-esc-builder-cell-field'),text:(el.textContent||'').trim()}))
    .filter(x=>/^\d+$/.test(x.row||'')&&x.text));
  assert(markers.length>0,'No editable coordinate on native Page '+slug);
  const versions=JSON.parse(await frame.locator('#esc-vb-region-rules').getAttribute('data-versions')||'{}');
  const version=versions[tableId];
  assert(/^[a-f0-9]{64}$/.test(version||''),'Missing source version '+tableId);
  await page.waitForFunction(()=>typeof window.escVBGetTicket==='function');
  const source=await page.evaluate(async ({wp,id,tableId,version})=>{
   const ticket=await window.escVBGetTicket(false);
   const nonce=window.wpApiSettings?.nonce;
   if(!nonce)throw Error('No native page nonce');
   const res=await fetch(wp+'/wp-json/esc-builder/v1/editable-text',{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-WP-Nonce':nonce},
    body:JSON.stringify({ticket,page_id:id,table_id:tableId,rendered_version:version})
   });
   return {status:res.status,data:await res.json()};
  },{wp,id,tableId,version});
  assert.equal(source.status,200,'Native Page source denied '+tableId+': '+source.data?.code);
  const editable=markers.find(x=>source.data?.rows?.some(r=>String(r.row)===x.row&&r.field===x.field&&r.editable));
  assert(editable,'No editable cell in WordPress source '+tableId);
  await table.locator('[data-esc-builder-cell-row="'+editable.row+'"][data-esc-builder-cell-field="'+editable.field+'"]').first().click();
  await page.waitForFunction(()=>{const e=document.querySelector('#esc-vb-edit-title');return e&&!e.disabled;},null,{timeout:30000});
  assert.equal(await page.locator('#esc-vb-edit-row').inputValue(),editable.row+':'+editable.field);
  const production=await context.newPage();
  const response=await production.goto(client+'/dich-vu/'+slug,{waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(response?.status(),200,'Public route unavailable '+slug);
  await production.close();
  console.log('PTSCPS_NATIVE_SERVICE_PAGE_QA=PASS '+JSON.stringify({id,slug,tableId,cells:markers.length,selected:editable.row+':'+editable.field,cms_writes:0}));
 }
 console.log('PTSCPS_NATIVE_SERVICE_PAGES_QA_PASS=4 cms_writes=0');
}finally{await browser.close();}
