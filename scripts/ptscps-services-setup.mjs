import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && front && user && pass, 'Missing configured PTSCPS origins or WordPress admin credentials');

const services = [
  { key:'fpso', title:'Vận hành và bảo dưỡng FPSO/FSO/MOPU', slug:'van-hanh-va-bao-duong-fpso-fso-mopu', file:'ptscps-dich-vu-fpso.jpg' },
  { key:'design', title:'Dịch vụ thiết kế, mua sắm, gia công, chế tạo', slug:'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao', file:'ptscps-dich-vu-thiet-ke.jpg' },
  { key:'manpower', title:'Cung ứng nhân lực kỹ thuật vận hành và bảo dưỡng', slug:'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong', file:'ptscps-dich-vu-nhan-luc.jpg' },
  { key:'repair', title:'Dịch vụ sửa chữa bảo dưỡng các thiết bị và công trình công nghiệp', slug:'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep', file:'ptscps-dich-vu-sua-chua.jpg' },
];
const artifactDir='artifacts/ptscps-services';
await mkdir(artifactDir,{recursive:true});
const sleep = ms => new Promise(r=>setTimeout(r,ms));
const uri = p => wp + p;
const clean = v => String(v ?? '').replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();
const escHref = url => {
  const value=String(url||'').trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return value;
  if (value==='/' || value==='') return value;
  return value.replace(/^\/+|\/+$/g,'');
};
const report=(k,v)=>console.log(`SERVICES_${k}=${typeof v==='string'?v:JSON.stringify(v)}`);

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();

async function login(){
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  assert(new URL(page.url()).origin===wp,'WordPress login escaped configured origin');
  report('ADMIN_AUTH','PASS');
}

async function restNonce(){
  const candidates=['/wp-admin/nav-menus.php?esc_full_admin=1','/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1'];
  for(const p of candidates){
    await page.goto(uri(p),{waitUntil:'domcontentloaded',timeout:50000});
    const nonce=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce||'').trim());
    if(/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  const res=await page.request.post(uri('/wp-admin/admin-ajax.php'),{form:{action:'rest-nonce'},timeout:30000});
  if(res.ok()){
    const nonce=(await res.text()).trim();
    if(/^[A-Za-z0-9_-]{8,32}$/.test(nonce)) return nonce;
  }
  throw Error('WordPress REST nonce unavailable');
}

async function jsonRequest(method,path,nonce,data){
  const opts={headers:{'X-WP-Nonce':nonce,'Cache-Control':'no-cache'},timeout:35000};
  if(data!==undefined) opts.data=data;
  const res=await page.request.fetch(uri(path),{...opts,method});
  const body=await res.json().catch(()=>({}));
  return {res,body};
}

async function listCats(nonce){
  const {res,body}=await jsonRequest('GET','/wp-json/wp/v2/product_cat?context=edit&hide_empty=false&per_page=100&_fields=id,name,slug,parent',nonce);
  assert(res.ok(),`Product category list HTTP ${res.status()}`);
  return body;
}

async function ensureCat(nonce,spec,parent){
  let rows=await listCats(nonce);
  const matches=rows.filter(x=>x.slug===spec.slug);
  assert(matches.length<=1,`Duplicate product category slug ${spec.slug}`);
  if(matches.length){
    const row=matches[0];
    assert(clean(row.name)===spec.title && Number(row.parent||0)===Number(parent||0),`Existing category conflicts ${spec.slug}`);
    report('CATEGORY',{slug:spec.slug,id:row.id,state:'ALREADY_PRESENT_SKIP_WRITE'});
    return row;
  }
  for(let attempt=1;attempt<=3;attempt++){
    try{
      const {res,body}=await jsonRequest('POST','/wp-json/wp/v2/product_cat',nonce,{name:spec.title,slug:spec.slug,parent:Number(parent||0)});
      if(res.ok() && Number(body?.id)>0){report('CATEGORY',{slug:spec.slug,id:body.id,state:'CREATED'});return body;}
      report('CATEGORY_CREATE_RETRY',{slug:spec.slug,attempt,http:res.status(),code:body?.code||''});
    }catch(error){report('CATEGORY_CREATE_RETRY',{slug:spec.slug,attempt,transport:error?.message||'error'});}
    await sleep(900*attempt);
    rows=await listCats(nonce);
    const exact=rows.filter(x=>x.slug===spec.slug && clean(x.name)===spec.title && Number(x.parent||0)===Number(parent||0));
    if(exact.length===1){report('CATEGORY_CREATE_READBACK_RECOVERED',{slug:spec.slug,id:exact[0].id});return exact[0];}
  }
  throw Error(`Cannot create product category ${spec.slug}`);
}

