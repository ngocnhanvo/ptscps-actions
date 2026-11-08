/** Create only the three missing canonical ESC Tables from existing WooCommerce descriptions. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require=createRequire(path.resolve('.qa/package.json'));
const {chromium}=require('playwright');
const wp=String(process.env.WP_ORIGIN||'').replace(/\/$/,'');
const front=String(process.env.CLIENT_ORIGIN||'').replace(/\/$/,'');
assert.equal(wp,'https://admin-ptscps.thegioihosting.io.vn');
assert.equal(front,'https://ptscps.thegioihosting.io.vn');
assert(process.env.WP_ADMIN_USERNAME&&process.env.WP_ADMIN_PASSWORD,'Missing admin credentials');
const slugs=[
  'van-hanh-va-bao-duong-fpso-fso-mopu',
  'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
  'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',
];
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();
const uri=p=>wp+p;
const log=(name,data)=>console.log('PTSCPS_SERVICE_BACKFILL_'+name+'='+JSON.stringify(data));
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function tableRead(id){
  const res=await page.request.get(uri('/wp-json/tablepress/v1/table/'+encodeURIComponent(id)+'?_esc='+Date.now()),{timeout:30000,headers:{'Cache-Control':'no-store'}});
  if(res.status()===404) return null;
  assert(res.ok(),`TablePress read ${id} HTTP ${res.status()}`);
  return await res.json();
}
async function categoryFeed(){
  const res=await page.request.get(uri('/wp-json/astro/v1/get-product-categories?_esc='+Date.now()),{timeout:30000,headers:{'Cache-Control':'no-store'}});
  assert(res.ok(),`Category feed HTTP ${res.status()}`);
  const items=await res.json(); assert(Array.isArray(items),'Category feed is not an array');
  return items;
}
async function repairKnownTwoRowTable(id,description){
  // The first guarded migration was saved with keys + data but no labels row.
  // Refuse any other unexpected structure; never overwrite an authored table.
  await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=edit&table_id='+encodeURIComponent(id)+'&esc_full_admin=1'),{waitUntil:'load',timeout:50000});
  await page.waitForFunction(()=>Boolean(globalThis.tp?.editor?.options?.data),null,{timeout:30000});
  const evidence=await page.evaluate(()=>globalThis.tp.editor.options.data.map(row=>row.map(value=>String(value||''))));
  const head=['type','title','content','img'];
  assert(evidence.length===2&&JSON.stringify(evidence[0])===JSON.stringify(head),`Unknown 2-row ESC Table structure ${id}`);
  assert(evidence[1][0]==='prose'&&String(evidence[1][2]||'')===description,`Existing 2-row content mismatch; refusing overwrite ${id}`);
  await page.evaluate(({description})=>{
    const editor=globalThis.tp.editor;
    editor.insertRow(1);
    if(editor.options.data.length!==3) throw Error('ESC Table repair failed to append label row');
    const labels=['Loại','Tiêu đề','Nội dung','Hình ảnh'];
    labels.forEach((value,x)=>editor.setValueFromCoords(x,1,value));
    ['prose','',description,''].forEach((value,x)=>editor.setValueFromCoords(x,2,value));
  },{description});
  const save=page.getByRole('button',{name:/Save Changes|Lưu thay đổi|Lưu các thay đổi/i}).first();
  const ackPromise=page.waitForResponse(response=>response.url().startsWith(wp+'/wp-admin/admin-ajax.php')&&String(response.request().postData()||'').includes('action=tablepress_save_table'),{timeout:45000});
  await save.click();
  const ack=await ackPromise;
  assert(ack.ok(),`Failed TablePress repair save HTTP ${ack.status()}`);
  const body=await ack.json();
  assert(body?.success===true&&body?.table_id===id,`Failed TablePress repair acknowledgement ${id}`);
  for(let i=0;i<8;i++){
    await wait(600);
    const actual=await tableRead(id);
    if(actual?.items?.[0]?.type==='prose'&&String(actual.items[0].content||'')===description){
      log('REPAIRED',{id,source:'product_cat.description',recoveredMissingLabels:true});
      return;
    }
  }
  throw Error('Repaired TablePress content did not match readback '+id);
}
async function createTable(id,name,description){
  let autoId=''; let completed=false;
  try{
    await page.goto(uri('/wp-admin/admin.php?page=tablepress_add&esc_full_admin=1'),{waitUntil:'domcontentloaded',timeout:50000});
    await page.locator('input[name="table[name]"]').fill('Dịch vụ - '+name);
    await page.locator('textarea[name="table[description]"]').fill('Nội dung dịch vụ, nguồn ESC Table');
    await page.locator('input[name="table[rows]"]').fill('3');
    await page.locator('input[name="table[columns]"]').fill('4');
    const add=page.getByRole('button',{name:/Add Table|Thêm bảng/i}).first();
    assert.equal(await add.count(),1,'TablePress Add button not found');
    await Promise.all([page.waitForURL(/table_id=[a-zA-Z0-9_-]+/,{timeout:50000}),add.click()]);
    autoId=new URL(page.url()).searchParams.get('table_id')||'';
    assert(/^[a-zA-Z0-9_-]+$/.test(autoId),`Invalid temporary TablePress ID: ${autoId}`);
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=edit&table_id='+encodeURIComponent(autoId)+'&esc_full_admin=1'),{waitUntil:'load',timeout:50000});
    await page.waitForFunction(()=>Boolean(globalThis.tp?.editor?.options?.data),null,{timeout:30000});
    const dims=await page.evaluate(()=>({rows:globalThis.tp.editor.options.data.length,cols:globalThis.tp.editor.options.columns.length}));
    assert.deepEqual(dims,{rows:3,cols:4},`Unexpected TablePress dimensions ${JSON.stringify(dims)}`);
    await page.locator('#table-name').fill('Dịch vụ - '+name);
    await page.locator('#table-description').fill('Nội dung chi tiết dịch vụ, lưu trong ESC Table');
    if(autoId!==id){
      page.once('dialog',dialog=>dialog.accept());
      await page.locator('#table-id').fill(id);
      await page.locator('#table-id').press('Tab');
    }
    await page.evaluate(({description})=>{
      const cells=[['type','title','content','img'],['Loại','Tiêu đề','Nội dung','Hình ảnh'],['prose','',description,'']];
      cells.forEach((row,y)=>row.forEach((value,x)=>globalThis.tp.editor.setValueFromCoords(x,y,value)));
    },{description});
    const save=page.getByRole('button',{name:/Save Changes|Lưu thay đổi|Lưu các thay đổi/i}).first();
    assert.equal(await save.count(),1,'TablePress Save button not found');
    const ackPromise=page.waitForResponse(response=>response.url().startsWith(wp+'/wp-admin/admin-ajax.php')&&String(response.request().postData()||'').includes('action=tablepress_save_table'),{timeout:45000});
    await save.click();
    const ack=await ackPromise;
    assert(ack.ok(),`TablePress save ${id} HTTP ${ack.status()}`);
    const result=await ack.json();
    assert(result?.success===true&&result?.table_id===id,`TablePress save acknowledgement mismatch: ${JSON.stringify(result).slice(0,250)}`);
    for(let i=0;i<8;i++){
      await wait(600);
      const actual=await tableRead(id);
      if(actual?.items?.[0]?.type==='prose'&&String(actual.items[0].content||'')===description){
        completed=true;
        log('CREATED',{id,rows:actual.items.length,source:'product_cat.description',verified:true});
        return;
      }
    }
    throw Error('TablePress saved source did not match readback '+id);
  }finally{
    if(autoId&&!completed) log('CLEANUP_REQUIRED',{id,tempId:autoId,reason:'Creation aborted before canonical readback; do not start another migration until reconciled'});
  }
}
try{
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([page.waitForURL(url=>url.origin===wp&&url.pathname.startsWith('/wp-admin/'),{timeout:50000}),page.locator('#wp-submit').click()]);
  const categories=await categoryFeed();
  const root=categories.find(x=>x.slug==='dich-vu'&&Number(x.parent||0)===0);
  assert(root,'Canonical service root category missing');
  const sources=[];
  for(const slug of slugs){
    const cat=categories.find(x=>x.slug===slug);
    assert(cat&&Number(cat.parent||0)===Number(root.id),`Missing direct-child service category ${slug}`);
    const raw=String(cat.description||'').trim();
    assert(raw,`No existing description to backfill ${slug}; refusing empty placeholder`);
    assert(!/<(?:script|iframe|object|embed)\b/i.test(raw),`Unsafe HTML in ${slug} description`);
    const description=raw.replaceAll(wp+'/wp-content/uploads/','/wp-content/uploads/');
    const id='pub_service_'+slug;
    const existing=await tableRead(id);
    sources.push({id,name:String(cat.name||slug),description,existing});
    log('PREFLIGHT',{id,descriptionLength:description.length,exists:existing!==null});
  }
  for(const item of sources){
    if(item.existing){
      if(Array.isArray(item.existing.items)&&item.existing.items.length>0){
        log('SKIPPED',{id:item.id,reason:'Existing ESC Table source preserved'});
        continue;
      }
      // Only repair our own known first 2-row table; verify every cell before writing.
      assert(item.id===slugs.map(x=>'pub_service_'+x)[0],'Unexpected empty ESC Table; refusing mutation');
      await repairKnownTwoRowTable(item.id,item.description);
      continue;
    }
    await createTable(item.id,item.name,item.description);
  }
  log('PASS',{count:sources.length,source:'ESC Table',categoryDescriptionPreserved:true});
}finally{await browser.close();}
