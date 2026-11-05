import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';
import { waitForWordPressBuild } from './ptscps-wordpress-build-monitor.mjs';

const wp=String(process.env.WP_ORIGIN||'').replace(/\/$/,'');
const front=String(process.env.FRONT_ORIGIN||'').replace(/\/$/,'');
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
assert(wp.startsWith('https://')&&front.startsWith('https://')&&username&&password,'Missing News WordPress configuration');

const legacy='https://ptscps.com.vn';
const desiredMenu=[
  {title:'Hoạt động của công ty',url:'/c/tin-tuc/hoat-dong-cua-cong-ty'},
  {title:'Dầu khí trong nước và khu vực',url:'/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc'},
  {title:'Thư viện hình ảnh PPS',url:'/thu-vien-pps'},
  {title:'Thư mời chào giá',url:'/thu-moi-chao-gia'},
];
const targetCategories=['tin-tuc','hoat-dong-cua-cong-ty','dau-khi-trong-nuoc-va-khu-vuc','thu-moi-chao-gia'];
const artifactDir='artifacts/ptscps-news';
await mkdir(artifactDir,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=x=>String(x??'').replace(/\s+/g,' ').trim();
const log=(key,value)=>console.log(`NEWS_${key}=${typeof value==='string'?value:JSON.stringify(value)}`);
const uri=p=>wp+p;
let cmsWrites=0;
let sourceInventory=null;
let sourceRestInventory=null;
const inventoryOnly=process.env.NEWS_INVENTORY_ONLY==='1';

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();

async function inventorySource(){
  const source=await browser.newContext({viewport:{width:1440,height:1000}});
  const p=await source.newPage();
  try{
    const home=await p.goto(legacy+'/?_news_inventory='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(home?.status()===200,'Legacy homepage unavailable');
    const anchors=await p.locator('a').evaluateAll(nodes=>nodes.map((node,index)=>({
      index,
      text:String(node.textContent||'').replace(/\s+/g,' ').trim(),
      href:String(node.href||''),
    })));
    const menu=[];
    let lastIndex=-1;
    for(const item of desiredMenu){
      const match=anchors.find(row=>row.index>lastIndex&&row.text===item.title&&new URL(row.href).pathname.replace(/\/$/,'')===item.url.replace(/\/$/,''));
      assert(match,`Legacy News menu item missing or out of order: ${item.title}`);
      lastIndex=match.index;
      menu.push({title:item.title,url:item.url});
    }

    const readTitles=async(path,selector)=>{
      const response=await p.goto(legacy+path+'?_news_inventory='+Date.now(),{waitUntil:'load',timeout:50000});
      assert(response?.status()===200,`Legacy page unavailable ${path}`);
      const h1=clean(await p.locator('h1').first().textContent().catch(()=>''));
      const titles=(await p.locator(selector).allTextContents()).map(clean).filter(Boolean);
      return {h1,titles};
    };
    const company=await readTitles('/c/tin-tuc/hoat-dong-cua-cong-ty','h2 a');
    const regional=await readTitles('/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc','h2 a');
    const tender=await readTitles('/thu-moi-chao-gia','h3 a');
    const galleryResponse=await p.goto(legacy+'/thu-vien-pps?_news_inventory='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(galleryResponse?.status()===200,'Legacy PPS gallery unavailable');
    const galleryH1=clean(await p.locator('h1').first().textContent().catch(()=>''));
    assert(company.h1==='Hoạt động của công ty'&&company.titles.length>0,'Legacy company-news inventory incomplete');
    assert(regional.h1==='Dầu khí trong nước và khu vực'&&regional.titles.length>0,'Legacy regional-news inventory incomplete');
    assert(tender.h1==='Thư mời chào giá'&&tender.titles.length>0,'Legacy tender inventory incomplete');
    assert(galleryH1==='Thư viện PPS','Legacy gallery title changed');
    await p.screenshot({path:`${artifactDir}/source-news-home.png`,fullPage:false});
    log('SOURCE_INVENTORY_PASS',{menu,company:company.titles.slice(0,5),regional:regional.titles.slice(0,5),tender:tender.titles.slice(0,5),galleryH1});
    return {menu,company,regional,tender,galleryH1};
  }finally{await source.close();}
}

async function inventorySourceRest(){
  const request=context.request;
  const categoryResponse=await request.get(legacy+'/wp-json/wp/v2/categories?per_page=100&orderby=id&order=asc&_fields=id,slug,name,count,parent',{timeout:40000,headers:{'Cache-Control':'no-cache'}});
  assert(categoryResponse.ok(),'Legacy category REST unavailable');
  const allCategories=await categoryResponse.json();
  const wantedSlugs=['tin-tuc','hoat-dong-cua-cong-ty','dau-khi-trong-nuoc-va-khu-vuc','thu-moi-chao-gia'];
  const categories={};
  const posts={};
  for(const slug of wantedSlugs){
    const rows=allCategories.filter(row=>String(row.slug||'')===slug);
    assert(rows.length===1,`Legacy category ${slug} missing or ambiguous (${rows.length})`);
    const category=rows[0];
    categories[slug]={id:Number(category.id),slug,name:clean(category.name),count:Number(category.count||0),parent:Number(category.parent||0)};
    const collected=[];
    const totalPages=Math.max(1,Math.ceil(Number(category.count||0)/100));
    for(let pageNo=1;pageNo<=totalPages;pageNo++){
      const response=await request.get(legacy+`/wp-json/wp/v2/posts?status=publish&categories=${category.id}&per_page=100&page=${pageNo}&orderby=date&order=desc&_fields=id,slug,title,content,excerpt,date,date_gmt,modified,featured_media,categories,acf,yoast_head_json`,{timeout:50000,headers:{'Cache-Control':'no-cache'}});
      assert(response.ok(),`Legacy posts REST failed ${slug} page ${pageNo}: HTTP ${response.status()}`);
      const batch=await response.json();
      assert(Array.isArray(batch),`Legacy posts response invalid for ${slug}`);
      collected.push(...batch);
    }
    posts[slug]=collected.map(row=>({
      id:Number(row.id),
      slug:String(row.slug||''),
      title:clean(row.title?.rendered),
      date:String(row.date||''),
      dateGmt:String(row.date_gmt||''),
      modified:String(row.modified||''),
      featuredMedia:Number(row.featured_media||0),
      categories:Array.isArray(row.categories)?row.categories.map(Number):[],
      productLang:String(row.acf?.product_lang?.value||row.acf?.product_lang||'').trim(),
      contentLength:String(row.content?.rendered||'').length,
      excerptLength:String(row.excerpt?.rendered||'').length,
    }));
    assert(posts[slug].length===Number(category.count||0),`Legacy post count mismatch for ${slug}: REST=${posts[slug].length} category=${category.count}`);
  }
  const galleryResponse=await request.get(legacy+'/wp-json/wp/v2/pages?slug=thu-vien-pps&status=publish&per_page=20&_fields=id,slug,title,content,date,modified,featured_media,acf,yoast_head_json',{timeout:40000,headers:{'Cache-Control':'no-cache'}});
  assert(galleryResponse.ok(),'Legacy PPS gallery Page REST unavailable');
  const galleryPages=await galleryResponse.json();
  assert(galleryPages.length===1,`Legacy PPS gallery Page missing or ambiguous (${galleryPages.length})`);
  const gallery=galleryPages[0];
  const galleryHtml=String(gallery.content?.rendered||'');
  const galleryImages=[...galleryHtml.matchAll(/<img\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].map(match=>match[1]);
  const languageValues=[...new Set(Object.values(posts).flat().map(row=>row.productLang||'(missing)'))].sort();
  log('SOURCE_REST_INVENTORY_PASS',{
    categories,
    counts:Object.fromEntries(Object.entries(posts).map(([slug,rows])=>[slug,rows.length])),
    uniquePostCount:new Set(Object.values(posts).flat().map(row=>row.id)).size,
    languageValues,
    samples:Object.fromEntries(Object.entries(posts).map(([slug,rows])=>[slug,rows.slice(0,5)])),
    gallery:{
      id:Number(gallery.id),
      slug:String(gallery.slug||''),
      title:clean(gallery.title?.rendered),
      productLang:String(gallery.acf?.product_lang?.value||gallery.acf?.product_lang||'').trim(),
      action:String(gallery.acf?.action||''),
      key:String(gallery.acf?.key||''),
      featuredMedia:Number(gallery.featured_media||0),
      contentLength:galleryHtml.length,
      imageCount:galleryImages.length,
      imageSamples:galleryImages.slice(0,8),
    },
  });
  const galleryLang=String(gallery.acf?.product_lang?.value||gallery.acf?.product_lang||'').trim();
  if(languageValues.includes('(missing)')||!galleryLang){
    log('SOURCE_LANGUAGE_BLOCKER',{
      posts:languageValues,
      galleryProductLang:galleryLang||'(missing)',
    });
  }
  return {categories,posts,gallery,galleryImages};
}

async function login(){
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  assert(new URL(page.url()).origin===wp,'WordPress admin origin mismatch');
  log('AUTH','PASS');
}
async function nonce(){
  for(const candidate of ['/wp-admin/nav-menus.php?esc_full_admin=1','/wp-admin/post.php?post=82642&action=edit&esc_full_admin=1']){
    await page.goto(uri(candidate),{waitUntil:'domcontentloaded',timeout:45000});
    const n=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce||'').trim());
    if(/^[A-Za-z0-9_-]{8,32}$/.test(n)){log('REST_NONCE_SOURCE',candidate.split('?')[0]);return n;}
  }
  throw Error('WordPress REST nonce unavailable');
}
async function api(method,path,n,data){
  const response=await page.request.fetch(uri(path),{method,timeout:40000,headers:{'X-WP-Nonce':n,'Cache-Control':'no-cache'},...(data===undefined?{}:{data})});
  const body=await response.json().catch(()=>null);
  return {response,body};
}
const titleOf=item=>clean(typeof item?.title==='object'?(item.title.raw||item.title.rendered):item?.title);

async function inventoryTargetData(){
  const allCategoriesResponse=await page.request.get(uri('/wp-json/wp/v2/categories?per_page=100&orderby=id&order=asc&_fields=id,slug,name,count,parent'),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(allCategoriesResponse.ok(),'Cannot query target category registry');
  const allCategories=await allCategoriesResponse.json();
  const galleryDiagnostic=await page.request.get(uri('/wp-json/wp/v2/pages?slug=thu-vien-pps&status=publish&per_page=20&_fields=id,slug,title,status,content'),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(galleryDiagnostic.ok(),'Cannot query target PPS gallery diagnostic');
  const galleryPages=await galleryDiagnostic.json();
  const postSamples=[];
  for(const [kind,titles] of Object.entries({company:sourceInventory.company.titles,regional:sourceInventory.regional.titles,tender:sourceInventory.tender.titles})){
    for(const title of titles.slice(0,3)){
      const found=await page.request.get(uri(`/wp-json/wp/v2/posts?status=publish&search=${encodeURIComponent(title)}&per_page=20&_fields=id,slug,title,categories,date`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
      assert(found.ok(),`Cannot search target posts for ${kind}`);
      const rows=await found.json();
      postSamples.push({kind,expected:title,matches:rows.map(row=>({id:row.id,slug:row.slug,title:clean(row.title?.rendered),categories:row.categories||[]}))});
    }
  }
  log('TARGET_DIAGNOSTIC',{categories:allCategories.map(row=>({id:row.id,slug:row.slug,name:clean(row.name),count:Number(row.count||0),parent:Number(row.parent||0)})),galleryPages:galleryPages.map(row=>({id:row.id,slug:row.slug,title:clean(row.title?.rendered),contentLength:String(row.content?.rendered||'').length})),postSamples});
  const categories={};
  for(const slug of targetCategories){
    const response=await page.request.get(uri(`/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,name,count`),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
    assert(response.ok(),`Cannot query target category ${slug}`);
    const rows=await response.json();
    assert(rows.length===1,`Target category ${slug} missing or ambiguous (${rows.length})`);
    categories[slug]={id:rows[0].id,name:clean(rows[0].name),count:Number(rows[0].count||0)};
  }
  assert(categories['hoat-dong-cua-cong-ty'].count>0,'Target company-news category is empty');
  assert(categories['dau-khi-trong-nuoc-va-khu-vuc'].count>0,'Target regional-news category is empty');
  assert(categories['thu-moi-chao-gia'].count>0,'Target tender category is empty');
  const gallery=await page.request.get(uri('/wp-json/wp/v2/pages?slug=thu-vien-pps&status=publish&per_page=20&_fields=id,slug,title,status'),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(gallery.ok(),'Cannot query target PPS gallery Page');
  const pages=await gallery.json();
  assert(pages.length===1,'Target PPS gallery Page missing or ambiguous');
  log('TARGET_DATA_INVENTORY_PASS',{categories,galleryPage:{id:pages[0].id,title:clean(pages[0].title?.rendered)}});
  return {categories,galleryPage:pages[0]};
}

async function ensureMenu(n){
  const response=await page.request.get(uri('/wp-json/esc-api/v1/menus?_news_menu='+Date.now()),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert(response.ok(),'ESC Header menu endpoint unavailable');
  const header=(await response.json())?.menus?.Header?.vi;
  assert(header?.id&&Array.isArray(header.items),'Header.vi missing');
  const top=(header.items||[]).filter(x=>String(x.label||'')==='Tin tức');
  assert(top.length<=1,'Duplicated Tin tức top menu');
  const labels=(header.items||[]).map(x=>String(x.label||''));
  const stockAt=labels.indexOf('Cổ đông');
  const newsAt=labels.indexOf('Tin tức');
  const careerAt=labels.indexOf('Tuyển dụng');
  const exact=top.length===1&&stockAt>=0&&newsAt===stockAt+1&&(careerAt<0||careerAt===newsAt+1)
    &&top[0].children?.length===desiredMenu.length
    &&desiredMenu.every((item,index)=>top[0].children?.[index]?.label===item.title
      &&String(top[0].children?.[index]?.href||'').replace(/^\/+|\/+$/g,'')===item.url.replace(/^\/+|\/+$/g,''));
  if(exact){log('MENU','SKIP_EXISTING');return;}

  const all=await api('GET',`/wp-json/wp/v2/menu-items?context=edit&per_page=100&_fields=id,title,menus,parent,url,status,menu_order`,n);
  assert(all.response.ok(),'Cannot read current WordPress menu items');
  const items=(all.body||[]).filter(x=>(Array.isArray(x.menus)?x.menus:[x.menus]).some(id=>Number(id)===Number(header.id)));
  const parents=items.filter(x=>titleOf(x)==='Tin tức'&&Number(x.parent||0)===0);
  assert(parents.length<=1,'Ambiguous Tin tức parent');
  let parentId=parents[0]?.id;
  if(!parentId){
    const created=await api('POST','/wp-json/wp/v2/menu-items',n,{title:'Tin tức',type:'custom',url:'/tin-tuc',menus:Number(header.id),status:'publish',parent:0});
    assert(created.response.ok(),`Tin tức parent creation failed HTTP ${created.response.status()}`);
    parentId=created.body.id;items.push(created.body);cmsWrites++;
  }else if(String(parents[0].url||'')!=='/tin-tuc'){
    const update=await api('POST',`/wp-json/wp/v2/menu-items/${parentId}`,n,{title:'Tin tức',type:'custom',url:'/tin-tuc',menus:Number(header.id),status:'publish',parent:0});
    assert(update.response.ok(),'Cannot update Tin tức parent URL');cmsWrites++;
  }

  const topItems=items.filter(x=>Number(x.parent||0)===0).sort((a,b)=>Number(a.menu_order||0)-Number(b.menu_order||0)||Number(a.id)-Number(b.id));
  const stock=topItems.find(x=>titleOf(x)==='Cổ đông');
  const news=topItems.find(x=>Number(x.id)===Number(parentId));
  assert(stock&&news,'Cannot position Tin tức after Cổ đông');
  const ordered=topItems.filter(x=>Number(x.id)!==Number(parentId));
  ordered.splice(ordered.findIndex(x=>Number(x.id)===Number(stock.id))+1,0,news);
  for(const [index,item] of ordered.entries()){
    const menuOrder=(index+1)*10;
    if(Number(item.menu_order||0)===menuOrder)continue;
    const update=await api('POST',`/wp-json/wp/v2/menu-items/${item.id}`,n,{menu_order:menuOrder});
    assert(update.response.ok(),`Cannot update top-level menu order for ${titleOf(item)}`);cmsWrites++;
  }

  for(const [index,expected] of desiredMenu.entries()){
    const matches=items.filter(x=>Number(x.parent||0)===Number(parentId)&&titleOf(x)===expected.title);
    assert(matches.length<=1,`Duplicate Tin tức submenu ${expected.title}`);
    const menuOrder=401+index;
    const data={title:expected.title,type:'custom',url:expected.url,menus:Number(header.id),status:'publish',parent:Number(parentId),menu_order:menuOrder};
    if(matches.length){
      if(String(matches[0].url||'')===expected.url&&Number(matches[0].menu_order||0)===menuOrder)continue;
      const update=await api('POST',`/wp-json/wp/v2/menu-items/${matches[0].id}`,n,data);
      assert(update.response.ok(),`Cannot update Tin tức menu ${expected.title}`);cmsWrites++;
    }else{
      const created=await api('POST','/wp-json/wp/v2/menu-items',n,data);
      assert(created.response.ok(),`Cannot create Tin tức menu ${expected.title}`);cmsWrites++;
    }
  }

  for(let attempt=0;attempt<8;attempt++){
    await sleep(500);
    const verify=await page.request.get(uri('/wp-json/esc-api/v1/menus?_news_verify='+Date.now()),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
    assert(verify.ok(),'Cannot verify Tin tức Header menu');
    const menuItems=(await verify.json())?.menus?.Header?.vi?.items||[];
    const current=menuItems.find(x=>String(x.label||'')==='Tin tức');
    const children=current?.children||[];
    const currentLabels=menuItems.map(x=>String(x.label||''));
    const a=currentLabels.indexOf('Cổ đông'),b=currentLabels.indexOf('Tin tức'),c=currentLabels.indexOf('Tuyển dụng');
    if(a>=0&&b===a+1&&(c<0||c===b+1)&&children.length===desiredMenu.length&&desiredMenu.every((item,index)=>children[index]?.label===item.title&&String(children[index]?.href||'').replace(/^\/+|\/+$/g,'')===item.url.replace(/^\/+|\/+$/g,''))){
      log('MENU',{status:'PASS',topLevel:currentLabels,children:desiredMenu.map(x=>x.title)});return;
    }
  }
  throw Error('Tin tức menu readback mismatch');
}

async function publishedProbe(){
  const probe=await context.newPage();
  try{
    for(const path of ['/tin-tuc','/c/tin-tuc/hoat-dong-cua-cong-ty','/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc','/thu-vien-pps','/thu-moi-chao-gia']){
      const response=await probe.goto(front+path+'?_news_publish='+Date.now(),{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>null);
      if(response?.status()!==200)return false;
    }
    const response=await probe.goto(front+'/tin-tuc?_news_menu='+Date.now(),{waitUntil:'domcontentloaded',timeout:40000}).catch(()=>null);
    if(response?.status()!==200)return false;
    const toggle=probe.locator('#header-navrow button').filter({hasText:'Tin tức'}).first();
    if(await toggle.count()!==1)return false;
    const panelId=await toggle.getAttribute('aria-controls');if(!panelId)return false;
    const links=probe.locator(`#${panelId} a`);
    if(await links.count()!==desiredMenu.length)return false;
    const labels=(await links.allTextContents()).map(clean);
    return JSON.stringify(labels)===JSON.stringify(desiredMenu.map(x=>x.title));
  }finally{await probe.close();}
}

async function buildThroughWordPress(){
  if(!cmsWrites&&await publishedProbe()){log('BUILD','ALREADY_PUBLISHED_SKIP_TRIGGER');return;}
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:50000});
  const button=page.locator('#vcs-build-btn-main');const force=page.locator('#vcs-force-build');
  assert(await button.count()===1&&await force.count()===1,'WordPress Build Website controls missing');
  const readState=()=>page.evaluate(()=>({configured:globalThis.vcsBuild?.build_configured,active:Boolean(globalThis.vcsBuild?.initial_active),pending:Number(globalThis.vcsBuild?.pending_count||document.querySelector('#vcs-pending-count')?.textContent||0)}));
  let state=await readState();assert([true,1,'1'].includes(state.configured),'WordPress Build Website not configured');log('BUILD_STATE',state);
  if(state.active){
    log('BUILD','EXISTING_BUILD_MONITOR');
    const existing=await waitForWordPressBuild({page,log,expectTriggered:false});log('BUILD_EXISTING_RESULT',existing);
    await page.reload({waitUntil:'domcontentloaded',timeout:50000});
    if(!cmsWrites&&await publishedProbe()){log('BUILD','EXISTING_BUILD_COMPLETED_AND_PUBLISHED');return;}
    state=await readState();assert(!state.active,'WordPress still reports active build after monitor');
  }
  if(await button.isDisabled()){assert(!await force.isDisabled(),'Build disabled and force unavailable');await force.check();}
  const acknowledge=page.waitForResponse(r=>r.url().startsWith(wp+'/wp-admin/admin-ajax.php')&&r.request().method()==='POST'&&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
  await button.click();const response=await acknowledge;const body=await response.json().catch(()=>null);
  assert(response.ok()&&body?.success===true,'Native WordPress Build Website rejected trigger');
  log('BUILD','TRIGGERED_VIA_WORDPRESS');
  const result=await waitForWordPressBuild({page,log,expectTriggered:true});log('BUILD_RESULT',result);
}

async function qa(){
  for(let i=0;i<52;i++){
    if(await publishedProbe()){log('FRONT_READY','PASS');break;}
    assert(i<51,'News frontend did not publish after WordPress build');await sleep(15000);
  }
  const specs=[
    {path:'/c/tin-tuc/hoat-dong-cua-cong-ty',title:'Hoạt động của công ty',source:sourceInventory.company.titles},
    {path:'/c/tin-tuc/dau-khi-trong-nuoc-va-khu-vuc',title:'Dầu khí trong nước và khu vực',source:sourceInventory.regional.titles},
    {path:'/thu-moi-chao-gia',title:'Thư mời chào giá',source:sourceInventory.tender.titles},
  ];
  for(const viewport of [{name:'desktop',width:1440,height:900},{name:'mobile',width:390,height:844}]){
    const view=await browser.newContext({viewport:{width:viewport.width,height:viewport.height}});const p=await view.newPage();
    for(const spec of specs){
      const response=await p.goto(front+spec.path+'?_news_qa='+Date.now(),{waitUntil:'load',timeout:50000});
      assert(response?.status()===200,`${spec.title} ${viewport.name} HTTP failure`);
      assert(clean(await p.locator('h1').first().textContent())===spec.title,`${spec.title} H1 mismatch ${viewport.name}`);
      const targetTitles=(await p.locator('#posts-grid h2').allTextContents()).map(clean).filter(Boolean);
      const expected=spec.source.slice(0,Math.min(3,spec.source.length));
      assert.deepEqual(targetTitles.slice(0,expected.length),expected,`${spec.title} first-post parity mismatch ${viewport.name}`);
      assert(await p.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth+2),`${spec.title} horizontal overflow ${viewport.name}`);
    }
    const gallery=await p.goto(front+'/thu-vien-pps?_news_qa='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(gallery?.status()===200,`Thư viện PPS ${viewport.name} HTTP failure`);
    assert((await p.locator('body').innerText()).includes('Thư viện PPS'),`Thư viện PPS title missing ${viewport.name}`);
    const allNews=await p.goto(front+'/tin-tuc?_news_qa='+Date.now(),{waitUntil:'load',timeout:50000});
    assert(allNews?.status()===200,`Tin tức ${viewport.name} HTTP failure`);
    assert(clean(await p.locator('h1').first().textContent())==='Tin tức',`Tin tức H1 mismatch ${viewport.name}`);
    await p.screenshot({path:`${artifactDir}/${viewport.name}-news.png`,fullPage:true});
    if(viewport.name==='desktop'){
      const toggle=p.locator('#header-navrow button').filter({hasText:'Tin tức'}).first();assert(await toggle.isVisible(),'Desktop Tin tức menu button missing');
      await toggle.click();const panelId=await toggle.getAttribute('aria-controls');assert(panelId,'Desktop Tin tức menu panel id missing');
      const links=p.locator(`#${panelId} a`);assert.equal(await links.count(),desiredMenu.length,'Desktop Tin tức submenu count mismatch');
      assert.deepEqual((await links.allTextContents()).map(clean),desiredMenu.map(x=>x.title),'Desktop Tin tức submenu order mismatch');
      for(let i=0;i<desiredMenu.length;i++){assert.equal(await links.nth(i).getAttribute('href'),desiredMenu[i].url,`Desktop Tin tức href mismatch ${desiredMenu[i].title}`);assert.notEqual(await links.nth(i).getAttribute('target'),'_blank');}
      await p.screenshot({path:`${artifactDir}/desktop-news-menu.png`,fullPage:false});
      log('NAV_PARITY_PASS',{children:desiredMenu.map(x=>x.title)});
    }
    await view.close();
  }
  log('DATA_PARITY_PASS',{company:Math.min(3,sourceInventory.company.titles.length),regional:Math.min(3,sourceInventory.regional.titles.length),tender:Math.min(3,sourceInventory.tender.titles.length),gallery:'route-title'});
  log('VISUAL_PARITY_PASS',{viewports:['desktop','mobile']});
}

try{
  sourceInventory=await inventorySource();
  sourceRestInventory=await inventorySourceRest();
  if(inventoryOnly){
    log('RESULT','INVENTORY_ONLY_PASS');
  }else{
    await login();
    await inventoryTargetData();
    const n=await nonce();
    await ensureMenu(n);
    log('CMS',{status:'PASS',writes:cmsWrites});
    await buildThroughWordPress();
    await qa();
    log('RESULT','PASS');
  }
}finally{
  await browser.close();
}