async function legacyImages(){
  // Locked to the exact card media observed by the successful read-only
  // legacy inventory. The old page reuses the FPSO image for manpower, so
  // neither DOM adjacency nor image uniqueness is a valid invariant here.
  const inventoryPaths={
    fpso:'/wp-content/uploads/2019/10/dichvufpso.jpg',
    design:'/wp-content/uploads/2019/10/dichvucungungktcao-1.jpg',
    manpower:'/wp-content/uploads/2019/10/dichvufpso.jpg',
    repair:'/wp-content/uploads/2019/10/giacong1.jpg',
  };
  const found={};
  for(const spec of services){
    const pathname=inventoryPaths[spec.key];
    assert(pathname?.startsWith('/wp-content/uploads/'),`Legacy inventory media missing ${spec.key}`);
    const sourceUrl=new URL(pathname,'https://ptscps.com.vn').toString();
    const response=await fetch(sourceUrl,{headers:{'User-Agent':'PTSCPS migration QA'}});
    assert(response.ok,`Legacy service image HTTP ${response.status} ${spec.key}`);
    const contentType=String(response.headers.get('content-type')||'').toLowerCase();
    assert(contentType.startsWith('image/'),`Legacy service media is not an image ${spec.key}: ${contentType}`);
    const bytes=Buffer.from(await response.arrayBuffer());
    assert(bytes.length>5000,`Legacy service image unexpectedly small ${spec.key}`);
    found[spec.key]=sourceUrl;
  }
  report('LEGACY_MEDIA',Object.fromEntries(Object.entries(found).map(([k,v])=>[k,new URL(v).pathname])));
  return found;
}

async function findMedia(nonce,file){
  const slug=file.replace(/\.[^.]+$/,'');
  const {res,body}=await jsonRequest('GET',`/wp-json/wp/v2/media?context=edit&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,source_url,alt_text,title`,nonce);
  assert(res.ok(),`Media lookup HTTP ${res.status()}`);
  assert(body.length<=1,`Duplicate controlled media slug ${slug}`);
  return body[0]||null;
}

async function ensureMedia(nonce,spec,sourceUrl){
  let existing=await findMedia(nonce,spec.file);
  if(existing){report('MEDIA',{key:spec.key,id:existing.id,state:'ALREADY_PRESENT_SKIP_WRITE'});return existing;}
  const source=await fetch(sourceUrl,{headers:{'User-Agent':'PTSCPS migration QA'}});
  assert(source.ok,`Legacy image download HTTP ${source.status} ${spec.key}`);
  const bytes=Buffer.from(await source.arrayBuffer());
  assert(bytes.length>5000,`Legacy image unexpectedly small ${spec.key}`);
  const contentType=source.headers.get('content-type')?.split(';')[0]||'image/jpeg';
  let created=null;
  for(let attempt=1;attempt<=3&&!created;attempt++){
    try{
      const upload=await page.request.post(uri('/wp-json/wp/v2/media'),{
        headers:{'X-WP-Nonce':nonce,'Content-Type':contentType,'Content-Disposition':`attachment; filename="${spec.file}"`},
        data:bytes,timeout:60000,
      });
      const body=await upload.json().catch(()=>({}));
      if(upload.ok()&&Number(body?.id)>0){created=body;break;}
      report('MEDIA_UPLOAD_RETRY',{key:spec.key,attempt,http:upload.status()});
    }catch(error){
      report('MEDIA_UPLOAD_RETRY',{key:spec.key,attempt,transport:error?.message||'error'});
    }
    for(let readAttempt=1;readAttempt<=4&&!created;readAttempt++){
      await sleep(700*readAttempt);
      const recovered=await findMedia(nonce,spec.file).catch(()=>null);
      if(recovered){
        created=recovered;
        report('MEDIA_UPLOAD_READBACK_RECOVERED',{key:spec.key,id:recovered.id,attempt,readAttempt});
      }
    }
  }
  assert(created&&Number(created.id)>0,`Media upload failed ${spec.key} after retries`);
  let metadataUpdated=false;
  for(let attempt=1;attempt<=3&&!metadataUpdated;attempt++){
    try{
      const update=await jsonRequest('POST',`/wp-json/wp/v2/media/${created.id}`,nonce,{alt_text:spec.title,title:spec.title,caption:''});
      if(update.res.ok()){metadataUpdated=true;break;}
      report('MEDIA_META_RETRY',{key:spec.key,attempt,http:update.res.status()});
    }catch(error){
      report('MEDIA_META_RETRY',{key:spec.key,attempt,transport:error?.message||'error'});
    }
    await sleep(700*attempt);
  }
  assert(metadataUpdated,`Media metadata update failed ${spec.key}`);
  existing=await findMedia(nonce,spec.file);
  assert(existing&&Number(existing.id)===Number(created.id),`Media readback failed ${spec.key}`);
  report('MEDIA',{key:spec.key,id:existing.id,state:'CREATED'});
  return existing;
}

