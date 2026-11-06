import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp=String(process.env.WP_ORIGIN||'').replace(/\/$/,'');
const front=String(process.env.FRONT_ORIGIN||'').replace(/\/$/,'');
const user=process.env.WP_ADMIN_USERNAME;
const pass=process.env.WP_ADMIN_PASSWORD;
const source='https://ptscps.com.vn';
assert(wp.startsWith('https://')&&front.startsWith('https://')&&wp!==front&&user&&pass,'Missing validated PTSCPS WordPress inputs');
const artifact='artifacts/ptscps-recruitment-contact';
await mkdir(artifact,{recursive:true});
const browser=await chromium.launch({headless:true});
const ctx=await browser.newContext({viewport:{width:1440,height:960}});
const page=await ctx.newPage();
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const log=(key,value)=>console.log(`PTSCPS_RECRUIT_CONTACT_${key}=${typeof value==='string'?value:JSON.stringify(value)}`);
const uri=p=>wp+p;
const plain=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/&nbsp;/gi,' ').replace(/&amp;/gi,'&').replace(/\s+/g,' ').trim();
const val=x=>String(x?.value??x??'');
let writes=0;
const deferred=[];

async function login(){
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  log('AUTH','PASS');
}
async function nonce(){
  // The native WP admin exposes the authenticated REST nonce. The old
  // admin-ajax fallback is not guaranteed by every installation.
  let menuId=0;
  try{
    const r=await page.request.get(uri(`/wp-json/esc-api/v1/menus?_rc_nonce=${Date.now()}`),{
      timeout:30000,headers:{'Cache-Control':'no-cache'},
    });
    if(r.ok())menuId=Number((await r.json())?.menus?.Header?.vi?.id||0);
  }catch{}
  const adminPages=[
    ...(menuId?[`/wp-admin/nav-menus.php?action=edit&menu=${menuId}&esc_full_admin=1`]:[]),
    '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1',
  ];
  for(const path of adminPages){
    await page.goto(uri(path),{waitUntil:'domcontentloaded',timeout:50000});
    const value=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce||'').trim());
    if(/^[A-Za-z0-9_-]{8,32}$/.test(value)){
      log('NONCE_SOURCE',path.split('?')[0]);
      return value;
    }
  }
  const r=await page.request.post(uri('/wp-admin/admin-ajax.php'),{
    form:{action:'rest-nonce'},timeout:30000,
  }).catch(()=>null);
  const value=r?.ok()?(await r.text()).trim():'';
  assert(/^[A-Za-z0-9_-]{8,32}$/.test(value),'Unable to retrieve authenticated WordPress REST nonce');
  log('NONCE_SOURCE','admin-ajax');
  return value;
}
async function api(method,path,n,data,timeout=45000){
  const r=await page.request.fetch(uri(path),{method,timeout,headers:{'X-WP-Nonce':n,'Cache-Control':'no-cache'},...(data===undefined?{}:{data})});
  const body=await r.json().catch(()=>null);
  return {r,body};
}
async function sourceGet(path){
  const url=source+path;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const r=await ctx.request.get(url,{timeout:35000,headers:{'Cache-Control':'no-cache'}});
      if(r.ok())return {r,body:await r.json()};
      if(![429,500,502,503,504].includes(r.status())||attempt===4)throw Error(`HTTP ${r.status()} ${path}`);
    }catch(error){if(attempt===4)throw error;}
    await sleep(800*attempt);
  }
  throw Error(`Legacy source unavailable ${path}`);
}
async function sourceRecruitment(){
  const categories=(await sourceGet('/wp-json/wp/v2/categories?slug=tuyen-dung&per_page=20&_fields=id,slug,name,count')).body;
  assert(categories.length===1,`Legacy recruitment category missing/ambiguous: ${categories.length}`);
  const category=categories[0];
  const count=Number(category.count||0);
  assert(count>0&&count<=250,`Unexpected source recruitment post count: ${count}`);
  const posts=[];
  for(let number=1;number<=Math.ceil(count/100);number++){
    const {body}=await sourceGet(`/wp-json/wp/v2/posts?status=publish&categories=${category.id}&per_page=100&page=${number}&orderby=date&order=desc&_fields=id,slug,title,excerpt,content,date,date_gmt,featured_media`);
    assert(Array.isArray(body),'Source recruitment posts response invalid');
    posts.push(...body);
  }
  assert(posts.length===count,`Recruitment source count mismatch ${posts.length}/${count}`);
  log('SOURCE',{categoryId:category.id,total:posts.length,slugs:posts.map(x=>x.slug)});
  return posts;
}
async function ensureCategory(n){
  const path='/wp-json/wp/v2/categories?slug=tuyen-dung&per_page=20&_fields=id,slug,name';
  const check=await api('GET',path,n);
  assert(check.r.ok(),'Target recruitment category API failed');
  assert(check.body.length<=1,'Duplicate recruitment categories in target');
  if(check.body.length){log('CATEGORY',{state:'EXISTS',id:check.body[0].id});return check.body[0].id;}
  const created=await api('POST','/wp-json/wp/v2/categories',n,{name:'Tuyển dụng',slug:'tuyen-dung'});
  assert(created.r.ok()&&created.body?.id,'Cannot create recruitment category');
  writes++;
  log('CATEGORY',{state:'CREATED',id:created.body.id});
  return created.body.id;
}
const mediaCache=new Map();
const mimeType=(url)=>{
  const name=new URL(url).pathname.toLowerCase();
  if(name.endsWith('.pdf'))return 'application/pdf';
  if(name.endsWith('.png'))return 'image/png';
  if(name.endsWith('.webp'))return 'image/webp';
  if(name.endsWith('.gif'))return 'image/gif';
  if(name.endsWith('.docx'))return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
  if(name.endsWith('.doc'))return 'application/msword';
  return 'image/jpeg';
};
async function mediaFor(url,n,context){
  const normalized=new URL(url,source).href;
  if(mediaCache.has(normalized))return mediaCache.get(normalized);
  const candidate=new URL(normalized);
  if(!/(?:^|\.)ptscps\.com\.vn$/i.test(candidate.hostname)||!candidate.pathname.startsWith('/wp-content/uploads/'))return {url:normalized,id:0};
  const file=decodeURIComponent(candidate.pathname.split('/').pop()||'');
  assert(file&&!file.includes('/')&&!file.includes('\\'),'Invalid source media filename');
  const lookup=await api('GET',`/wp-json/wp/v2/media?context=edit&search=${encodeURIComponent(file)}&per_page=100&_fields=id,source_url,media_details`,n);
  if(lookup.r.ok()){
    const current=(lookup.body||[]).find(x=>{
      try{return decodeURIComponent(new URL(x.source_url).pathname.split('/').pop()||'')===file;}catch{return false;}
    });
    if(current){const result={url:String(current.source_url),id:Number(current.id)};mediaCache.set(normalized,result);return result;}
  }
  let reason='';
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const download=await ctx.request.get(normalized,{timeout:25000});
      if(!download.ok())throw Error(`download HTTP ${download.status()}`);
      const bytes=await download.body();
      if(!bytes?.length||bytes.length>30*1024*1024)throw Error('empty/oversized media');
      const upload=await page.request.post(uri('/wp-json/wp/v2/media'),{
        timeout:45000,
        headers:{'X-WP-Nonce':n,'Content-Disposition':`attachment; filename="${file.replace(/"/g,'')}"`,'Content-Type':mimeType(normalized)},
        data:bytes,
      });
      const saved=await upload.json().catch(()=>null);
      if(!upload.ok()||!saved?.id||!saved?.source_url)throw Error(`upload HTTP ${upload.status()}`);
      const result={url:String(saved.source_url),id:Number(saved.id)};
      mediaCache.set(normalized,result);writes++;
      log('MEDIA',{state:'UPLOADED',file,id:result.id});
      return result;
    }catch(error){reason=String(error?.message||error);if(attempt<4)await sleep(1000*attempt);}
  }
  deferred.push({url:normalized,file,context,attempts:4,reason});
  log('ASSET_DEFERRED',{file,context,attempts:4,reason});
  const fallback={url:'',id:0};
  mediaCache.set(normalized,fallback);
  return fallback;
}
async function localizeHtml(html,n,postSlug){
  let output=String(html||'');
  const urlRe=/(?:https?:)?\/\/ptscps\.com\.vn\/wp-content\/uploads\/[^\s"'<>]+|\/wp-content\/uploads\/[^\s"'<>]+/gi;
  const assets=[...new Set(output.match(urlRe)||[])];
  for(const original of assets){
    const sourceUrl=new URL(original,source).href;
    const saved=await mediaFor(sourceUrl,n,postSlug);
    if(saved.url)output=output.split(original).join(saved.url);
    else{
      // Never hotlink an unavailable legacy asset on the new public site.
      output=output.replace(/<img\b[^>]*>/gi,tag=>tag.includes(original)?'':tag);
      output=output.split(original).join('#');
    }
  }
  return output;
}
async function setAcf(n,kind,id,values){
  const route=`/wp-json/wp/v2/${kind}/${id}`;
  const direct=await api('POST',route,n,{acf:values});
  if(direct.r.ok()){
    const check=await api('GET',`${route}?context=edit&_fields=id,acf`,n);
    if(check.r.ok()&&Object.entries(values).every(([k,v])=>val(check.body?.acf?.[k])===v))return;
  }
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:45000});
  for(const [key,value] of Object.entries(values)){
    const field=page.locator(`.acf-field[data-name="${key}"]`).first();
    assert(await field.count()===1,`Missing ${kind} ACF field ${key}`);
    const select=field.locator('select').first();
    if(await select.count())await select.selectOption(value);
    else{
      const input=field.locator('input[type="text"],input:not([type]),textarea').first();
      assert(await input.count(),`Unsupported ${kind} ACF field ${key}`);
      await input.fill(value);
    }
  }
  await page.locator('#publish').first().click();
  const verify=await api('GET',`${route}?context=edit&_fields=id,acf`,n);
  assert(verify.r.ok()&&Object.entries(values).every(([k,v])=>val(verify.body?.acf?.[k])===v),`ACF readback failed ${kind} ${id}`);
  writes++;
}
const draftedDuplicates=[];
const recruitmentIdentity=row=>{
  const title=plain(row.title?.raw??row.title?.rendered??row.title);
  const when=String(row.date||row.date_gmt||'').slice(0,19);
  return `${title}\u0001${when}`;
};
async function migrateRecruitment(n,posts,categoryId){
  const sourceIdentitySet=new Set(posts.map(recruitmentIdentity));
  assert(sourceIdentitySet.size===posts.length,'Source recruitment has identical title and publish timestamp; inspect before deduplication');
  let created=0,existing=0;
  for(const row of posts){
    const slug=String(row.slug||'').trim();
    assert(slug,'Legacy recruitment Post without slug');
    // WordPress may reserve a slug or append -2/-3. Query the new recruitment
    // category and match the original publish identity; NEVER create by slug alone.
    const candidates=await api('GET',
      `/wp-json/wp/v2/posts?context=edit&status=any&categories=${categoryId}&per_page=100&_fields=id,slug,status,title,content,categories,acf,date,date_gmt`,n);
    assert(candidates.r.ok()&&Array.isArray(candidates.body),`Cannot identify target recruitment Posts ${slug}`);
    const identity=recruitmentIdentity(row);
    const matches=candidates.body.filter(candidate=>recruitmentIdentity(candidate)===identity)
      .sort((a,b)=>Number(a.id)-Number(b.id));
    let target=matches[0];
    if(matches.length>1){
      const snapshot=matches.map(x=>({id:Number(x.id),slug:String(x.slug),status:x.status,
        title:plain(x.title?.raw??x.title?.rendered),date_gmt:x.date_gmt,
        categories:(x.categories||[]).map(Number),acf:{action:val(x.acf?.action),key:val(x.acf?.key)}}));
      await writeFile(`${artifact}/duplicates-${slug}.json`,JSON.stringify({sourceSlug:slug,identity,snapshot},null,2));
      // These records are from this task's newly created category, with the
      // same title and timestamp. Draft duplicates reversibly, never delete.
      const canonicalText=plain(target.content?.raw??target.content?.rendered);
      for(const duplicate of matches.slice(1)){
        assert(plain(duplicate.content?.raw??duplicate.content?.rendered)===canonicalText,
          `Duplicate body differs from canonical Post ${target.id}: ${duplicate.id}; review manually`);
        assert(Array.isArray(duplicate.categories)&&duplicate.categories.map(Number).includes(Number(categoryId)),
          `Duplicate Post is outside the task category: ${duplicate.id}`);
        if(duplicate.status==='draft')continue;
        assert(duplicate.status==='publish',`Refuse to alter unexpected duplicate status ${duplicate.id}: ${duplicate.status}`);
        const changed=await api('POST',`/wp-json/wp/v2/posts/${duplicate.id}`,n,{status:'draft'});
        assert(changed.r.ok()&&changed.body?.status==='draft',`Cannot safely draft duplicate ${duplicate.id}`);
        const audit={sourceSlug:slug,canonicalId:Number(target.id),draftedId:Number(duplicate.id)};
        draftedDuplicates.push(audit);writes++;
        log('DUPLICATE_DRAFTED',audit);
      }
    }
    if(!target){
      const html=await localizeHtml(row.content?.rendered,n,slug);
      const excerpt=await localizeHtml(row.excerpt?.rendered,n,slug);
      let featured=0;
      if(row.featured_media){
        try{
          const media=(await sourceGet(`/wp-json/wp/v2/media/${row.featured_media}?_fields=id,source_url`)).body;
          if(media?.source_url)featured=(await mediaFor(media.source_url,n,slug)).id;
        }catch(error){log('FEATURED_MEDIA_DEFERRED',{slug,id:row.featured_media,reason:String(error?.message||error)});}
      }
      const createdPost=await api('POST','/wp-json/wp/v2/posts',n,{
        title:plain(row.title?.rendered),slug,status:'publish',content:html,excerpt,
        date:row.date,date_gmt:row.date_gmt,featured_media:featured,categories:[categoryId],
      },90000);
      assert(createdPost.r.ok()&&createdPost.body?.id,`Could not create recruitment Post ${slug}: HTTP ${createdPost.r.status()}`);
      target=createdPost.body;created++;writes++;
    }else{
      // Existing editorial content is preserved; only required ACF/classification may change.
      if(!Array.isArray(target.categories)||!target.categories.map(Number).includes(Number(categoryId))){
        const fixed=await api('POST',`/wp-json/wp/v2/posts/${target.id}`,n,{categories:[...new Set([...(target.categories||[]),categoryId])]},60000);
        assert(fixed.r.ok(),`Cannot classify existing recruitment Post ${slug}`);writes++;
      }
      existing++;
    }
    const expected={product_lang:'vi',action:'PostDetails',key:'ssr-post'};
    if(!Object.entries(expected).every(([key,value])=>val(target.acf?.[key])===value))await setAcf(n,'posts',target.id,expected);
    const check=await api('GET',`/wp-json/wp/v2/posts/${target.id}?context=edit&_fields=id,slug,status,categories,acf`,n);
    assert(check.r.ok()&&check.body.status==='publish'&&check.body.categories.includes(categoryId),`Recruitment post publish/category mismatch ${slug}`);
    assert(Object.entries(expected).every(([key,value])=>val(check.body.acf?.[key])===value),`Recruitment ACF mismatch ${slug}`);
  }
  await writeFile(`${artifact}/duplicates-drafted.json`,JSON.stringify(draftedDuplicates,null,2));
  log('POSTS',{created,existing,source:posts.length,duplicatesDrafted:draftedDuplicates.length});
}

