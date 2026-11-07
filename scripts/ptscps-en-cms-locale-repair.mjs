import assert from 'node:assert/strict';
import { chromium } from 'playwright';

// Edit only identified untranslated values in existing English ESC Table cells.
// Do not recreate tables, touch VI rows, or change map/image URLs.
const env = process.env.ENV_FILE || '';
const line = env.split(/\r?\n/).find(value => /^\s*WC_URL\s*=/.test(value));
assert(line, 'Missing WC_URL');
const origin = String(line.split('=').slice(1).join('=').trim()).replace(/^["']|["']$/g, '').replace(/\/$/, '');
assert(origin === 'https://admin-ptscps.thegioihosting.io.vn', 'Refusing unexpected WordPress origin');
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert(username && password, 'Missing WordPress credentials');

const translations = new Map([
  ['Chính sách sử dụng rượu, cồn và các chất kích thích', 'Alcohol, Drugs and Other Substances Policy'],
  ['Chính sách sức khỏe, an toàn, môi trường và chất lượng', 'Health, Safety, Environment and Quality Policy'],
  ['Chính sách dừng công việc', 'Stop Work Policy'],
  ['Chính sách an toàn sức khỏe môi trường và chất lượng', 'Health, Safety, Environment and Quality Policy'],
  ['Sơ đồ hệ thống quản lý HSEQ', 'HSEQ Management System Diagram'],
  ['Mô hình quản lý HSEQ', 'HSEQ Management System'],
  ['Phóng to tài liệu', 'Enlarge document'],
  ['Phóng to chứng nhận', 'Enlarge certificate'],
  ['Phóng to sơ đồ', 'Enlarge diagram'],
  ['Xem tài liệu gốc', 'View original document'],
  ['Xem chi tiết', 'View details'],
  ['Mở tài liệu PDF', 'Open PDF'],
]);

const browser = await chromium.launch({headless:true});
const context = await browser.newContext({ viewport: {width:1366, height:900} });
const page = await context.newPage();
const ids = ['hseq_00_en','hseq_01_en','hseq_02_en','hseq_03_en','hseq_04_en','contact_01_en','contact_00_en'];
const logs = [];
const read = async id => {
  const response = await page.request.get(`${origin}/wp-json/tablepress/v1/table/${id}?_locale_repair=${Date.now()}`, {timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(response.ok(), `ESC Table ${id} HTTP ${response.status()}`);
  const table = await response.json();
  assert(Array.isArray(table?.items) && Array.isArray(table?.fields),`Bad ESC Table ${id}`);
  return table;
};
const translate = text => {
  if(typeof text!=='string')return text;
  let out=text;
  for(const [vi,en] of translations) out=out.split(vi).join(en);
  out=out.replace(/Tài liệu Mục tiêu HSEQ\s+(\d+)/g,'HSEQ Target Document $1');
  return out;
};
try {
  await page.goto(`${origin}/wp-login.php`,{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForLoadState('domcontentloaded'),page.locator('#wp-submit').click()]);
  if(new URL(page.url()).searchParams.get('action')==='confirm_admin_email'){
    const skip=page.locator('a.skip-confirmation-button').first();
    if(await skip.count())await skip.click();
  }
  if(!/\/wp-admin\//.test(page.url()))await page.waitForURL(/\/wp-admin\//,{timeout:50000});
  assert(new URL(page.url()).origin===origin,'Login origin mismatch');
  for(const id of ids){
    const table=await read(id);
    const fields=table.fields.map(field=>String(field.key||''));
    const changes=[];
    for(let rowIndex=0;rowIndex<table.items.length;rowIndex++){
      const row=table.items[rowIndex];
      for(let column=0;column<fields.length;column++){
        const key=fields[column];
        if(!['title','label','content'].includes(key))continue;
        const before=row[key];
        const after=translate(before);
        if(typeof before==='string'&&before!==after)changes.push({rowIndex,column,key,before,after});
      }
    }
    if(changes.length===0){logs.push({id,status:'UNCHANGED',cells:0});continue;}
    await page.goto(`${origin}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(id)}&esc_full_admin=1`,{waitUntil:'domcontentloaded',timeout:50000});
    await page.waitForFunction(()=>Boolean(globalThis.tp?.editor?.options?.data&&globalThis.tp?.helpers?.unsaved_changes),null,{timeout:30000});
    await page.evaluate(({changes,expectedColumns,expectedRows})=>{
      const e=globalThis.tp.editor;
      if(e.options.columns.length!==expectedColumns||e.options.data.length!==expectedRows+2)throw Error('ESC Table shape drift');
      for(const change of changes)e.setValueFromCoords(change.column,change.rowIndex+2,change.after);
      globalThis.tp.helpers.unsaved_changes.set();
    },{changes,expectedColumns:fields.length,expectedRows:table.items.length});
    const ack=page.waitForResponse(response=>response.url().startsWith(origin+'/wp-admin/admin-ajax.php')&&String(response.request().postData()||'').includes('action=tablepress_save_table'),{timeout:45000});
    await page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi|Lưu các thay đổi)$/i}).last().click();
    const saved=await ack;assert(saved.ok(),`ESC Table ${id} save failed ${saved.status()}`);
    let verified=false;
    for(let attempt=0;attempt<8;attempt++){
      const current=await read(id);
      if(changes.every(c=>current.items[c.rowIndex]?.[c.key]===c.after)){verified=true;break;}
      await new Promise(resolve=>setTimeout(resolve,800));
    }
    assert(verified,`ESC Table ${id} readback mismatch`);
    logs.push({id,status:'UPDATED_VERIFIED',cells:changes.length});
  }
  console.log('PTSCPS_EN_CMS_LOCALE_REPAIR='+JSON.stringify({status:'PASS',tables:logs,writes:logs.reduce((sum,row)=>sum+row.cells,0)}));
}finally{await browser.close();}
