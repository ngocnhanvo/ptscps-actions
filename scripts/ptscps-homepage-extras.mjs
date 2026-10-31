import { chromium } from 'playwright';

const origin = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!origin || !username || !password) throw Error('Missing configured WordPress credentials');
const specs = [
  { id:'home_14', title:'Liên kết nhanh', description:'Các dịch vụ và thông tin nhanh — nội dung quản lý bằng ESC Table', fields:['title','image','href'], rows:[
    ['Vận hành và bảo dưỡng FPSO/FSO/MOPU','','https://ptscps.com.vn/dich-vu/van-hanh-va-bao-duong-fpso-fso-mopu'],
    ['Thư viện PPS','','https://ptscps.com.vn/thu-vien-pps'],
    ['Chính sách HSEQ','','https://ptscps.com.vn/hseq/chinh-sach-skatmtcl'],
    ['Tuyển dụng','','https://ptscps.com.vn/c/tuyen-dung'],
  ]},
  { id:'home_15', title:'Khách hàng', description:'Slider logo khách hàng PTSC PPS, quản lý bằng ESC Table', fields:['title','image','href'], rows:[
    ['Biển Đông POC','',''],['Premier Oil','',''],['PetroVietnam','',''],['Murphy Oil','',''],['VOFT','',''],
    ['Cửu Long JOC','',''],['Hoàn Vũ JOC','',''],['Idemitsu','',''],['Rosneft','',''],['Hoàng Long JOC','',''],
    ['KNOC','',''],['MODEC','',''],['PETRONAS','',''],['Thăng Long JOC','',''],['NSRP','',''],
    ['Harbour Energy','',''],['enQuest','',''],['Long Sơn Petrochemicals','',''],['MVOT','',''],
  ]},
];
const labels = ['Tên hiển thị','Hình ảnh','Liên kết'];
const assert = (ok,msg) => { if (!ok) throw Error(msg); };
const browser = await chromium.launch({ headless:true });
const page = await browser.newPage({viewport:{width:1440,height:960}});
page.on('dialog', async d => { if (d.type()==='confirm' && /table id|mã bảng/i.test(d.message())) await d.accept(); else await d.dismiss(); });
const api = id => origin + '/wp-json/tablepress/v1/table/' + id;
const readTable = async id => {
  const res = await page.request.get(api(id),{timeout:20000});
  if (res.status()===404) return null;
  assert(res.ok(),`Table REST HTTP ${res.status()} (${id})`);
  return res.json();
};
async function saveTable(id, rowCount) {
  const save = page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
  assert(await save.count()>0,`Native Save unavailable: ${id}`);
  await save.last().click();
  for(let i=0;i<10;i++) {
    await page.waitForTimeout(850);
    const x=await readTable(id).catch(()=>null);
    if (x?.items?.length===rowCount && x.fields?.[0]?.key==='title' && x.fields?.[1]?.key==='image' && x.fields?.[2]?.key==='href') return x;
  }
  throw Error(`Native ESC Table save/readback failed for ${id}`);
}
async function ensureTable(spec) {
  let before=await readTable(spec.id);
  if (!before) {
    await page.goto(origin+'/wp-admin/admin.php?page=tablepress&action=add',{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('input[name="table[name]"]').fill(spec.title);
    await page.locator('textarea[name="table[description]"]').fill(spec.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill('3');
    await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:45000});
    await page.locator('#table-id').fill(spec.id);
    const save=page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
    assert(await save.count()>0,`Cannot rename native table ID ${spec.id}`);
    await save.last().click();
    for(let i=0;i<8;i++) { await page.waitForTimeout(700); before=await readTable(spec.id).catch(()=>null); if(before) break; }
    assert(before?.id===spec.id,`Native table creation did not persist ${spec.id}`);
    console.log(`EXTRAS_TABLE_CREATED=${spec.id}`);
  } else console.log(`EXTRAS_TABLE_EXISTS=${spec.id}`);
  const keys=(before.fields||[]).map(f=>String(f?.key||'').trim()).filter(Boolean);
  assert(!keys.length || (keys.length===3 && spec.fields.every((field,i)=>keys[i]===field)),`Unexpected custom schema for ${spec.id}`);
  const items=Array.isArray(before.items)?before.items:[];
  assert(items.length<=spec.rows.length,`Unexpected extra rows in ${spec.id}, refusing overwrite`);
  items.forEach((item,i)=>{
    assert(!item.title || String(item.title).trim()===spec.rows[i][0],`Existing row title mismatch in ${spec.id} ${i}`);
    assert(!item.href || String(item.href).trim()===spec.rows[i][2],`Existing link mismatch in ${spec.id} ${i}`);
  });
  const done=items.length===spec.rows.length && keys.length===3 && items.every((item,i)=>item.title===spec.rows[i][0] && String(item.href||'')===spec.rows[i][2]);
  if(done){ console.log(`EXTRAS_TABLE_ALREADY_POPULATED=${spec.id}`); return; }
  await page.goto(origin+'/wp-admin/admin.php?page=tablepress&action=edit&table_id='+spec.id,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append),null,{timeout:25000});
  const result=await page.evaluate(({spec,labels})=>{
    const ed=window.tp.editor;
    if(ed.options.columns.length!==3) throw Error('Unexpected ESC Table column count');
    const count=ed.options.data.length;
    if(count<spec.rows.length+2) window.tp.callbacks.append('rows',spec.rows.length+2-count);
    for(let col=0;col<3;col++) {
      ed.setValueFromCoords(col,0,spec.fields[col]);
      ed.setValueFromCoords(col,1,labels[col]);
    }
    for(let r=0;r<spec.rows.length;r++)for(let c=0;c<3;c++) {
      const current=String(ed.getValueFromCoords(c,r+2)||'');
      if(!current.trim())ed.setValueFromCoords(c,r+2,spec.rows[r][c]);
      else if(c!==1 && current.trim()!==spec.rows[r][c])throw Error(`Nonempty data conflict in ${spec.id} row ${r} col ${c}`);
    }
    window.tp.helpers.unsaved_changes.set();
    return {rows:ed.options.data.length,columns:ed.options.columns.length};
  },{spec,labels});
  assert(result.rows>=spec.rows.length+2 && result.columns===3,`Grid growth failed: ${spec.id}`);
  await page.locator('#table-name').fill(spec.title);
  await page.locator('#table-description').fill(spec.description);
  const saved=await saveTable(spec.id,spec.rows.length);
  assert(spec.rows.every((row,i)=>saved.items[i]?.title===row[0] && String(saved.items[i]?.href||'')===row[2]),`Table content verify failed: ${spec.id}`);
  console.log(`EXTRAS_TABLE_POPULATED=${spec.id} rows=${spec.rows.length} PASS`);
}
async function ensurePageShortcodes() {
  await page.goto(origin+'/wp-admin/edit.php?post_type=page&post_status=all&s=Trang+ch%E1%BB%A7',{waitUntil:'domcontentloaded',timeout:45000});
  const matching=page.locator('a.row-title').filter({hasText:'Trang chủ'});
  const labels=await matching.allTextContents();
  const exact=labels.filter(t=>t.trim().toLowerCase()==='trang chủ');
  assert(exact.length===1,`Expected exactly one native Trang chủ page, found ${exact.length}`);
  await matching.filter({hasText:/^Trang chủ$/}).first().click();
  await page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:30000});
  const id=await page.locator('#post_ID').inputValue();
  const status=await page.locator('#post_status').inputValue().catch(()=> '');
  const currentEditor=async()=>page.evaluate(()=>{
    const ed=window.tinymce?.get('content');
    return (ed?.getContent?.()||'')+'\n'+(document.querySelector('#content')?.value||'');
  });
  const old=await page.locator('#content').inputValue();
  assert(old.includes('home_00')&&old.includes('home_05'),`Homepage ${id} missing verified existing sections; abort`);
  const target=['home_14','home_15'];
  const needs=target.filter(t=>!old.includes(t));
  if(!needs.length){ console.log(`EXTRAS_PAGE_ALREADY_READY id=${id}`);return; }
  const visual=page.locator('#content-tmce');
  if(await visual.count()) await visual.click();
  await page.waitForFunction(()=>Boolean(window.tinymce?.get('content')?.initialized && !window.tinymce?.get('content')?.isHidden()),null,{timeout:20000});
  for(const name of needs){
    await page.evaluate(()=>{
      const ed=window.tinymce?.get('content');
      if(!ed || ed.isHidden())throw Error('Native Visual Editor missing');
      ed.focus();ed.selection.select(ed.getBody(),true);ed.selection.collapse(false);
    });
    // Thickbox sometimes preserves the previous picker iframe after inserting a
    // shortcode. Close it explicitly before opening the next native picker.
    const resetPicker=async()=>{
      await page.evaluate(()=>{if(document.querySelector('#TB_window')&&typeof window.tb_remove==='function')window.tb_remove();});
      await page.waitForTimeout(250);
    };
    const openPicker=async()=>{
      const quickTag=page.locator('#qt_content_tablepress_quicktags_button');
      const visualButton=page.locator('button[aria-label*="ESC Table"],button[title*="ESC Table"]').first();
      if(await visualButton.count()&&await visualButton.isVisible())await visualButton.click();
      else if(await quickTag.count()&&await quickTag.isVisible())await quickTag.click();
      else await page.evaluate(()=>{
        if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('ESC Table Insert Code picker unavailable');
        window.tablepress_open_shortcode_thickbox();
      });
    };
    await resetPicker();
    await openPicker();
    const picker=page.frameLocator('#TB_iframeContent');
    const choose=picker.locator(`input.insert-shortcode[title*="${name}"]`);
    try { await choose.waitFor({state:'visible',timeout:12000}); }
    catch {
      const diagnosis=await picker.locator('input.insert-shortcode').evaluateAll(
        els=>els.slice(0,35).map(el=>el.getAttribute('title')).filter(Boolean)).catch(()=>[]);
      console.log(`EXTRAS_PICKER_REOPEN=${name} existing=${JSON.stringify(diagnosis)}`);
      await resetPicker();
      // The native Thickbox entry point rebuilds the iframe even after a
      // previous selection has changed TinyMCE focus or toolbar visibility.
      await page.evaluate(()=>{
        if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('Native picker reload unavailable');
        window.tablepress_open_shortcode_thickbox();
      });
      await choose.waitFor({state:'visible',timeout:20000});
    }
    await choose.click();
    let found=false;
    for(let n=0;n<8;n++){await page.waitForTimeout(500);if((await currentEditor()).includes(name)){found=true;break;}}
    assert(found,`Native ESC Insert Code failed: ${name}`);
    console.log(`EXTRAS_NATIVE_INSERT_CODE=${name} PASS`);
  }
  const textTab=page.locator('#content-html');
  if(await textTab.count()) await textTab.click();
  const pending=await page.locator('#content').inputValue();
  assert(target.every(t=>pending.includes(t))&&['home_00','home_05'].every(t=>pending.includes(t)),`Homepage native editor lost a section`);
  const savedPublished=status==='publish';
  const save=savedPublished?page.locator('#publish'):page.locator('#save-post');
  assert(await save.count()>0,`Native ${savedPublished?'Update':'Save Draft'} button missing`);
  await save.click();
  // WordPress can still be redirecting from post.php after Update returns.
  // A navigation during that redirect is aborted by Chromium despite a
  // successful save. Retry only read-only navigation; never repeat the save.
  await page.waitForTimeout(2200);
  let reopened=false;
  for(let attempt=0;attempt<4;attempt++) {
    try {
      await page.goto(origin+'/wp-admin/post.php?post='+id+'&action=edit',{waitUntil:'domcontentloaded',timeout:45000});
      await page.locator('#content').waitFor({state:'attached',timeout:12000});
      reopened=true;
      break;
    } catch(error) {
      if(!String(error).includes('ERR_ABORTED') || attempt===3)throw error;
      console.log(`EXTRAS_READBACK_NAV_RETRY=${attempt+1}`);
      await page.waitForTimeout(1600);
    }
  }
  assert(reopened,'Could not reopen native WordPress Page after save');
  const reread=await page.locator('#content').inputValue();
  assert(target.every(t=>reread.includes(t))&&['home_00','home_05'].every(t=>reread.includes(t)),`Read-after-save missing a homepage section`);
  console.log(`EXTRAS_PAGE_READBACK=PASS id=${id} publication_preserved=${savedPublished}`);
}
try {
  await page.goto(origin+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  console.log('EXTRAS_AUTH=PASS');
  for(const spec of specs)await ensureTable(spec);
  await ensurePageShortcodes();
  console.log('EXTRAS_CMS_SETUP=PASS; no rebuild triggered; existing sections preserved');
} finally {await browser.close();}