const tables=[
  {id:'contact_01_vi',title:'Liên hệ',description:'Kết nối với PTSC Production Services để được tư vấn và hỗ trợ.',fields:['type','label','content'],labels:['Loại','Nhãn','Giá trị'],rows:[
    ['address','Địa chỉ','Tầng 16, Khách sạn Dầu khí, số 9-11 Hoàng Diệu, Phường Vũng Tàu, Thành phố Hồ Chí Minh.'],
    ['phone','Điện thoại','+84.254.3511.018'],
    ['fax','Fax','+84.254.3511.019'],
    ['email','Email','info@ptscps.com.vn'],
    ['website','Website','www.ptscps.com.vn'],
  ]},
  {id:'contact_00_vi',title:'Gửi yêu cầu liên hệ',description:'Vui lòng để lại thông tin, chúng tôi sẽ liên hệ với bạn trong thời gian sớm nhất.',fields:['key','label','required'],labels:['Trường','Nhãn','Bắt buộc'],rows:[
    ['hoten','Họ và tên','1'],['sodienthoai','Số điện thoại','0'],['email','Email','1'],['chude','Tiêu đề','0'],['noidung','Nội dung','1'],['cta','Gửi tin','0'],
  ]},
];
async function readTable(id){
  const r=await page.request.get(uri(`/wp-json/tablepress/v1/table/${id}`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  if(r.status()===404)return null;
  assert(r.ok(),`Contact ESC Table REST failed ${id}: ${r.status()}`);
  return r.json();
}
async function ensureTable(def){
  let current=await readTable(def.id);
  if(current?.items?.length){
    assert(def.fields.every((key,i)=>current.fields?.[i]?.key===key),`Conflicting existing Contact ESC Table schema ${def.id}`);
    log('TABLE',{id:def.id,state:'PRESERVE_EXISTING',items:current.items.length});return;
  }
  if(!current){
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'),{waitUntil:'domcontentloaded',timeout:45000});
    await page.locator('input[name="table[name]"]').fill(def.title);
    await page.locator('textarea[name="table[description]"]').fill(def.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill(String(def.fields.length));
    await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:45000});
    let confirmed=false;
    page.once('dialog',async d=>{confirmed=true;await d.accept()});
    await page.locator('#table-id').fill(def.id);
    await page.locator('#table-name').click();
    for(let i=0;i<12&&!confirmed;i++)await sleep(100);
    assert(confirmed,`TablePress rename confirmation missing ${def.id}`);
    await page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i}).last().click();
    for(let i=0;i<12;i++){await sleep(700);current=await readTable(def.id).catch(()=>null);if(current)break;}
    assert(current,`TablePress ID rename failed ${def.id}`);
  }
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${def.id}`),{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append),null,{timeout:30000});
  await page.evaluate(({def})=>{
    const e=window.tp.editor;
    if(e.options.columns.length!==def.fields.length)throw Error('Contact ESC Table column count conflict');
    if(e.options.data.length<def.rows.length+2)window.tp.callbacks.append('rows',def.rows.length+2-e.options.data.length);
    if(e.options.data.length!==def.rows.length+2)throw Error('Contact ESC Table row count conflict');
    def.fields.forEach((key,i)=>{e.setValueFromCoords(i,0,key);e.setValueFromCoords(i,1,def.labels[i]);});
    def.rows.forEach((row,r)=>row.forEach((cell,c)=>e.setValueFromCoords(c,r+2,cell)));
    window.tp.helpers.unsaved_changes.set();
  },{def});
  await page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i}).last().click();
  for(let i=0;i<12;i++){await sleep(700);current=await readTable(def.id).catch(()=>null);if(current?.items?.length===def.rows.length)break;}
  assert(current?.items?.length===def.rows.length,`Contact ESC Table readback failed ${def.id}`);
  writes++;log('TABLE',{id:def.id,state:'CREATED',items:def.rows.length});
}
async function ensureContactPage(n){
  const path='/wp-json/wp/v2/pages?context=edit&status=any&slug=lien-he&per_page=20&_fields=id,slug,status,title,content,acf';
  const found=await api('GET',path,n);
  assert(found.r.ok()&&found.body.length<=1,'Contact Page lookup failed/ambiguous');
  let target=found.body[0];
  const desired=['contact_01_vi','contact_00_vi'];
  if(target){
    const html=String(target.content?.raw||target.content?.rendered||'');
    assert(!html.trim()||desired.every(id=>html.includes(id)),`Existing Contact Page has unrelated/incomplete content; preserve Page ${target.id}`);
  }else{
    const created=await api('POST','/wp-json/wp/v2/pages',n,{title:'Liên hệ',slug:'lien-he',status:'draft'});
    assert(created.r.ok()&&created.body?.id,'Cannot create Contact Page draft');
    target=created.body;writes++;
  }
  await page.goto(uri(`/wp-admin/post.php?post=${target.id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:45000});
  const field=async(key,value)=>{
    const el=page.locator(`.acf-field[data-name="${key}"]`).first();
    assert(await el.count(),`Missing Contact Page ACF ${key}`);
    const select=el.locator('select').first();
    if(await select.count())await select.selectOption(value);
    else await el.locator('input[type="text"]').first().fill(value);
  };
  await field('key','contact');await field('action','HomePage');await field('product_lang','vi');
  const currentContent=async()=>page.evaluate(()=>String(window.tinymce?.get('content')?.getContent?.()||'')+'\n'+String(document.querySelector('#content')?.value||''));
  const visual=page.locator('#content-tmce');
  if(await visual.count())await visual.click();
  await page.waitForFunction(()=>Boolean(window.tinymce?.get('content')?.initialized && !window.tinymce?.get('content')?.isHidden()),null,{timeout:20000});
  for(const id of desired){
    if((await currentContent()).includes(id))continue;
    await page.evaluate(()=>{
      const ed=window.tinymce?.get('content');if(!ed||ed.isHidden())throw Error('Classic Editor not ready');
      ed.focus();ed.selection.select(ed.getBody(),true);ed.selection.collapse(false);
    });
    const picker=page.locator('button[aria-label*="ESC Table"],button[title*="ESC Table"]').first();
    if(await picker.count()&&await picker.isVisible())await picker.click();
    else await page.evaluate(()=>{if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('ESC Table native Insert Code picker unavailable');window.tablepress_open_shortcode_thickbox()});
    const row=page.frameLocator('#TB_iframeContent').locator(`input.insert-shortcode[title*="${id}"]`);
    await row.waitFor({state:'visible',timeout:22000});
    await row.click();
    let inserted=false;
    for(let i=0;i<8;i++){await sleep(450);if((await currentContent()).includes(id)){inserted=true;break;}}
    assert(inserted,`Native Insert Code failed for ${id}`);
  }
  const button=page.locator('#publish').first();
  assert(await button.count(),'Contact Page publish control missing');
  // ACF/Classic Editor publication can navigate asynchronously. Do not
  // misclassify an in-flight save as a persisted WordPress Page failure.
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),
    button.click(),
  ]);
  const route=`/wp-json/wp/v2/pages/${target.id}?context=edit&_fields=id,slug,status,acf,content`;
  let verify;
  for(let attempt=1;attempt<=8;attempt++){
    verify=await api('GET',route,n);
    assert(verify.r.ok(),`Contact Page readback unavailable HTTP ${verify.r.status()}`);
    const html=String(verify.body?.content?.raw||verify.body?.content?.rendered||'');
    if(verify.body?.status==='publish'&&verify.body.slug==='lien-he'&&desired.every(id=>html.includes(id)))break;
    if(attempt<8)await sleep(850);
  }
  const savedHtml=String(verify.body?.content?.raw||verify.body?.content?.rendered||'');
  log('CONTACT_PAGE_READBACK',{
    id:target.id,slug:verify.body?.slug,status:verify.body?.status,
    tables:desired.map(id=>({id,saved:savedHtml.includes(id)})),
    key:val(verify.body?.acf?.key),action:val(verify.body?.acf?.action),
  });
  // Only adjust the publication status when the native Insert Code operation
  // has already persisted both shortcode blocks under the exact public slug.
  if(verify.body?.status!=='publish'&&verify.body?.slug==='lien-he'
    &&desired.every(id=>savedHtml.includes(id))){
    const published=await api('POST',`/wp-json/wp/v2/pages/${target.id}`,n,{status:'publish'});
    assert(published.r.ok(),`WordPress rejected Contact Page publication HTTP ${published.r.status()}`);
    verify=await api('GET',route,n);
    assert(verify.r.ok(),'Contact Page publication readback unavailable');
    log('CONTACT_PAGE_PUBLISH_RECOVERY',{status:verify.body?.status,slug:verify.body?.slug});
  }
  assert(verify.body?.status==='publish'&&verify.body.slug==='lien-he',
    `Contact Page not published: id=${target.id} status=${verify.body?.status} slug=${verify.body?.slug}`);
  for(const id of desired)assert(String(verify.body.content?.raw||verify.body.content?.rendered||'').includes(id),`Contact Page missing native ESC Table ${id}`);
  assert(val(verify.body.acf?.key)==='contact'&&val(verify.body.acf?.action)==='HomePage','Contact Page ACF mismatch');
  writes++;
  log('CONTACT_PAGE',{state:'PUBLISHED',id:target.id,tables:desired});
}
async function ensureMenu(n){
  const lookup=async()=>{
    const r=await page.request.get(uri(`/wp-json/esc-api/v1/menus?_fresh=${Date.now()}`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
    assert(r.ok(),'ESC header menu endpoint unavailable');
    const header=(await r.json())?.menus?.Header?.vi;
    assert(header?.id&&Array.isArray(header.items),'Missing Vietnamese Header WordPress menu');
    return header;
  };
  const header=await lookup();
  const all=await api('GET','/wp-json/wp/v2/menu-items?context=edit&per_page=100&_fields=id,title,menus,parent,url,status,menu_order',n);
  assert(all.r.ok(),'Cannot read native Header menu items');
  const titleOf=item=>plain(typeof item.title==='object'?(item.title.raw||item.title.rendered):item.title);
  const items=(all.body||[]).filter(x=>(Array.isArray(x.menus)?x.menus:[x.menus]).some(id=>Number(id)===Number(header.id)));
  const expected=[{title:'Tuyển dụng',url:'/tuyen-dung'},{title:'Liên hệ',url:'/lien-he'}];
  for(const def of expected){
    const matches=items.filter(x=>Number(x.parent||0)===0&&titleOf(x)===def.title);
    assert(matches.length<=1,`Duplicate Header menu ${def.title}`);
    if(matches.length){
      const row=matches[0];
      if(String(row.url||'')!==def.url){
        const changed=await api('POST',`/wp-json/wp/v2/menu-items/${row.id}`,n,{title:def.title,type:'custom',url:def.url,menus:Number(header.id),status:'publish',parent:0});
        assert(changed.r.ok(),`Cannot fix Header ${def.title} URL`);writes++;
      }
    }else{
      const created=await api('POST','/wp-json/wp/v2/menu-items',n,{title:def.title,type:'custom',url:def.url,menus:Number(header.id),status:'publish',parent:0});
      assert(created.r.ok()&&created.body?.id,`Cannot create Header ${def.title}`);
      items.push(created.body);writes++;
    }
  }
  const tops=items.filter(x=>Number(x.parent||0)===0).sort((a,b)=>Number(a.menu_order||0)-Number(b.menu_order||0)||Number(a.id)-Number(b.id));
  const ordered=tops.filter(x=>!expected.some(y=>titleOf(x)===y.title));
  const after=ordered.findIndex(x=>titleOf(x)==='Tin tức');
  assert(after>=0,'Cannot place Recruitment and Contact after Tin tức: parent missing');
  const inserts=expected.map(x=>tops.find(y=>titleOf(y)===x.title));
  ordered.splice(after+1,0,...inserts);
  for(const [i,item] of ordered.entries()){
    if(Number(item.menu_order||0)===(i+1)*10)continue;
    const changed=await api('POST',`/wp-json/wp/v2/menu-items/${item.id}`,n,{menu_order:(i+1)*10});
    assert(changed.r.ok(),`Cannot reorder Header item ${titleOf(item)}`);writes++;
  }
  for(let attempt=0;attempt<8;attempt++){
    await sleep(400);
    const current=await lookup();const list=current.items||[];
    const a=list.findIndex(x=>x.label==='Tin tức');
    if(a>=0&&list[a+1]?.label==='Tuyển dụng'&&list[a+2]?.label==='Liên hệ'
      &&['/tuyen-dung','/lien-he'].every((url,i)=>String(list[a+i+1].href||'').replace(/\/$/,'')===url)){
      log('MENU',{state:'PASS',top:list.map(x=>x.label)});return;
    }
  }
  const diagnostic=await lookup();
  log('MENU_READBACK_FAILED',{menuId:diagnostic.id,
    items:(diagnostic.items||[]).map(x=>({label:x.label,href:x.href,slug:x.slug,
      childrenCount:Array.isArray(x.children)?x.children.length:0}))});
  throw Error('Header native menu readback order or links mismatch');
}
async function readiness(){
  const deadlines=Date.now()+120000;
  for(let attempt=1;Date.now()<deadlines;attempt++){
    const outcomes=[];
    for(const path of ['/tuyen-dung','/lien-he']){
      try{const r=await ctx.request.get(`${front}${path}?_publish=${Date.now()}`,{timeout:15000});outcomes.push({path,http:r.status(),ok:r.status()===200});}
      catch(error){outcomes.push({path,error:String(error?.message||error),ok:false});}
    }
    if(outcomes.every(x=>x.ok)){log('DEPLOY_READY',{attempt,outcomes});return;}
    log('DEPLOY_WAIT',{attempt,outcomes,remainingMs:deadlines-Date.now()});
    await sleep(Math.min(12000,Math.max(0,deadlines-Date.now())));
  }
  throw Error('DEPLOY_TIMEOUT: new routes did not become ready within 120 seconds');
}
async function QA(){
  for(const width of [1440,390]){
    const context=await browser.newContext({viewport:{width,height:900}});
    const p=await context.newPage();
    try{
      let r=await p.goto(`${front}/tuyen-dung?_qa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
      assert(r?.status()===200,`QA_FAILED recruitment HTTP ${r?.status()}`);
      assert(await p.locator('h1').first().innerText()==='Thông tin tuyển dụng','QA_FAILED recruitment H1');
      assert(await p.locator('[data-recruitment-listing] article').count()>0,'QA_FAILED empty recruitment list after source migration');
      r=await p.goto(`${front}/lien-he?_qa=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
      assert(r?.status()===200,`QA_FAILED Contact HTTP ${r?.status()}`);
      assert(await p.locator('[data-contact-info] h1').count()===1,'QA_FAILED Contact heading');
      assert(await p.locator('#contact-form').count()===1,'QA_FAILED Contact Form 7 frontend component missing');
      assert(await p.locator('#contact-form [name="email"]').count()===1,'QA_FAILED Contact email field');
      const allLinks=await p.locator('header a').evaluateAll(els=>els.map(x=>({text:x.textContent?.trim(),href:x.getAttribute('href'),target:x.getAttribute('target')})));
      for(const [label,href] of [['Tuyển dụng','/tuyen-dung'],['Liên hệ','/lien-he']]){
        const match=allLinks.find(x=>x.text===label&&x.href===href);
        assert(match&&!match.target,`QA_FAILED Header menu ${label} not same-tab link`);
      }
      const overflow=await p.evaluate(()=>document.documentElement.scrollWidth);
      assert(overflow<=width+2,`QA_FAILED horizontal overflow ${width} actual=${overflow}`);
      const name=width===1440?'desktop':'mobile';
      await p.screenshot({path:`${artifact}/${name}-contact.png`,fullPage:true});
      await p.goto(`${front}/tuyen-dung?_qa_visual=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:45000});
      await p.screenshot({path:`${artifact}/${name}-recruitment.png`,fullPage:true});
      log('QA_PASS',{width,recruitment:true,contact:true,header:true,overflow});
    }finally{await context.close();}
  }
}
async function buildThroughWordPress(){
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:50000});
  const main=page.locator('#vcs-build-btn-main');
  const force=page.locator('#vcs-force-build');
  assert(await main.count()===1&&await force.count()===1,'Native Build Website controls missing');
  const state=()=>page.evaluate(()=>({configured:globalThis.vcsBuild?.build_configured,active:Boolean(globalThis.vcsBuild?.initial_active),pending:Number(globalThis.vcsBuild?.pending_count||document.querySelector('#vcs-pending-count')?.textContent||0)}));
  let status=await state();
  assert([true,1,'1'].includes(status.configured),'Native WordPress Build Website is not configured');
  if(status.active){
    log('BUILD_EXISTING','MONITOR');
    await waitForWordPressBuild({page,log,expectTriggered:false});
    await page.reload({waitUntil:'domcontentloaded',timeout:45000});
    status=await state();assert(!status.active,'Existing build still active');
  }
  // This specific release requires the newly committed Astro routes and CMS data.
  if(await main.isDisabled()){assert(!await force.isDisabled(),'Cannot trigger Build Website');await force.check();}
  const ack=page.waitForResponse(r=>r.url().startsWith(wp+'/wp-admin/admin-ajax.php')&&r.request().method()==='POST'&&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
  await main.click();
  const response=await ack;const body=await response.json().catch(()=>null);
  assert(response.ok()&&body?.success===true,'Native WordPress Build Website rejected request');
  log('BUILD_TRIGGERED','VIA_WORDPRESS');
  const result=await waitForWordPressBuild({page,log,expectTriggered:true});
  log('BUILD_SUCCESS',result);
}
try{
  const sourcePosts=await sourceRecruitment();
  await login();
  const n=await nonce();
  const id=await ensureCategory(n);
  await migrateRecruitment(n,sourcePosts,id);
  for(const table of tables)await ensureTable(table);
  await ensureContactPage(n);
  await ensureMenu(n);
  await writeFile(`${artifact}/assets-deferred.json`,JSON.stringify(deferred,null,2));
  log('CMS_READY',{posts:sourcePosts.length,tableCount:tables.length,writes,mediaDeferred:deferred.length});
  await buildThroughWordPress();
  await readiness();
  await QA();
  log('RESULT','PASS');
}finally{await browser.close();}