async function categoryFeed(){
  const res=await page.request.get(uri(`/wp-json/astro/v1/get-product-categories?_services=${Date.now()}`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(res.ok(),`Product category feed HTTP ${res.status()}`);
  return await res.json();
}

async function setThumbnail(termId,mediaId,spec){
  const feed=await categoryFeed();
  const current=feed.find(x=>Number(x.id)===Number(termId));
  if(current?.image?.url && current.image.url.includes(spec.file.replace(/\.[^.]+$/,''))){report('THUMBNAIL',{slug:spec.slug,state:'ALREADY_PRESENT_SKIP_WRITE'});return;}
  await page.goto(uri(`/wp-admin/term.php?taxonomy=product_cat&tag_ID=${termId}&post_type=product&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:50000});
  const input=page.locator('#product_cat_thumbnail_id');
  assert(await input.count()===1,`WooCommerce thumbnail field missing ${spec.slug}`);
  await input.evaluate((el,id)=>{el.value=String(id);el.dispatchEvent(new Event('change',{bubbles:true}));},mediaId);
  const form=page.locator('form#edittag').first();
  assert(await form.count()===1,`Native term edit form missing ${spec.slug}`);
  await Promise.all([
    page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),
    form.evaluate(el=>{if(!(el instanceof HTMLFormElement))throw Error('Invalid term edit form');el.requestSubmit();}),
  ]);
  for(let i=0;i<8;i++){
    await sleep(500);
    const rows=await categoryFeed();
    const item=rows.find(x=>Number(x.id)===Number(termId));
    if(item?.image?.url){
      assert(String(item.image.url).startsWith('/wp-content/uploads/'),`Category image is not relative local media ${spec.slug}: ${item.image.url}`);
      assert(!String(item.image.url).includes('admin-ptscps'),`Admin origin leaked in category image ${spec.slug}`);
      report('THUMBNAIL',{slug:spec.slug,state:'PASS',url:item.image.url});return;
    }
  }
  throw Error(`Category thumbnail readback failed ${spec.slug}`);
}

async function ensureCategoryOrder(rootId,rows){
  const expected=services.map(x=>x.slug);
  const readOrder=async()=>{
    const feed=await categoryFeed();
    return feed.filter(x=>Number(x.parent||0)===Number(rootId)).map(x=>x.slug);
  };
  if(JSON.stringify(await readOrder())===JSON.stringify(expected)){report('CATEGORY_ORDER','ALREADY_CORRECT_SKIP_WRITE');return;}
  await page.goto(uri('/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1'),{waitUntil:'domcontentloaded',timeout:50000});
  const security=await page.evaluate(()=>String(globalThis.woocommerce_term_ordering_params?.nonce||'').trim());
  assert(security,'WooCommerce term ordering nonce missing');
  const bySlug=Object.fromEntries(rows.map(x=>[x.slug,x]));
  const reverse=[...services].reverse();
  for(let i=0;i<reverse.length;i++){
    const current=reverse[i];
    const next=i===0?null:reverse[i-1];
    const res=await page.request.post(uri('/wp-admin/admin-ajax.php'),{form:{action:'woocommerce_term_ordering',security,id:String(bySlug[current.slug].id),nextid:next?String(bySlug[next.slug].id):'',thetaxonomy:'product_cat'},timeout:30000});
    assert(res.ok(),`WooCommerce term ordering HTTP ${res.status()} ${current.slug}`);
  }
  for(let attempt=0;attempt<8;attempt++){
    await sleep(600);
    const actual=await readOrder();
    if(JSON.stringify(actual)===JSON.stringify(expected)){report('CATEGORY_ORDER',{status:'PASS',slugs:actual});return;}
  }
  throw Error(`Product category order mismatch actual=${JSON.stringify(await readOrder())}`);
}

async function setAcf(name,value){
  const row=page.locator(`[data-name="${name}"]`).first();
  assert(await row.count()===1,`ACF field missing ${name}`);
  const select=row.locator('select').first();
  if(await select.count()){await select.selectOption(String(value));return;}
  const input=row.locator('input[type="text"],input:not([type])').first();
  assert(await input.count(),`ACF input missing ${name}`);
  await input.fill(String(value));
}

async function ensurePage(){
  const nonce=await restNonce();
  const {res,body}=await jsonRequest('GET','/wp-json/wp/v2/pages?context=edit&status=publish,draft,pending,private&slug=dich-vu&per_page=20&_fields=id,slug,status,title,acf',nonce);
  assert(res.ok(),`Service Page lookup HTTP ${res.status()}`);
  assert(body.length<=1,'Duplicate WordPress Page slug dich-vu');
  let id=Number(body[0]?.id||0);
  if(id){
    await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:50000});
  }else{
    await page.goto(uri('/wp-admin/post-new.php?post_type=page&esc_full_admin=1'),{waitUntil:'domcontentloaded',timeout:50000});
  }
  await page.locator('#title').fill('Dịch vụ');
  await setAcf('key','ssr-products');
  await setAcf('action','ProductsSSRPage');
  await setAcf('product_lang','vi');
  if(!id){
    const save=page.locator('#save-post');
    await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:45000}),save.click()]);
    id=Number(await page.locator('#post_ID').inputValue());
  }
  assert(id>0,'Service Page ID missing');
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:50000});
  const currentSlug=await page.locator('#editable-post-name-full').textContent().catch(()=>null);
  if(clean(currentSlug)!=='dich-vu'){
    const edit=page.locator('#edit-slug-buttons .edit-slug');
    if(await edit.isVisible().catch(()=>false)){await edit.click();await page.locator('#new-post-slug').fill('dich-vu');await page.locator('#edit-slug-buttons .save').click();}
    else if(await page.locator('#post_name').count()) await page.locator('#post_name').fill('dich-vu');
  }
  const button=page.locator('#publish');
  assert(await button.count(),'Page publish/update button missing');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),button.click()]);
  for(let attempt=0;attempt<8;attempt++){
    const check=await page.request.get(uri(`/wp-json/wp/v2/pages/${id}?_fields=id,slug,status,title,acf`),{timeout:30000});
    if(check.ok()){
      const p=await check.json();
      const lang=p.acf?.product_lang?.value??p.acf?.product_lang;
      if(p.status==='publish'&&p.slug==='dich-vu'&&p.acf?.key==='ssr-products'&&p.acf?.action==='ProductsSSRPage'&&lang==='vi'){
        report('PAGE',{id,state:body.length?'UPDATED_VERIFIED':'CREATED_VERIFIED'});return id;
      }
    }
    await sleep(700);
  }
  throw Error('Service Page readback mismatch');
}

async function readMenus(){
  const res=await page.request.get(uri(`/wp-json/esc-api/v1/menus?_services_menu=${Date.now()}`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(res.ok(),`Menu API HTTP ${res.status()}`);
  const data=await res.json(); assert(data?.success===true,'Unexpected menu API contract'); return data.menus||{};
}

async function ensureMenu(nonce){
  const menus=await readMenus();
  const vi=menus?.Header?.vi;
  assert(Number(vi?.id)>0,'Header.vi missing');
  const menuId=Number(vi.id);
  const desired=[
    {title:'Tất cả',url:'/dich-vu'},
    ...services.map(x=>({title:x.title,url:`/dich-vu/${x.slug}`})),
  ];
  const root=vi.items?.find(x=>x.label==='Dịch vụ');
  if(root && (root.children||[]).length===desired.length && desired.every((x,i)=>root.children[i]?.label===x.title&&escHref(root.children[i]?.href)===escHref(x.url))){
    report('MENU','ALREADY_CORRECT_SKIP_WRITE');return false;
  }
  const headers={'X-WP-Nonce':nonce};
  const list=async()=>{
    const res=await page.request.get(uri('/wp-json/wp/v2/menu-items?context=edit&status=publish&per_page=100&_fields=id,title,url,status,menus,parent,menu_order,type,target'),{headers,timeout:30000});
    assert(res.ok(),`Native menu list HTTP ${res.status()}`);
    return (await res.json()).filter(x=>Number(x.menus)===menuId);
  };
  const titleOf=x=>clean(x?.title?.raw??x?.title?.rendered??x?.title);
  const urlMatch=(a,b)=>{const aa=new URL(String(a||''),wp),bb=new URL(String(b||''),wp);return aa.origin===bb.origin&&aa.pathname===bb.pathname&&aa.search===bb.search&&aa.hash===bb.hash;};
  async function ensureOne(expected,parentId,order){
    let items=await list();
    const exact=items.filter(x=>titleOf(x)===expected.title&&x.type==='custom'&&Number(x.parent||0)===Number(parentId||0)&&urlMatch(x.url,expected.url));
    if(exact.length===1)return Number(exact[0].id);
    assert(exact.length===0,`Duplicate exact menu item ${expected.title}`);
    const sameTitle=items.filter(x=>titleOf(x)===expected.title);
    assert(sameTitle.length===0,`Existing menu item differs ${expected.title}`);
    for(let attempt=1;attempt<=3;attempt++){
      try{
        const res=await page.request.post(uri('/wp-json/wp/v2/menu-items'),{headers,timeout:30000,data:{title:expected.title,type:'custom',url:expected.url,menus:menuId,status:'publish',parent:parentId,menu_order:order,target:''}});
        const b=await res.json().catch(()=>({})); if(res.ok()&&Number(b?.id)>0)return Number(b.id);
      }catch{}
      await sleep(1000*attempt); items=await list();
      const recover=items.filter(x=>titleOf(x)===expected.title&&Number(x.parent||0)===Number(parentId||0)&&urlMatch(x.url,expected.url));
      if(recover.length===1)return Number(recover[0].id);
    }
    throw Error(`Cannot create menu item ${expected.title}`);
  }
  const parentId=await ensureOne({title:'Dịch vụ',url:'#'},0,100);
  for(let i=0;i<desired.length;i++) await ensureOne(desired[i],parentId,101+i);
  for(let i=0;i<12;i++){
    await sleep(700); const after=(await readMenus())?.Header?.vi; const servicesRoot=after?.items?.find(x=>x.label==='Dịch vụ');
    if(servicesRoot&&(servicesRoot.children||[]).length===desired.length&&desired.every((x,j)=>servicesRoot.children[j]?.label===x.title&&escHref(servicesRoot.children[j]?.href)===escHref(x.url))){report('MENU',{status:'PASS',children:desired.map(x=>x.title)});return true;}
  }
  throw Error('Header.vi services subtree readback mismatch');
}

async function buildViaWordPress(){
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:50000});
  const button=page.locator('#vcs-build-btn-main');
  assert(await button.count()===1,'WordPress Build Website tool unavailable');
  let state=await page.evaluate(()=>({configured:globalThis.vcsBuild?.build_configured,active:globalThis.vcsBuild?.initial_active,pending:globalThis.vcsBuild?.pending_count,disabled:document.querySelector('#vcs-build-btn-main')?.disabled}));
  report('BUILD_STATE',state);
  assert(state.configured===true||state.configured==='1'||state.configured===1,'WordPress build not configured');
  if(state.active){report('BUILD','OTHER_BUILD_RUNNING_SKIP_DUPLICATE');return;}
  const force=page.locator('#vcs-force-build');
  if(await button.isDisabled()){assert(await force.count()&&!await force.isDisabled(),'Build disabled and force unavailable');await force.check();}
  const ackPromise=page.waitForResponse(r=>r.url().startsWith(wp+'/wp-admin/admin-ajax.php')&&r.request().method()==='POST'&&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
  await button.click(); const ack=await ackPromise; assert(ack.ok(),`Build trigger HTTP ${ack.status()}`); const body=await ack.json(); assert(body?.success,'WordPress build rejected'); report('BUILD','TRIGGERED_VIA_WORDPRESS');
}

async function isProductionReady(){
  const res=await context.request.get(`${front}/dich-vu?_services_ready=${Date.now()}`,{timeout:30000,headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
  if(res?.status()!==200)return false;
  const html=await res.text();
  return html.includes('data-services-category-grid')&&services.every(x=>html.includes(x.title))&&html.includes('Dịch vụ')&&html.includes('Tất cả');
}

async function qa(){
  const expected=services.map(x=>x.title);
  for(const viewport of [{name:'desktop',width:1440,height:1000},{name:'mobile',width:390,height:844}]){
    const ctx=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}}); const p=await ctx.newPage();
    const res=await p.goto(`${front}/dich-vu?_qa=${Date.now()}`,{waitUntil:'load',timeout:50000}); assert(res?.status()===200,`${viewport.name} /dich-vu HTTP ${res?.status()}`);
    const cards=p.locator('[data-services-category-grid] a'); assert(await cards.count()===4,`${viewport.name} service card count mismatch`);
    const names=await cards.locator('h2').allTextContents(); assert.deepEqual(names.map(clean),expected,`${viewport.name} category order mismatch`);
    const imgs=cards.locator('img');
    for(let i=0;i<4;i++){await imgs.nth(i).scrollIntoViewIfNeeded();await p.waitForFunction(i=>{const img=document.querySelectorAll('[data-services-category-grid] img')[i];return img&&img.complete&&img.naturalWidth>0;},i,{timeout:12000});}
    const srcs=await imgs.evaluateAll(nodes=>nodes.map(img=>img.getAttribute('src')||'')); assert(srcs.every(src=>src.startsWith('/wp-content/uploads/')),`${viewport.name} category images not relative uploads`);
    assert(!((await p.content()).includes('admin-ptscps.thegioihosting.io.vn')),`${viewport.name} admin origin leaked`);
    const overflow=await p.evaluate(()=>({w:document.documentElement.clientWidth,s:document.documentElement.scrollWidth})); assert(overflow.s<=overflow.w+2,`${viewport.name} horizontal overflow`);
    await p.screenshot({path:`${artifactDir}/${viewport.name}-dich-vu.png`,fullPage:true});
    report('QA_ROUTE',{viewport:viewport.name,status:'PASS'}); await ctx.close();
  }
  for(const spec of services){const res=await context.request.get(`${front}/dich-vu/${spec.slug}?_qa=${Date.now()}`,{timeout:30000,headers:{'Cache-Control':'no-cache'}});assert(res.status()===200,`Category route HTTP ${res.status()} ${spec.slug}`);const html=await res.text();assert(html.includes(spec.title),`Category route heading missing ${spec.slug}`);}
  const desktop=await browser.newContext({viewport:{width:1440,height:900}}); const p=await desktop.newPage(); await p.goto(`${front}/dich-vu?_menu=${Date.now()}`,{waitUntil:'load',timeout:50000});
  const serviceButton=p.locator('#header-navrow button').filter({hasText:'Dịch vụ'}).first(); assert(await serviceButton.isVisible(),'Desktop Dịch vụ menu button missing'); await serviceButton.click();
  for(const title of ['Tất cả',...expected]) assert(await p.locator('#header-navrow a').filter({hasText:title}).first().isVisible(),`Desktop service submenu missing ${title}`);
  report('MENU_DESKTOP_QA','PASS'); await desktop.close();
  report('PRODUCTION_QA',{status:'PASS',root:'/dich-vu',categories:4,desktop:'PASS',mobile:'PASS'});
}

try{
  await login(); const nonce=await restNonce();
  const legacy=await legacyImages();
  const root=await ensureCat(nonce,{title:'Dịch vụ',slug:'dich-vu'},0);
  const childRows=[];
  for(const spec of services){const cat=await ensureCat(nonce,spec,root.id);const media=await ensureMedia(nonce,spec,legacy[spec.key]);await setThumbnail(cat.id,media.id,spec);childRows.push(cat);}
  await ensureCategoryOrder(root.id,childRows);
  const feed=await categoryFeed();
  const rootFeed=feed.find(x=>x.slug==='dich-vu'&&Number(x.parent||0)===0); assert(rootFeed,'Root service category missing from Astro feed');
  const childFeed=feed.filter(x=>Number(x.parent||0)===Number(rootFeed.id)); assert.deepEqual(childFeed.map(x=>x.slug),services.map(x=>x.slug),'Final category feed order mismatch');
  await ensurePage(); const menuChanged=await ensureMenu(nonce);
  const readyBefore=await isProductionReady();
  if(readyBefore&&!menuChanged){report('BUILD','ALREADY_DEPLOYED_SKIP_TRIGGER');}else{await buildViaWordPress();for(let attempt=1;attempt<=52;attempt++){if(await isProductionReady()){report('PRODUCTION_READY',{attempt});break;}if(attempt===52)throw Error('Services production did not become ready after WordPress build');await sleep(15000);}}
  await qa(); report('RESULT','PASS');
} finally {await browser.close();}
