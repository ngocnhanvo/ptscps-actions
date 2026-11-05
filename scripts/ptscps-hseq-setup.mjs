import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const wp = String(process.env.WP_ORIGIN || '').replace(/\/$/, '');
const front = String(process.env.FRONT_ORIGIN || '').replace(/\/$/, '');
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
assert(wp.startsWith('https://') && front.startsWith('https://') && username && password, 'Missing HSEQ WordPress configuration');
const fields = ['type','title','content','link','img','label'];
const labels = ['Loại','Tiêu đề','Nội dung','Liên kết','Hình ảnh','Nhãn'];
const uri = p => wp + p;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const fileSources = {
  policy: 'https://ptscps.com.vn/wp-content/uploads/2024/08/PTS082024007.png',
  objective: 'https://ptscps.com.vn/wp-content/uploads/2024/08/PTS082024009.png',
  system: 'https://ptscps.com.vn/wp-content/uploads/2019/12/0001.jpg',
};
const defs = [
  {id:'hseq_00_vi',title:'HSEQ',slug:'hseq',description:'Sức khỏe · An toàn · Môi trường · Chất lượng',root:true,key:'hseq-overview'},
  {id:'hseq_01_vi',title:'Chính sách HSEQ',slug:'chinh-sach-skatmtcl',description:'Cam kết về an toàn, sức khỏe và chất lượng dịch vụ',key:'hseq-policy'},
  {id:'hseq_02_vi',title:'Mục tiêu HSEQ',slug:'muc-tieu-skatmtcl',description:'Liên tục cải tiến, đảm bảo an toàn và bảo vệ môi trường',key:'hseq-objectives'},
  {id:'hseq_03_vi',title:'Hệ thống quản lý HSEQ',slug:'he-thong-quan-ly-skatmtcl',description:'Hệ thống quản lý tích hợp theo các tiêu chuẩn quốc tế',key:'hseq-system'},
  {id:'hseq_04_vi',title:'Giấy chứng nhận HSEQ',slug:'giay-chung-nhan-skatmtcl',description:'Các chứng nhận hệ thống quản lý chất lượng, môi trường và an toàn',key:'hseq-certification'},
];
const dest = d => `/hseq/${d.slug}`;
const browser = await chromium.launch({headless:true});
const ctx = await browser.newContext({viewport:{width:1440,height:900}});
const page = await ctx.newPage();
let cmsWrites=0;
const log=(key,value)=>console.log(`HSEQ_${key}=${typeof value==='string'?value:JSON.stringify(value)}`);
const clean=x=>String(x ?? '').replace(/<[^>]*>/g,'').trim();
const img=(p,alt)=>`<img src="${p}" alt="${alt}" />`;

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
  const result=await api('POST','/wp-json/wp/v2/media',n,bytes,{
    'Content-Type':filename.endsWith('.png')?'image/png':'image/jpeg',
    'Content-Disposition':`attachment; filename="${filename}"`,
  });
  assert(result.response.ok() && Number(result.body?.id)>0,`Media upload failed ${name}: ${result.response.status()}`);
  cmsWrites++;
  const relative=new URL(result.body.source_url,wp).pathname;
  log('MEDIA',{name,state:'UPLOADED',id:result.body.id,path:relative});
  return relative;
}
function rowsFor(imagePaths){
  const nav=defs.slice(1).map(d=>['nav',d.title,'',dest(d),'','']);
  const cards=defs.slice(1).map((d,i)=>['card',d.title,d.description,dest(d),img([imagePaths.policy,imagePaths.objective,imagePaths.system,imagePaths.system][i],d.title),'Xem chi tiết']);
  return [
    [...nav,...cards],
    [...nav,
      ['prose','','Công ty cung cấp dịch vụ với chất lượng quốc tế, đảm bảo an toàn cho tất cả các khách hàng với cam kết:','','',''],
      ['document','Chính sách HSEQ','','',img(imagePaths.policy,'Văn bản chính sách HSEQ'),'Xem tài liệu']],
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
  if(existing?.items?.length){
    assert(existing.items.length===rows.length,`Existing ${def.id} has unexpected row count; preserving CMS data`);
    const keys=(existing.fields||[]).map(f=>String(f.key||''));
    assert(fields.every((field,i)=>keys[i]===field),`Existing ${def.id} has different field schema; preserving CMS data`);
    log('TABLE',{id:def.id,state:'SKIP_EXISTING',rows:rows.length});return;
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
  assert(!existing?.items?.length,`Refusing overwrite of ${def.id}`);
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
  cmsWrites++;log('TABLE',{id:def.id,state:'CREATED',rows:rows.length});
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
  const matches=(r.body||[]).filter(x=>x.slug===def.slug && Number(x.parent||0)===Number(parentId));
  assert(matches.length<=1,`Duplicate HSEQ Page ${def.slug}`);
  const desired=`[table id=${def.id} /]`;
  if(matches.length){
    const current=matches[0];
    const rendered=String(current.content?.raw||current.content?.rendered||'');
    if(current.status==='publish'&&rendered.includes(def.id)&&String(current.acf?.action||'')==='IntroPage'){
      log('PAGE',{slug:def.slug,id:current.id,state:'SKIP_EXISTING'});return current.id;
    }
    // Preserve pre-existing content; do not overwrite partial or different CMS pages.
    throw Error(`HSEQ Page ${def.slug} already exists but differs; inspect Page id=${current.id} before mutation`);
  }
  await page.goto(uri('/wp-admin/post-new.php?post_type=page&esc_full_admin=1'),{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#title').fill(def.title);
  await setAcf('key',def.key);await setAcf('action','IntroPage');await setAcf('product_lang','vi');
  const htmlTab=page.locator('#content-html');if(await htmlTab.count())await htmlTab.click();
  await page.locator('#content').fill(desired);
  const parent=page.locator('#parent_id');
  if(parentId && await parent.count())await parent.selectOption(String(parentId));
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
  const same=top.length===1&&desired.every(w=>top[0].children?.some(c=>c.label===w.title&&String(c.href||'').replace(/^\/+|\/+$/g,'')===w.url.replace(/^\/+|\/+$/g,'')))&&top[0].children?.length===desired.length;
  if(same){log('MENU','SKIP_EXISTING');return;}
  const all=await api('GET',`/wp-json/wp/v2/menu-items?context=edit&per_page=100&_fields=id,title,menus,parent,url,status`,n);
  assert(all.response.ok(),'Cannot read current WordPress menu items');
  const items=(all.body||[]).filter(x=>(x.menus||[]).includes(Number(header.id)));
  const existingParent=items.filter(x=>titleOf(x)==='HSEQ'&&Number(x.parent||0)===0);
  assert(existingParent.length<=1,'Ambiguous HSEQ parent');
  let parentId=existingParent[0]?.id;
  if(!parentId){
    const created=await api('POST','/wp-json/wp/v2/menu-items',n,{title:'HSEQ',type:'custom',url:'/hseq',menus:Number(header.id),status:'publish',parent:0});
    assert(created.response.ok(),`HSEQ parent menu creation failed HTTP ${created.response.status()}`);
    parentId=created.body.id;cmsWrites++;
  }
  for(const expected of desired){
    const matches=items.filter(x=>Number(x.parent||0)===Number(parentId)&&titleOf(x)===expected.title);
    assert(matches.length<=1,`Duplicate HSEQ submenu ${expected.title}`);
    const data={title:expected.title,type:'custom',url:expected.url,menus:Number(header.id),status:'publish',parent:Number(parentId)};
    if(matches.length){
      if(String(matches[0].url||'')===expected.url)continue;
      const update=await api('POST',`/wp-json/wp/v2/menu-items/${matches[0].id}`,n,data);
      assert(update.response.ok(),`Cannot update HSEQ menu ${expected.title}`);cmsWrites++;
    }else{
      const created=await api('POST','/wp-json/wp/v2/menu-items',n,data);
      assert(created.response.ok(),`Cannot create HSEQ menu ${expected.title}`);cmsWrites++;
    }
  }
  log('MENU','PASS');
}


async function isPublished(){
  for(const d of defs){
    const path=d.root?'/hseq':dest(d);
    const response=await ctx.request.get(`${front}${path}?_hseq_qa=${Date.now()}`,{timeout:30000,headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
    if(response?.status()!==200)return false;
    const body=await response.text();
    if(!body.includes('data-hseq-section')||!body.includes(d.title))return false;
  }
  return true;
}
async function buildThroughWordPress(){
  if(!cmsWrites && await isPublished()){log('BUILD','ALREADY_PUBLISHED_SKIP_TRIGGER');return;}
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:50000});
  const button=page.locator('#vcs-build-btn-main');
  const force=page.locator('#vcs-force-build');
  assert(await button.count()===1&&await force.count()===1,'WordPress Build Website controls missing');
  const status=await page.evaluate(()=>({
    configured:globalThis.vcsBuild?.build_configured,
    active:Boolean(globalThis.vcsBuild?.initial_active),
    pending:Number(globalThis.vcsBuild?.pending_count||0),
  }));
  assert([true,1,'1'].includes(status.configured),'WordPress Build Website not configured');
  log('BUILD_STATE',status);
  if(status.active){
    log('BUILD','BUILD_ALREADY_RUNNING_SKIP_DUPLICATE');return;
  }
  if(await button.isDisabled()){
    assert(!await force.isDisabled(),'Build disabled and force unavailable');
    await force.check();
  }
  const acknowledge=page.waitForResponse(r=>r.url().startsWith(`${wp}/wp-admin/admin-ajax.php`)
    &&r.request().method()==='POST'
    &&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
  await button.click();
  const response=await acknowledge;
  assert(response.ok()&&((await response.json())?.success===true),'Native WordPress Build Website rejected trigger');
  log('BUILD','TRIGGERED_VIA_WORDPRESS');
}
async function qa(){
  for(let i=0;i<52;i++){
    if(await isPublished()){log('FRONT_READY','PASS');break;}
    assert(i<51,'HSEQ frontend did not publish after WordPress build');
    await sleep(15000);
  }
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
    log('QA',{viewport:viewport.name,status:'PASS'});
    await view.close();
  }
}

try{
  await login();
  const n=await nonce();
  const media={};
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
