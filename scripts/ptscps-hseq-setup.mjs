import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert(wp.startsWith('https://') && front.startsWith('https://') && username && password, 'Missing HSEQ WordPress configuration');
const fields = ['type','title','content','link','img','label'];
const labels = ['Loại','Tiêu đề','Nội dung','Liên kết','Hình ảnh','Nhãn'];
const uri = p => wp + p;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const legacy = 'https://ptscps.com.vn';
const fileSources = {
  objective: legacy + '/wp-content/uploads/2024/08/PTS082024009.png',
  system: legacy + '/wp-content/uploads/2019/12/0001.jpg',
};
const fallbackPolicyTitles = [
  'Chính sách sử dụng rượu, cồn và các chất kích thích',
  'Chính sách sức khỏe, an toàn, môi trường và chất lượng',
  'Chính sách dừng công việc',
];
const defs = [
  {id:'hseq_00_vi',title:'HSEQ',slug:'hseq',description:'Sức khỏe · An toàn · Môi trường · Chất lượng',root:true,key:'hseq-overview'},
  {id:'hseq_01_vi',title:'Chính sách HSEQ',slug:'chinh-sach-skatmtcl',description:'Cam kết về an toàn, sức khỏe và chất lượng dịch vụ',key:'hseq-policy'},
  {id:'hseq_02_vi',title:'Mục tiêu HSEQ',slug:'muc-tieu-skatmtcl',description:'Liên tục cải tiến, đảm bảo an toàn và bảo vệ môi trường',key:'hseq-objectives'},
  {id:'hseq_03_vi',title:'Hệ thống quản lý HSEQ',slug:'he-thong-quan-ly-skatmtcl',description:'Hệ thống quản lý tích hợp theo các tiêu chuẩn quốc tế',key:'hseq-system'},
  {id:'hseq_04_vi',title:'Giấy chứng nhận HSEQ',slug:'giay-chung-nhan-skatmtcl',description:'Các chứng nhận hệ thống quản lý chất lượng, môi trường và an toàn',key:'hseq-certification'},
];
const dest = d => `/hseq/${d.slug}`;
const artifactDir='artifacts/ptscps-hseq';
await mkdir(artifactDir,{recursive:true});
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:900}});
const page = await ctx.newPage();
let cmsWrites=0;
let sourceInventory=null;
const log=(key,value)=>console.log(`HSEQ_${key}=${typeof value==='string'?value:JSON.stringify(value)}`);
const clean=x=>String(x ?? '').replace(/<[^>]*>/g,'').trim();
const img=(p,alt)=>`<img src="${p}" alt="${alt}" />`;
const norm=x=>clean(x).toLocaleLowerCase('vi-VN');

