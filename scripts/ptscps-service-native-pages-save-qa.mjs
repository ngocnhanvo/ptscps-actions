/** Scoped live ESC Table Save -> REST -> reload -> restore QA. Always restore. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require=createRequire(path.resolve('.qa/package.json'));
const {chromium}=require('playwright');
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
page.setDefaultTimeout(25000);
const pending=[];
const report=(key,data)=>console.log('PTSCPS_SERVICE_SAVE_QA_'+key+'='+JSON.stringify(data));
const logMarker=' · BuilderQA20261108';

async function api(endpoint,payload){
 return page.evaluate(async ({wp,endpoint,payload})=>{
   const ticket=await window.escVBGetTicket(false);
   const nonce=window.wpApiSettings?.nonce;
   if(!nonce||!ticket)throw Error('Authenticated WordPress API identity missing');
   const response=await fetch(wp+'/wp-json/esc-builder/v1/'+endpoint,{
    method:'POST',credentials:'same-origin',cache:'no-store',
    headers:{'Content-Type':'application/json','X-WP-Nonce':nonce},
    body:JSON.stringify({...payload,ticket})
   });
   return {status:response.status,body:await response.json()};
 },{wp,endpoint,payload});
}
async function okApi(endpoint,payload){
 const result=await api(endpoint,payload);
 assert.equal(result.status,200,endpoint+' HTTP '+result.status+' '+(result.body?.code||''));
 return result.body;
}
async function openBuilder(id){
 await page.goto(wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page='+id,
  {waitUntil:'domcontentloaded',timeout:45000});
 assert.equal(await page.locator('#esc-vb-page').inputValue(),String(id));
 const iframe=page.locator('#esc-vb-frame');
 const src=new URL(await iframe.getAttribute('src'));
 assert.equal(src.origin,client);
 assert.equal(src.pathname,'/esc-builder/preview/'+id);
 const frame=await iframe.elementHandle().then(handle=>handle.contentFrame());
 await frame.locator('html.esc-builder-preview').waitFor({state:'attached',timeout:60000});
 return frame;
}
function temporaryValue(original){
 if(/<img\b/i.test(original))return null;
 if(!/<[^>]+>/.test(original))return original+logMarker;
 if(/<\/p>/i.test(original))return original.replace(/<\/p>(?![\s\S]*<\/p>)/i,logMarker+'</p>');
 if(/<\/div>/i.test(original))return original.replace(/<\/div>(?![\s\S]*<\/div>)/i,logMarker+'</div>');
 return null;
}
async function restore(item){
 const latest=await okApi('editable-text',{page_id:item.id,table_id:item.tableId});
 const cell=latest.rows?.find(x=>String(x.row)===String(item.row)&&x.field===item.field);
 if(!cell)throw Error('CLEANUP_FAILED missing exact source '+item.tableId);
 if(cell.title===item.original){item.restored=true;return;}
 if(cell.title!==item.temporary||latest.version!==item.savedVersion)
  throw Error('CLEANUP_FAILED concurrent source or version change '+item.tableId);
 await okApi('save-text',{page_id:item.id,table_id:item.tableId,
  source_type:'esc_table',row:item.row,field:item.field,title:item.original,
  original_hash:cell.hash,expected_version:latest.version,rendered_version:latest.version});
 const back=await okApi('editable-text',{page_id:item.id,table_id:item.tableId});
 const restored=back.rows?.find(x=>String(x.row)===String(item.row)&&x.field===item.field);
 assert.equal(restored?.title,item.original,'CLEANUP_FAILED REST restore did not persist');
 item.restored=true;
 report('RESTORED',{id:item.id,tableId:item.tableId,row:item.row,field:item.field});
}
let failure=null;
try{
 await mkdir('.qa',{recursive:true});
 await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
 await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
 await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
 await page.locator('#wp-submit').click();
 await page.waitForURL(u=>u.origin===wp&&u.pathname.startsWith('/wp-admin/'),{timeout:45000});
 for(const [slug,id] of cases){
  const tableId='pub_service_'+slug;
  try{
   let frame=await openBuilder(id);
   const table=frame.locator('[data-tablepress-preview="'+tableId+'"]').first();
   await table.waitFor({state:'visible',timeout:60000});
   const originalSource=await okApi('editable-text',{page_id:id,table_id:tableId});
   const entry=originalSource.rows?.find(x=>x.editable&&x.field==='content'&&Number.isInteger(x.row)&&
      x.title?.length>0&&x.title.length<12000&&temporaryValue(x.title)!==null);
   assert(entry,'No safe editable content cell for live QA '+tableId);
   const temporary=temporaryValue(entry.title);
   assert(temporary!==null&&!entry.title.includes(logMarker));
   const item={id,slug,tableId,row:entry.row,field:entry.field,original:entry.title,temporary,
     savedVersion:null,restored:false};
   pending.push(item);
   await writeFile('.qa/service-native-page-rollback.json',JSON.stringify(pending),{mode:0o600});
   const target=table.locator('[data-esc-builder-cell-row="'+entry.row+'"][data-esc-builder-cell-field="'+entry.field+'"]').first();
   await target.click();
   await page.waitForFunction(({row,field})=>{
     const editor=document.querySelector('#esc-vb-edit-title');
     const selected=document.querySelector('#esc-vb-edit-row');
     return editor&&!editor.disabled&&selected?.value===row+':'+field;
   },{row:String(entry.row),field:entry.field},{timeout:30000});
   const input=page.locator('#esc-vb-edit-title');
   assert.equal(await input.inputValue(),entry.title,'UI displayed wrong original source');
   await input.fill(temporary);
   const awaited=page.waitForResponse(res=>res.url()===wp+'/wp-json/esc-builder/v1/save-text'&&res.request().method()==='POST');
   await page.locator('#esc-vb-text-editor').getByRole('button',{name:'Lưu WordPress',exact:true}).click();
   const savedResponse=await awaited;
   const saved=await savedResponse.json();
   assert.equal(savedResponse.status(),200,'Native UI Save HTTP '+savedResponse.status()+' '+(saved?.code||''));
   assert.equal(saved.saved,true);
   assert(/^[a-f0-9]{64}$/.test(saved.version||''));
   item.savedVersion=saved.version;
   const readback=await okApi('editable-text',{page_id:id,table_id:tableId});
   const row=readback.rows?.find(x=>x.row===entry.row&&x.field===entry.field);
   assert.equal(row?.title,temporary,'REST readback mismatched exact cell');
   frame=await openBuilder(id);
   const refreshed=frame.locator('[data-tablepress-preview="'+tableId+'"] [data-esc-builder-cell-row="'+entry.row+'"][data-esc-builder-cell-field="'+entry.field+'"]');
   await refreshed.filter({hasText:logMarker}).first().waitFor({state:'visible',timeout:45000});
   report('SAVED',{id,tableId,source:'ESC Table',row:entry.row,field:entry.field,readback:'PASS',reload:'PASS'});
   await restore(item);
   frame=await openBuilder(id);
   const after=frame.locator('[data-tablepress-preview="'+tableId+'"] [data-esc-builder-cell-row="'+entry.row+'"][data-esc-builder-cell-field="'+entry.field+'"]');
   assert(!(await after.first().innerText()).includes(logMarker),'QA marker remains after restore');
  }finally{
    for(const item of [...pending].reverse())if(!item.restored){
      try{await restore(item);}catch(error){report('CLEANUP_FAILED',{id:item.id,tableId:item.tableId,reason:String(error?.message||error)});throw error;}
    }
  }
 }
 report('PASS',{pages:4,save:true,readback:true,reload:true,restore:true,temporaryRecordsRemaining:0});
}catch(error){failure=error;report('FAIL',{reason:String(error?.message||error)});}
finally{
 for(const item of [...pending].reverse())if(!item.restored){
   try{await restore(item);}catch(error){failure=error;report('CLEANUP_FAILED',{id:item.id,tableId:item.tableId,reason:String(error?.message||error)});}
 }
 await browser.close();
}
if(failure)throw failure;
