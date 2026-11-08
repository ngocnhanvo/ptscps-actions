/** Read-only native TablePress state and category source after guarded backfill. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { createHash } from 'node:crypto';
const require=createRequire(path.resolve('.qa/package.json'));
const {chromium}=require('playwright');
const wp='https://admin-ptscps.thegioihosting.io.vn';
const ids=[
  'pub_service_van-hanh-va-bao-duong-fpso-fso-mopu',
  'pub_service_dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
  'pub_service_cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',
  '183',
];
assert(process.env.WP_ADMIN_USERNAME&&process.env.WP_ADMIN_PASSWORD);
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext();
const page=await ctx.newPage();
const hash=x=>createHash('sha256').update(String(x||'')).digest('hex').slice(0,16);
try{
  await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([page.waitForURL(u=>u.origin===wp&&u.pathname.startsWith('/wp-admin/'),{timeout:50000}),page.locator('#wp-submit').click()]);
  const catResponse=await page.request.get(wp+'/wp-json/astro/v1/get-product-categories?_esc='+Date.now(),{timeout:30000});
  assert(catResponse.ok());
  const cats=await catResponse.json();
  for(const id of ids){
    const response=await page.request.get(wp+'/wp-json/tablepress/v1/table/'+encodeURIComponent(id)+'?_esc='+Date.now(),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
    const body=await response.json().catch(()=>null);
    const slug=id.replace(/^pub_service_/, '');
    const cat=cats.find(x=>x.slug===slug);
    const rows=Array.isArray(body?.items)?body.items:[];
    const normalized=String(cat?.description||'').trim().replaceAll(wp+'/wp-content/uploads/','/wp-content/uploads/');
    const content=String(rows[0]?.content||'');
    console.log('PTSCPS_SERVICE_FORENSIC='+JSON.stringify({id,http:response.status(),tableId:body?.id,tableTitle:body?.title,tableMeta:body?.meta?Object.keys(body.meta):null,rowCount:rows.length,firstRow:rows[0]?{keys:Object.keys(rows[0]),type:rows[0].type,sourceRow:rows[0].sourceRow,contentLength:content.length,contentHash:hash(content),preview:content.slice(0,100)}:null,category:cat?{id:cat.id,descriptionLength:normalized.length,descriptionHash:hash(normalized)}:null}));
  }
}finally{await browser.close();}