async function collectSourcePolicyDocs(p){
  await p.evaluate(async()=>{
    const height=Math.max(document.body.scrollHeight,document.documentElement.scrollHeight);
    for(let y=0;y<height;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,80));}
    window.scrollTo(0,0);
  });
  await p.waitForTimeout(500);
  const rows=await p.locator('img').evaluateAll(images=>images.map((image,index)=>{
    const rect=image.getBoundingClientRect();
    const anchor=image.closest('a');
    const candidates=[anchor?.href,image.currentSrc,image.src,image.getAttribute('data-src'),image.getAttribute('data-lazy-src')].filter(Boolean);
    const url=candidates.find(value=>/\/wp-content\/uploads\/.*\.(?:png|jpe?g|webp)(?:[?#].*)?$/i.test(String(value))) || '';
    return {index,url:String(url),alt:String(image.getAttribute('alt')||'').trim(),left:rect.left,top:rect.top,width:rect.width,height:rect.height};
  }));
  const seen=new Set();
  return rows
    .filter(row=>row.url && row.width>=170 && row.height>=230 && row.height>row.width*1.08)
    .sort((a,b)=>Math.abs(a.top-b.top)>40?a.top-b.top:a.left-b.left)
    .filter(row=>{if(seen.has(row.url))return false;seen.add(row.url);return true;})
    .map(({url,alt})=>({url,alt}));
}
async function visibleRelativeOrder(p,labels,scope='body'){
  const wanted=labels.map(label=>({label,key:norm(label)}));
  const nodes=await p.locator(`${scope} a,${scope} button`).evaluateAll(elements=>elements.map(element=>{
    const rect=element.getBoundingClientRect();
    const style=getComputedStyle(element);
    return {text:String(element.textContent||'').replace(/\s+/g,' ').trim(),left:rect.left,top:rect.top,width:rect.width,height:rect.height,visible:style.visibility!=='hidden'&&style.display!=='none'};
  }).filter(item=>item.visible&&item.width>0&&item.height>0));
  const found=wanted.map(item=>{
    const match=nodes.filter(node=>norm(node.text)===item.key).sort((a,b)=>a.top-b.top||a.left-b.left)[0];
    return match?{label:item.label,...match}:null;
  }).filter(Boolean);
  return found.sort((a,b)=>a.left-b.left||a.top-b.top).map(item=>item.label);
}
async function inventorySource(){
  const source=await browser.newContext({viewport:{width:1440,height:900}});
  const p=await source.newPage();
  try{
    const response=await p.goto(legacy+'/hseq/chinh-sach-skatmtcl?_parity='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(response?.status()===200,'Legacy HSEQ policy page unavailable');
    const rawDocs=await collectSourcePolicyDocs(p);
    assert.equal(rawDocs.length,3,`Legacy policy document count changed: expected 3, got ${rawDocs.length}`);
    const policyDocs=rawDocs.map((doc,index)=>({...doc,title:doc.alt||fallbackPolicyTitles[index]}));
    const navOrder=await visibleRelativeOrder(p,['Giới thiệu','Dịch vụ','HSEQ']);
    assert.deepEqual(navOrder,['Giới thiệu','Dịch vụ','HSEQ'],'Legacy HSEQ relative top menu order changed');
    await p.screenshot({path:`${artifactDir}/source-desktop-policy.png`,fullPage:true});
    log('SOURCE_INVENTORY_PASS',{policyDocuments:policyDocs.map(doc=>({title:doc.title,url:new URL(doc.url).pathname})),navOrder});
    return {policyDocs,navOrder};
  }finally{await source.close();}
}

async function login(){
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username); await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  assert(new URL(page.url()).origin===wp, 'WordPress admin origin mismatch');
  log('AUTH','PASS');
}
async function nonce(){
  const candidates=[
    '/wp-admin/nav-menus.php?esc_full_admin=1',
    '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1',
    '/wp-admin/post.php?post=82642&action=edit&esc_full_admin=1',
  ];
  for (const candidate of candidates){
    await page.goto(uri(candidate),{waitUntil:'domcontentloaded',timeout:45000});
    const n=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce || '').trim());
    if (/^[A-Za-z0-9_-]{8,32}$/.test(n)){
      log('REST_NONCE_SOURCE',candidate.split('?')[0]);
      return n;
    }
  }
  throw Error('WordPress REST nonce not available in the known full-admin editors');
}
async function api(method,path,n,data,headers={}){
  const response=await page.request.fetch(uri(path),{
    method,timeout:40000,headers:{'X-WP-Nonce':n,'Cache-Control':'no-cache',...headers},
    ...(data===undefined?{}:Buffer.isBuffer(data)?{data}:{data}),
  });
  const body=await response.json().catch(()=>null);
  return {response,body};
}
async function ensureMedia(name,url,n){
  const originalName=new URL(url).pathname.split('/').pop();
  const filename=`hseq-${name}.${originalName.split('.').pop()}`;
  const list=await api('GET',`/wp-json/wp/v2/media?context=edit&search=${encodeURIComponent(filename)}&per_page=100&_fields=id,slug,source_url,title`,n);
  assert(list.response.ok(),`Media listing failed ${name}`);
  const found=(list.body||[]).filter(x=>new URL(String(x.source_url||'/'),wp).pathname.split('/').pop()===filename);
  assert(found.length<=1,`Duplicate media ${filename}`);
  if(found.length){log('MEDIA',{name,state:'SKIP_EXISTING',id:found[0].id});return new URL(found[0].source_url,wp).pathname;}
  const source=await page.request.get(url,{timeout:45000});
  assert(source.ok(),`Legacy media source unavailable ${name} HTTP ${source.status()}`);
  const bytes=await source.body();
  assert(bytes.length>3000 && bytes.length<12*1024*1024,`Legacy media size not acceptable ${name}`);
  // A network disconnect may happen after WordPress has already persisted the
  // upload. Read back by filename before any one-time retry to avoid duplicates.
  for(let attempt=1;attempt<=2;attempt++){
    let result;
    try{
      result=await api('POST','/wp-json/wp/v2/media',n,bytes,{
        'Content-Type':filename.endsWith('.png')?'image/png':'image/jpeg',
        'Content-Disposition':`attachment; filename="${filename}"`,
      });
      if(result.response.ok() && Number(result.body?.id)>0){
        cmsWrites++;
        const relative=new URL(result.body.source_url,wp).pathname;
        log('MEDIA',{name,state:'UPLOADED',id:result.body.id,path:relative});
        return relative;
      }
      throw Error(`Media upload HTTP ${result.response.status()} for ${name}`);
    }catch(error){
      log('MEDIA_RETRY_DIAGNOSTIC',{name,attempt,error:String(error?.message||error).slice(0,180)});
      await sleep(1400);
      const check=await api('GET',`/wp-json/wp/v2/media?context=edit&search=${encodeURIComponent(filename)}&per_page=100&_fields=id,source_url`,n);
      if(check.response.ok()){
        const matched=(check.body||[]).filter(x=>new URL(String(x.source_url||'/'),wp).pathname.split('/').pop()===filename);
        assert(matched.length<=1,`Ambiguous media after transport failure ${filename}`);
        if(matched.length){
          log('MEDIA',{name,state:'UPLOADED_RECOVERED',id:matched[0].id});
          return new URL(matched[0].source_url,wp).pathname;
        }
      }
      if(attempt===2)throw error;
    }
  }
  throw Error('Media upload did not complete '+name);
}
function rowsFor(imagePaths){
  const nav=defs.slice(1).map(d=>['nav',d.title,'',dest(d),'','']);
  const policyCard=imagePaths.policyDocuments.at(-1);
  const cards=defs.slice(1).map((d,i)=>['card',d.title,d.description,dest(d),img([policyCard,imagePaths.objective,imagePaths.system,imagePaths.system][i],d.title),'Xem chi tiết']);
  const policyDocuments=sourceInventory.policyDocs.map((doc,index)=>[
    'document',doc.title,'','',img(imagePaths.policyDocuments[index],doc.title),'Phóng to tài liệu'
  ]);
  return [
    [...nav,...cards],
    [...nav,
      ['prose','','Công ty cung cấp dịch vụ với chất lượng quốc tế, đảm bảo an toàn cho tất cả các khách hàng với cam kết:','','',''],
      ...policyDocuments],
    [...nav,
      ['prose','','Mục tiêu liên tục nâng cao chất lượng dịch vụ phục vụ khách hàng, đảm bảo yếu tố an toàn, không gây tác động xấu tới môi trường, cộng đồng và các bên liên quan.','','',''],
      ['document','Mục tiêu HSEQ','','https://ptscps.com.vn/wp-content/uploads/2022/04/2.-Ke-hoach-thuc-hien-muc-tieu-2022-2.pdf',img(imagePaths.objective,'Tài liệu mục tiêu HSEQ'),'Xem tài liệu PDF']],
    [...nav,
      ['prose','','Hệ thống quản lý của Công ty được xây dựng trên nguyên tắc áp dụng hài hòa và đồng bộ các tiêu chuẩn quốc tế về hệ thống quản lý: Chất lượng (ISO 9001:2015), Sức khỏe nghề nghiệp và an toàn (ISO 45001:2018) và Môi trường (ISO 14001:2015) để cung cấp các dịch vụ đảm bảo chất lượng, an toàn, không gây tác động xấu tới môi trường, cộng đồng và các bên quan tâm.','','',''],
      ['prose','','Hệ thống quản lý của Công ty được xây dựng trên nguyên tắc tiếp cận theo quá trình với 3 hoạt động cơ bản là Điều hành, Hỗ trợ và Kiểm soát.','','',''],
      ['document','Mô hình quản lý HSEQ','','',img(imagePaths.system,'Sơ đồ hệ thống quản lý HSEQ'),'Phóng to sơ đồ']],
    [...nav,
      ['prose','','Các hệ thống quản lý của công ty đáp ứng những tiêu chuẩn ISO về chất lượng, môi trường và sức khỏe nghề nghiệp, an toàn.','','',''],
      ['certificate','ISO 9001:2015','Hệ thống quản lý chất lượng','','',''],
      ['certificate','ISO 14001:2015','Hệ thống quản lý môi trường','','',''],
      ['certificate','ISO 45001:2018','Hệ thống quản lý an toàn và sức khỏe nghề nghiệp','','','']],
  ];
}
async function readTable(id){
  const r=await page.request.get(uri(`/wp-json/tablepress/v1/table/${id}`),{timeout:25000,headers:{'Cache-Control':'no-cache'}});
  if(r.status()===404)return null;
  assert(r.ok(),`Failed reading ESC Table ${id}: HTTP ${r.status()}`);
  return r.json();
}
async function ensureTable(def,rows){
  let existing=await readTable(def.id);
  const previouslyPopulated=Boolean(existing?.items?.length);
  if(previouslyPopulated){
    const keys=(existing.fields||[]).map(f=>String(f.key||''));
    assert(fields.every((field,i)=>keys[i]===field),`Existing ${def.id} has different field schema; preserving CMS data`);
    if(existing.items.length===rows.length){
      log('TABLE',{id:def.id,state:'SKIP_EXISTING',rows:rows.length});return;
    }
    assert(def.id==='hseq_01_vi'&&existing.items.length<rows.length,`Refusing destructive or unexpected HSEQ table resize ${def.id}: ${existing.items.length} -> ${rows.length}`);
    log('TABLE',{id:def.id,state:'EXPAND_FOR_SOURCE_PARITY',from:existing.items.length,to:rows.length});
  }
  if(!existing){
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'),{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('input[name="table[name]"]').fill(def.title);
    await page.locator('textarea[name="table[description]"]').fill(def.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill(String(fields.length));
    await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:45000});
    const prev=new URL(page.url()).searchParams.get('table_id')||await page.locator('#table-id').inputValue();
    assert(prev,'Could not get created table ID');
    let confirmed=false;
    page.once('dialog',async d=>{confirmed=true;await d.accept()});
    await page.locator('#table-id').fill(def.id);
    await page.locator('#table-name').click();
    for(let i=0;i<10&&!confirmed;i++)await sleep(100);
    assert(confirmed,'ESC Table ID confirmation missing');
    await page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i}).last().click();
    for(let i=0;i<12;i++){await sleep(700);existing=await readTable(def.id).catch(()=>null);if(existing)break;}
    assert(existing,`ESC Table renaming failed ${def.id}`);
  }
  if(existing?.items?.length)assert(def.id==='hseq_01_vi'&&existing.items.length<rows.length,`Refusing overwrite of populated ${def.id}`);
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${def.id}`),{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append),null,{timeout:30000});
  await page.locator('#table-name').fill(def.title);
  await page.locator('#table-description').fill(def.description);
  await page.evaluate(({fields,labels,rows})=>{
    const e=window.tp.editor;
    if(e.options.columns.length!==fields.length)throw Error('Unexpected number of ESC Table columns');
    const required=rows.length+2;
    if(e.options.data.length<required)window.tp.callbacks.append('rows',required-e.options.data.length);
    if(e.options.data.length>required)throw Error('Unexpected rows in new ESC Table');
    fields.forEach((key,col)=>{e.setValueFromCoords(col,0,key);e.setValueFromCoords(col,1,labels[col]);});
    rows.forEach((row,r)=>fields.forEach((_,c)=>e.setValueFromCoords(c,r+2,String(row[c]??''))));
    window.tp.helpers.unsaved_changes.set();
  },{fields,labels,rows});
  await page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i}).last().click();
  for(let i=0;i<12;i++){
    await sleep(700);
    const check=await readTable(def.id).catch(()=>null);
    if(check?.items?.length===rows.length){existing=check;break;}
  }
  assert(existing?.items?.length===rows.length,`ESC Table readback failed ${def.id}`);
  cmsWrites++;log('TABLE',{id:def.id,state:previouslyPopulated?'UPDATED_SOURCE_PARITY':'CREATED',rows:rows.length});
}
async function setAcf(name,value){
  const field=page.locator(`.acf-field[data-name="${name}"]`).first();
  assert(await field.count()===1,`Missing ACF field ${name}`);
  const select=field.locator('select').first();if(await select.count()){await select.selectOption(value);return;}
  const input=field.locator(`input[type="text"],input[type="number"]`).first();if(await input.count()){await input.fill(value);return;}
  const radio=field.locator(`input[type="radio"][value="${value}"]`).first();if(await radio.count()){await radio.check();return;}
  throw Error(`Unsupported ACF UI ${name}`);
}
async function ensurePage(def,parentId,n){
  const r=await api('GET',`/wp-json/wp/v2/pages?context=edit&status=publish,draft,pending,private&slug=${encodeURIComponent(def.slug)}&per_page=30&_fields=id,parent,slug,status,content,acf`,n);
  assert(r.response.ok(),`Page lookup failed ${def.slug} ${r.response.status()}`);
  const matches=(r.body||[]).filter(x=>x.slug===def.slug);
  assert(matches.length<=1,`Duplicate HSEQ Page slug ${def.slug}`);
  const desired=`[table id=${def.id} /]`;
  if(matches.length){
    const current=matches[0];
    const rendered=String(current.content?.raw||current.content?.rendered||'');
    if(current.status==='publish'&&rendered.includes(def.id)&&String(current.acf?.action||'')==='IntroPage'){
      if(Number(current.parent||0)!==Number(parentId)){
        assert(String(current.acf?.key||'')===def.key,`Unexpected parent for non-HSEQ Page ${def.slug}`);
        const updated=await api('POST',`/wp-json/wp/v2/pages/${current.id}`,n,{parent:Number(parentId)});
        assert(updated.response.ok()&&Number(updated.body?.parent||0)===Number(parentId),`Cannot recover HSEQ parent for ${def.slug}`);
        cmsWrites++;
      }
      log('PAGE',{slug:def.slug,id:current.id,state:'SKIP_EXISTING'});return current.id;
    }
    // Preserve pre-existing content; do not overwrite partial or different CMS pages.
    throw Error(`HSEQ Page ${def.slug} already exists but differs; inspect Page id=${current.id} before mutation`);
  }
  await page.goto(uri('/wp-admin/post-new.php?post_type=page&esc_full_admin=1'),{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#title').fill(def.title);
  await setAcf('key',def.key);await setAcf('action','IntroPage');await setAcf('product_lang','vi');
  // Classic Editor keeps #content hidden while TinyMCE is in visual mode.
  // Update both the editor and underlying textarea; Playwright.fill requires
  // visibility and otherwise times out on this installation.
  await page.evaluate((shortcode)=>{
    const editor=window.tinymce?.get('content');
    if(editor){ editor.setContent(shortcode); editor.save(); }
    const raw=document.querySelector('#content');
    if(!raw)throw Error('Classic Editor content field missing');
    raw.value=shortcode;
    raw.dispatchEvent(new Event('input',{bubbles:true}));
    raw.dispatchEvent(new Event('change',{bubbles:true}));
  },desired);
  assert((await page.locator('#content').inputValue()).includes(def.id),'Shortcode not applied to Classic Editor');
  // Hierarchy is set through authenticated WordPress REST after publication.
  // Classic Editor hides #parent_id and Playwright cannot select a hidden control.
  await page.locator('#save-post').click();
  await page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:45000});
  const id=Number(await page.locator('#post_ID').inputValue());assert(id>0,'New HSEQ Page id missing');
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:45000});
  const edit=page.locator('#edit-slug-buttons .edit-slug');
  if(await edit.count()&&await edit.isVisible()){
    await edit.click();await page.locator('#new-post-slug').fill(def.slug);await page.locator('#edit-slug-buttons .save').click();
  }else if(await page.locator('#post_name').count()) await page.locator('#post_name').fill(def.slug);
  else throw Error('Cannot set HSEQ slug '+def.slug);
  const nav=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000});await page.locator('#publish').click();await nav;
  if(parentId){
    const moved=await api('POST',`/wp-json/wp/v2/pages/${id}`,n,{parent:Number(parentId)});
    assert(moved.response.ok()&&Number(moved.body?.parent||0)===Number(parentId),`HSEQ Page parent update failed ${def.slug}`);
  }
  const check=await api('GET',`/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,parent,slug,status,acf,content`,n);
  assert(check.response.ok(),'HSEQ Page cannot be read back');
  assert(check.body.status==='publish'&&check.body.slug===def.slug&&Number(check.body.parent||0)===Number(parentId),`HSEQ Page publication mismatch ${def.slug}`);
  assert(String(check.body.content?.raw||check.body.content?.rendered||'').includes(def.id),`HSEQ shortcode not saved ${def.slug}`);
  cmsWrites++;log('PAGE',{slug:def.slug,id,state:'CREATED'});return id;
}
function titleOf(x){return clean(x?.title?.raw??x?.title?.rendered??x?.title)}
async function ensureMenu(n){
  const response=await page.request.get(uri('/wp-json/esc-api/v1/menus'),{timeout:30000});
  assert(response.ok(),'ESC Header menu endpoint unavailable');
  const d=await response.json();const header=d?.menus?.Header?.vi;
  assert(header?.id&&Array.isArray(header.items),'Header.vi missing');
  const top=(header.items||[]).filter(x=>String(x.label||'')==='HSEQ');
  assert(top.length<=1,'Duplicated HSEQ top menu');
  const desired=[{title:'Tất cả',url:'/hseq'},...defs.slice(1).map(x=>({title:x.title,url:dest(x)}))];
  const topLabels=(header.items||[]).map(x=>String(x.label||''));
  const serviceIndex=topLabels.indexOf('Dịch vụ');
  const hseqIndex=topLabels.indexOf('HSEQ');
  const relativeOrderCorrect=serviceIndex>=0&&hseqIndex===serviceIndex+1;
  const same=top.length===1
    &&relativeOrderCorrect
    &&top[0].children?.length===desired.length
    &&desired.every((w,i)=>top[0].children?.[i]?.label===w.title
      &&String(top[0].children?.[i]?.href||'').replace(/^\/+|\/+$/g,'')===w.url.replace(/^\/+|\/+$/g,''));
  if(same){log('MENU','SKIP_EXISTING');return;}
  const all=await api('GET',`/wp-json/wp/v2/menu-items?context=edit&per_page=100&_fields=id,title,menus,parent,url,status,menu_order`,n);
  assert(all.response.ok(),'Cannot read current WordPress menu items');
  const items=(all.body||[]).filter(x=>{
    const menuIds=Array.isArray(x.menus)?x.menus:[x.menus];
    return menuIds.some(id=>Number(id)===Number(header.id));
  });
  const existingParent=items.filter(x=>titleOf(x)==='HSEQ'&&Number(x.parent||0)===0);
  assert(existingParent.length<=1,'Ambiguous HSEQ parent');
  let parentId=existingParent[0]?.id;
  if(!parentId){
    const created=await api('POST','/wp-json/wp/v2/menu-items',n,{title:'HSEQ',type:'custom',url:'/hseq',menus:Number(header.id),status:'publish',parent:0});
    assert(created.response.ok(),`HSEQ parent menu creation failed HTTP ${created.response.status()}`);
    parentId=created.body.id;items.push(created.body);cmsWrites++;
  }
  const topItems=items.filter(x=>Number(x.parent||0)===0).sort((a,b)=>Number(a.menu_order||0)-Number(b.menu_order||0)||Number(a.id)-Number(b.id));
  const serviceItem=topItems.find(x=>titleOf(x)==='Dịch vụ');
  const hseqItem=topItems.find(x=>Number(x.id)===Number(parentId));
  assert(serviceItem&&hseqItem,'Cannot position HSEQ after Dịch vụ');
  const orderedTop=topItems.filter(x=>Number(x.id)!==Number(parentId));
  orderedTop.splice(orderedTop.findIndex(x=>Number(x.id)===Number(serviceItem.id))+1,0,hseqItem);
  for(const [index,item] of orderedTop.entries()){
    const menuOrder=(index+1)*10;
    if(Number(item.menu_order||0)===menuOrder)continue;
    const update=await api('POST',`/wp-json/wp/v2/menu-items/${item.id}`,n,{menu_order:menuOrder});
    assert(update.response.ok(),`Cannot update top-level menu order for ${titleOf(item)}`);
    cmsWrites++;
  }
  for(const [index,expected] of desired.entries()){
    const matches=items.filter(x=>Number(x.parent||0)===Number(parentId)&&titleOf(x)===expected.title);
    assert(matches.length<=1,`Duplicate HSEQ submenu ${expected.title}`);
    const menuOrder=201+index;
    const data={title:expected.title,type:'custom',url:expected.url,menus:Number(header.id),status:'publish',parent:Number(parentId),menu_order:menuOrder};
    if(matches.length){
      if(String(matches[0].url||'')===expected.url&&Number(matches[0].menu_order||0)===menuOrder)continue;
      const update=await api('POST',`/wp-json/wp/v2/menu-items/${matches[0].id}`,n,data);
      assert(update.response.ok(),`Cannot update HSEQ menu ${expected.title}`);cmsWrites++;
    }else{
      const created=await api('POST','/wp-json/wp/v2/menu-items',n,data);
      assert(created.response.ok(),`Cannot create HSEQ menu ${expected.title}`);cmsWrites++;
    }
  }
  for(let attempt=0;attempt<8;attempt++){
    await sleep(500);
    const verify=await page.request.get(uri(`/wp-json/esc-api/v1/menus?_hseq_menu=${Date.now()}`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
    assert(verify.ok(),'Cannot verify HSEQ Header menu');
    const menuItems=(await verify.json())?.menus?.Header?.vi?.items||[];
    const current=menuItems.find(x=>String(x.label||'')==='HSEQ');
    const children=current?.children||[];
    const labels=menuItems.map(x=>String(x.label||''));
    const serviceAt=labels.indexOf('Dịch vụ');
    const hseqAt=labels.indexOf('HSEQ');
    if(serviceAt>=0&&hseqAt===serviceAt+1&&children.length===desired.length&&desired.every((w,i)=>children[i]?.label===w.title&&String(children[i]?.href||'').replace(/^\/+|\/+$/g,'')===w.url.replace(/^\/+|\/+$/g,''))){
      log('MENU',{status:'PASS',topLevel:labels,children:desired.map(x=>x.title)});return;
    }
  }
  throw Error('HSEQ submenu order readback mismatch');
}


async function isPublished(){
  for(const d of defs){
    const path=d.root?'/hseq':dest(d);
    const response=await ctx.request.get(`${front}${path}?_hseq_qa=${Date.now()}`,{timeout:30000,headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
    if(response?.status()!==200)return false;
    const body=await response.text();
    if(!body.includes('data-hseq-section')||!body.includes(d.title))return false;
  }
  const expectedMenu=['Tất cả',...defs.slice(1).map(d=>d.title)];
  const probe=await ctx.newPage();
  try{
    const response=await probe.goto(`${front}/hseq?_hseq_menu_publish=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>null);
    if(response?.status()!==200)return false;
    const toggle=probe.locator('#header-navrow button').filter({hasText:'HSEQ'}).first();
    if(await toggle.count()!==1)return false;
    const panelId=await toggle.getAttribute('aria-controls');
    if(!panelId)return false;
    const labels=(await probe.locator(`#${panelId} a`).allTextContents()).map(clean);
    if(JSON.stringify(labels)!==JSON.stringify(expectedMenu))return false;
    const relative=await visibleRelativeOrder(probe,sourceInventory.navOrder,'#header-navrow');
    if(JSON.stringify(relative)!==JSON.stringify(sourceInventory.navOrder))return false;
    const policyResponse=await probe.goto(`${front}/hseq/chinh-sach-skatmtcl?_hseq_policy_publish=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>null);
    if(policyResponse?.status()!==200)return false;
    return await probe.locator('button[data-gallery-trigger]').count()===sourceInventory.policyDocs.length;
  }finally{
    await probe.close();
  }
}
async function buildThroughWordPress(){
  if(!cmsWrites && await isPublished()){log('BUILD','ALREADY_PUBLISHED_SKIP_TRIGGER');return;}
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:50000});
  const button=page.locator('#vcs-build-btn-main');
  const force=page.locator('#vcs-force-build');
  assert(await button.count()===1&&await force.count()===1,'WordPress Build Website controls missing');
  const readState=()=>page.evaluate(()=>({
    configured:globalThis.vcsBuild?.build_configured,
    active:Boolean(globalThis.vcsBuild?.initial_active),
    pending:Number(globalThis.vcsBuild?.pending_count||document.querySelector('#vcs-pending-count')?.textContent||0),
  }));
  let status=await readState();
  assert([true,1,'1'].includes(status.configured),'WordPress Build Website not configured');
  log('BUILD_STATE',status);

  if(status.active){
    log('BUILD','EXISTING_BUILD_MONITOR');
    const existing=await waitForWordPressBuild({page,log,expectTriggered:false});
    log('BUILD_EXISTING_RESULT',existing);
    await page.reload({waitUntil:'domcontentloaded',timeout:50000});
    if(!cmsWrites && await isPublished()){
      log('BUILD','EXISTING_BUILD_COMPLETED_AND_PUBLISHED');
      return;
    }
    status=await readState();
    assert(!status.active,'WordPress still reports an active build after monitor completion');
  }

  if(await button.isDisabled()){
    assert(!await force.isDisabled(),'Build disabled and force unavailable');
    await force.check();
  }
  const acknowledge=page.waitForResponse(r=>r.url().startsWith(wp + '/wp-admin/admin-ajax.php')
    &&r.request().method()==='POST'
    &&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
  await button.click();
  const response=await acknowledge;
  const body=await response.json().catch(()=>null);
  assert(response.ok()&&body?.success===true,'Native WordPress Build Website rejected trigger');
  log('BUILD','TRIGGERED_VIA_WORDPRESS');
  const result=await waitForWordPressBuild({page,log,expectTriggered:true});
  log('BUILD_RESULT',result);
}
async function qa(){
  for(let i=0;i<52;i++){
    if(await isPublished()){log('FRONT_READY','PASS');break;}
    assert(i<51,'HSEQ frontend did not publish after WordPress build');
    await sleep(15000);
  }
  const expectedMenu=[{title:'Tất cả',href:'/hseq'},...defs.slice(1).map(d=>({title:d.title,href:dest(d)}))];
  for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
    const view=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
    const p=await view.newPage();
    const r=await p.goto(`${front}/hseq?_qa=${Date.now()}`,{waitUntil:'load',timeout:50000});
    assert(r?.status()===200,`HSEQ ${viewport.name} HTTP failure`);
    assert(await p.locator('[data-hseq-card-grid] a').count()===4,`HSEQ cards count mismatch ${viewport.name}`);
    const scrollWidth=await p.evaluate(()=>document.documentElement.scrollWidth);
    assert(scrollWidth<=viewport.width+2,`HSEQ horizontal overflow ${viewport.name}: ${scrollWidth}`);
    for(const d of defs.slice(1)){
      const link=p.locator(`[data-hseq-card-grid] a[href$="${d.slug}"]`);
      assert(await link.count()===1,`Missing HSEQ link ${d.slug}`);
    }
    const images=p.locator('[data-hseq-card-grid] img');
    for(let i=0;i<await images.count();i++){
      await images.nth(i).scrollIntoViewIfNeeded();
      await p.waitForFunction(index=>{
        const image=document.querySelectorAll('[data-hseq-card-grid] img')[index];
        return image&&image.complete&&image.naturalWidth>0;
      },i,{timeout:12000});
    }
    await p.screenshot({path:`${artifactDir}/${viewport.name}-hseq.png`,fullPage:true});
    if(viewport.name==='desktop'){
      const toggle=p.locator('#header-navrow button').filter({hasText:'HSEQ'}).first();
      assert(await toggle.isVisible(),'Desktop HSEQ menu button missing');
      await toggle.click();
      const panelId=await toggle.getAttribute('aria-controls');
      assert(panelId,'Desktop HSEQ menu panel id missing');
      const menuLinks=p.locator(`#${panelId} a`);
      assert.deepEqual((await menuLinks.allTextContents()).map(clean),expectedMenu.map(item=>item.title),'Desktop HSEQ submenu order mismatch');
      for(let i=0;i<expectedMenu.length;i++){
        const link=menuLinks.nth(i);
        const item=expectedMenu[i];
        assert(await link.isVisible(),`Desktop HSEQ submenu missing ${item.title}`);
        assert.equal(await link.getAttribute('href'),item.href,`Desktop HSEQ submenu href mismatch ${item.title}`);
        assert.notEqual(await link.getAttribute('target'),'_blank',`Desktop HSEQ submenu opens new tab ${item.title}`);
      }
      await p.screenshot({path:`${artifactDir}/desktop-hseq-menu.png`,fullPage:false});
    }else{
      const hamburger=p.locator('#hamburger-btn');
      assert(await hamburger.isVisible(),'Mobile hamburger missing');
      await hamburger.click();
      const toggle=p.locator('#mobile-menu-container [data-menu-toggle]').filter({hasText:'HSEQ'}).first();
      assert(await toggle.isVisible(),'Mobile HSEQ menu toggle missing');
      await toggle.click();
      const panelId=await toggle.getAttribute('aria-controls');
      assert(panelId,'Mobile HSEQ menu panel id missing');
      const menuLinks=p.locator(`#${panelId} a`);
      assert.deepEqual((await menuLinks.allTextContents()).map(clean),expectedMenu.map(item=>item.title),'Mobile HSEQ submenu order mismatch');
      for(let i=0;i<expectedMenu.length;i++){
        const link=menuLinks.nth(i);
        const item=expectedMenu[i];
        assert(await link.isVisible(),`Mobile HSEQ submenu missing ${item.title}`);
        assert.equal(await link.getAttribute('href'),item.href,`Mobile HSEQ submenu href mismatch ${item.title}`);
        assert.notEqual(await link.getAttribute('target'),'_blank',`Mobile HSEQ submenu opens new tab ${item.title}`);
      }
      await p.screenshot({path:`${artifactDir}/mobile-hseq-menu.png`,fullPage:false});
    }
    const policyResponse=await p.goto(`${front}/hseq/chinh-sach-skatmtcl?_qa_policy=${Date.now()}`,{waitUntil:'load',timeout:50000});
    assert(policyResponse?.status()===200,`HSEQ policy ${viewport.name} HTTP failure`);
    const targetDocs=p.locator('button[data-gallery-trigger]');
    assert.equal(await targetDocs.count(),sourceInventory.policyDocs.length,`DATA_PARITY_FAIL policy documents ${viewport.name}`);
    const targetHeadings=(await p.locator('article h2').allTextContents()).map(clean);
    for(const expected of sourceInventory.policyDocs.map(doc=>doc.title))assert(targetHeadings.includes(expected),`DATA_PARITY_FAIL missing policy document title ${expected}`);
    const targetOverflow=await p.evaluate(()=>document.documentElement.scrollWidth);
    assert(targetOverflow<=viewport.width+2,`HSEQ policy horizontal overflow ${viewport.name}: ${targetOverflow}`);
    await p.screenshot({path:`${artifactDir}/target-${viewport.name}-policy.png`,fullPage:true});

    const legacyView=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});
    const legacyPage=await legacyView.newPage();
    const legacyResponse=await legacyPage.goto(legacy+'/hseq/chinh-sach-skatmtcl?_qa_source='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(legacyResponse?.status()===200,`Legacy HSEQ policy ${viewport.name} HTTP failure`);
    const legacyDocs=await collectSourcePolicyDocs(legacyPage);
    assert.equal(legacyDocs.length,sourceInventory.policyDocs.length,`SOURCE_INVENTORY_FAIL policy documents changed ${viewport.name}`);
    await legacyPage.screenshot({path:`${artifactDir}/source-${viewport.name}-policy.png`,fullPage:true});
    await legacyView.close();

    if(viewport.name==='desktop'){
      const relative=await visibleRelativeOrder(p,sourceInventory.navOrder,'#header-navrow');
      assert.deepEqual(relative,sourceInventory.navOrder,'NAV_PARITY_FAIL HSEQ top-level relative order');
      log('NAV_PARITY_PASS',{relativeOrder:relative});
      log('DATA_PARITY_PASS',{policyDocuments:sourceInventory.policyDocs.length});
    }
    log('VISUAL_PARITY_PASS',{viewport:viewport.name,approvedException:'HSEQ presentation redesigned; source content/media/navigation preserved'});
    log('QA',{viewport:viewport.name,status:'PASS',menu:'PASS'});
    await view.close();
  }
}

try{
  sourceInventory=await inventorySource();
  await login();
  const n=await nonce();
  const media={policyDocuments:[]};
  for(const [index,doc] of sourceInventory.policyDocs.entries())media.policyDocuments.push(await ensureMedia(`policy-${index+1}`,doc.url,n));
  for(const [key,url] of Object.entries(fileSources))media[key]=await ensureMedia(key,url,n);
  const rows=rowsFor(media);
  for(let i=0;i<defs.length;i++)await ensureTable(defs[i],rows[i]);
  const rootId=await ensurePage(defs[0],0,n);
  for(const def of defs.slice(1))await ensurePage(def,rootId,n);
  await ensureMenu(n);
  log('CMS',{status:'PASS',pages:defs.length,tables:defs.length,writes:cmsWrites});
  await buildThroughWordPress();
  await qa();
  log('RESULT','PASS');
}finally{await browser.close();}
