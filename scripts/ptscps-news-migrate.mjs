import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { extname, basename } from 'node:path';
import { chromium } from 'playwright';

const wp=String(process.env.WP_ORIGIN||'').replace(/\/$/,'');
const legacy='https://ptscps.com.vn';
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
const productLang=String(process.env.NEWS_PRODUCT_LANG||'').trim();
assert(wp.startsWith('https://')&&username&&password,'Missing News migration WordPress configuration');
assert(productLang==='vi','NEWS_PRODUCT_LANG must be the owner-approved value vi');

const categorySlugs=['tin-tuc','hoat-dong-cua-cong-ty','dau-khi-trong-nuoc-va-khu-vuc','thu-moi-chao-gia'];
const artifactDir='artifacts/ptscps-news-migrate';
await mkdir(artifactDir,{recursive:true});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const clean=x=>String(x??'').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
const decodeEntities=value=>String(value??'')
  .replace(/&#x([0-9a-f]+);/gi,(_,n)=>String.fromCodePoint(parseInt(n,16)))
  .replace(/&#(\d+);/g,(_,n)=>String.fromCodePoint(Number(n)))
  .replace(/&nbsp;/gi,' ')
  .replace(/&amp;/gi,'&')
  .replace(/&quot;/gi,'"')
  .replace(/&apos;|&#39;/gi,"'")
  .replace(/&lt;/gi,'<')
  .replace(/&gt;/gi,'>');
const log=(key,value)=>console.log(`NEWS_MIGRATE_${key}=${typeof value==='string'?value:JSON.stringify(value)}`);
const uri=p=>wp+p;
const sourceAssetRe=/(?:https?:)?\/\/ptscps\.com\.vn\/wp-content\/uploads\/[^\s"'()<>,]+|\/wp-content\/uploads\/[^\s"'()<>,]+/gi;
const sourceAssetInTextRe=/(?:https?:)?\/\/ptscps\.com\.vn\/wp-content\/uploads\/|\/wp-content\/uploads\//i;
const largeAssetThreshold=30*1024*1024;
const maxAssetBytes=256*1024*1024;
const targetCategoryBySourceId=new Map();
const assetCache=new Map();
const sourceAssetFallbacks=new Map();
const sourceAssetContexts=new Map();
const targetMediaLookupCache=new Map();
const currentPtscArticleCache=new Map();
const waybackAssetCache=new Map();
const currentPtscNewsAssetFolders=new Map([
  ['doan-thanh-nien-cong-ty-pps-huong-ung-ngay-moi-truong-the-gioi',['/Data/Sites/1/News/1490/']],
  ['hoi-thao-cong-ty-pps-nam-2019',['/Data/Sites/1/News/1084/']],
]);
const currentPtscArticlePathOverrides=new Map([
  ['cong-ty-pps-to-chuc-cac-hoat-dong-nhan-ngay-thuong-binh-liet-sy-27-7',[
    '/tin-tuc/tin-ptsc-1/doan-the-xa-hoi/cong-ty-pps-to-chuc-cac-hoat-dong-nhan-ngay-thuong-binh-liet-sy-277',
  ]],
]);
const legacyMediaAliasOrigin='https://www.ptsc.com.vn';
const verifiedRecovery8492={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/09/124-1024x767.jpg',
  url:'https://media.vietq.vn/files/kimlien/2019/09/15/PVN%20Le%20chao%20co%20gian%20HaiThach%20MocTinh.jpg',
  article:'https://vietq.vn/fitch-ratings-xep-hang-tap-doan-dau-khi-viet-nam-pvn-o-muc-trien-vong-tich-cuc-bb-d163534.html',
  note:'Exact syndicated 2019 article image: Le chao co tren gian mo dau khi Hai Thach - Moc Tinh',
};
const verifiedRecovery8661={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/10/2-3.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/media/1-hdsd/ch%E1%BB%89nh-h%C3%ACnh-tin-t%E1%BB%A9c/yh.jpg',
  article:'https://www.ptsc.com.vn/doan-thanh-nien-cong-ty-pps-to-chuc-chuong-trinh-sinh-hoat-doan-gioi-thieu-ve-cac-chu-de-lien-quan-den-cac-tau-fpsofso-va-cac-du-an-onshore',
  note:'Exact current PTSC article image at the legacy 2-3 position, before the separator-vessel caption',
};
const verifiedRecovery8662={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/10/3-3.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/media/1-hdsd/ch%E1%BB%89nh-h%C3%ACnh-tin-t%E1%BB%A9c/tg.jpg',
  article:'https://www.ptsc.com.vn/doan-thanh-nien-cong-ty-pps-to-chuc-chuong-trinh-sinh-hoat-doan-gioi-thieu-ve-cac-chu-de-lien-quan-den-cac-tau-fpsofso-va-cac-du-an-onshore',
  note:'Verified remaining current PTSC article image for legacy attachment 8662 after attachment 8661 maps to yh.jpg',
};
const verifiedRecovery8096={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-1-2.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/media/content/Moi-truong-1-1024x683.jpg',
  article:'https://www.ptsc.com.vn/doan-thanh-nien-cong-ty-pps-huong-ung--quotngay-moi-truong-the-gioi-quot',
  note:'Verified current PTSC image Moi truong 1 from the same 2019 article for legacy attachment 8096',
};
const verifiedRecovery8098={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-3-2.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/media/content/Moi-truong-3-1024x683.jpg',
  article:'https://www.ptsc.com.vn/doan-thanh-nien-cong-ty-pps-huong-ung--quotngay-moi-truong-the-gioi-quot',
  note:'Verified current PTSC image Moi truong 3 from the same 2019 article for legacy attachment 8098',
};
const verifiedRecovery8418={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/08/1-2.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/News/1084/1-2.jpg',
  article:'https://www.ptsc.com.vn/hoi-thao-cong-ty-pps-nam-2019',
  note:'Exact retained PTSC News asset for the 2019 PPS sports article and legacy attachment 8418',
};
const verifiedRecovery8420={
  canonicalSource:'https://ptscps.com.vn/wp-content/uploads/2019/08/3-1.jpg',
  url:'https://www.ptsc.com.vn/Data/Sites/1/media/89.jpg',
  article:'https://www.ptsc.com.vn/hoi-thao-cong-ty-pps-nam-2019',
  note:'Verified retained sports-article image with the unique legacy 3-1 aspect ratio (1024x622) for attachment 8420',
};
const verifiedExternalAssetRecoveries=new Map([
  ['https://ptscps.com.vn/wp-content/uploads/2019/09/124-1024x767.jpg',verifiedRecovery8492],
  ['https://ptscps.com.vn/wp-content/uploads/2019/09/124.jpg',verifiedRecovery8492],
  ['https://ptscps.com.vn/wp-content/uploads/2019/09/124-300x225.jpg',verifiedRecovery8492],
  ['https://ptscps.com.vn/wp-content/uploads/2019/09/124-768x575.jpg',verifiedRecovery8492],
  ['https://ptscps.com.vn/wp-content/uploads/2019/09/124-400x300.jpg',verifiedRecovery8492],
  ['https://ptscps.com.vn/wp-content/uploads/2019/10/2-3.jpg',verifiedRecovery8661],
  ['https://ptscps.com.vn/wp-content/uploads/2019/10/2-3-300x169.jpg',verifiedRecovery8661],
  ['https://ptscps.com.vn/wp-content/uploads/2019/10/2-3-768x433.jpg',verifiedRecovery8661],
  ['https://ptscps.com.vn/wp-content/uploads/2019/10/3-3.jpg',verifiedRecovery8662],
  ['https://ptscps.com.vn/wp-content/uploads/2019/10/3-3-1024x768.jpg',verifiedRecovery8662],
  ['https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-1-2.jpg',verifiedRecovery8096],
  ['https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-1-2-1024x681.jpg',verifiedRecovery8096],
  ['https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-3-2.jpg',verifiedRecovery8098],
  ['https://ptscps.com.vn/wp-content/uploads/2019/06/Anh-3-2-1024x684.jpg',verifiedRecovery8098],
  ['https://ptscps.com.vn/wp-content/uploads/2019/08/1-2.jpg',verifiedRecovery8418],
  ['https://ptscps.com.vn/wp-content/uploads/2019/08/1-2-1024x543.jpg',verifiedRecovery8418],
  ['https://ptscps.com.vn/wp-content/uploads/2019/08/3-1.jpg',verifiedRecovery8420],
  ['https://ptscps.com.vn/wp-content/uploads/2019/08/3-1-1024x622.jpg',verifiedRecovery8420],
]);
const mediaLookupConcurrency=6;
const created={categories:[],media:[],posts:[],pages:[]};
const updated={categories:[],posts:[],pages:[]};
let writes=0;

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1440,height:1000}});
const page=await context.newPage();

async function login(){
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await page.locator('#wp-submit').click();
  await page.waitForLoadState('domcontentloaded');
  if(new URL(page.url()).searchParams.get('action')==='confirm_admin_email'){
    const skip=page.locator('a.skip-confirmation-button').first();
    const confirm=page.locator('#correct-admin-email').first();
    if(await skip.count()) await skip.click();
    else if(await confirm.count()) await confirm.click();
    await page.waitForURL(/\/wp-admin\//,{timeout:50000});
  }else if(!/\/wp-admin\//.test(page.url())){
    await page.waitForURL(/\/wp-admin\//,{timeout:50000});
  }
  assert(new URL(page.url()).origin===wp,'WordPress admin origin mismatch');
  log('AUTH','PASS');
}

async function nonce(){
  let headerMenuId=0;
  try{
    const menuResponse=await page.request.get(uri('/wp-json/esc-api/v1/menus?_news_nonce='+Date.now()),{
      timeout:30000,headers:{'Cache-Control':'no-cache'},
    });
    if(menuResponse.ok()) headerMenuId=Number((await menuResponse.json())?.menus?.Header?.vi?.id||0);
  }catch{}

  const candidates=[
    ...(headerMenuId?[`/wp-admin/nav-menus.php?action=edit&menu=${headerMenuId}&esc_full_admin=1`]:[]),
    '/wp-admin/post.php?post=82642&action=edit&esc_full_admin=1',
    '/wp-admin/edit-tags.php?taxonomy=product_cat&post_type=product&esc_full_admin=1',
  ];
  for(const candidate of candidates){
    await page.goto(uri(candidate),{waitUntil:'domcontentloaded',timeout:50000});
    const value=await page.evaluate(()=>String(globalThis.wpApiSettings?.nonce||'').trim());
    if(/^[A-Za-z0-9_-]{8,32}$/.test(value)){
      log('REST_NONCE_SOURCE',candidate.split('?')[0]);
      return value;
    }
  }

  const ajax=await page.request.post(uri('/wp-admin/admin-ajax.php'),{
    form:{action:'rest-nonce'},timeout:30000,
  }).catch(()=>null);
  if(ajax?.ok()){
    const value=(await ajax.text()).trim();
    if(/^[A-Za-z0-9_-]{8,32}$/.test(value)){
      log('REST_NONCE_SOURCE','admin-ajax');
      return value;
    }
  }
  throw Error('WordPress REST nonce unavailable');
}

async function api(method,path,n,data,timeout=50000){
  const maxAttempts=method==='GET'?4:1;
  for(let attempt=1;attempt<=maxAttempts;attempt++){
    try{
      const response=await page.request.fetch(uri(path),{
        method,timeout,headers:{'X-WP-Nonce':n,'Cache-Control':'no-cache'},
        ...(data===undefined?{}:{data}),
      });
      if(method==='GET'&&[429,500,502,503,504].includes(response.status())&&attempt<maxAttempts){
        log('REST_RETRY',{method,path,attempt,http:response.status()});
        await sleep(750*attempt);
        continue;
      }
      const body=await response.json().catch(()=>null);
      return {response,body};
    }catch(error){
      if(attempt>=maxAttempts)throw error;
      log('REST_RETRY',{method,path,attempt,code:String(error?.code||error?.cause?.code||error?.name||'ERROR')});
      await sleep(750*attempt);
    }
  }
  throw Error(`REST request exhausted ${method} ${path}`);
}

async function readSource(){
  const request=context.request;
  const categoryResponse=await request.get(legacy+'/wp-json/wp/v2/categories?per_page=100&orderby=id&order=asc&_fields=id,slug,name,count,parent',{timeout:40000,headers:{'Cache-Control':'no-cache'}});
  assert(categoryResponse.ok(),'Legacy category REST unavailable');
  const all=await categoryResponse.json();
  const categories={};
  const postsById=new Map();
  for(const slug of categorySlugs){
    const matches=all.filter(row=>String(row.slug||'')===slug);
    assert(matches.length===1,`Legacy category ${slug} missing or ambiguous (${matches.length})`);
    const category=matches[0];
    categories[slug]={id:Number(category.id),slug,name:decodeEntities(clean(category.name)),count:Number(category.count||0),parent:Number(category.parent||0)};
    const totalPages=Math.max(1,Math.ceil(Number(category.count||0)/100));
    for(let pageNo=1;pageNo<=totalPages;pageNo++){
      const response=await request.get(legacy+`/wp-json/wp/v2/posts?status=publish&categories=${category.id}&per_page=100&page=${pageNo}&orderby=date&order=desc&_fields=id,slug,title,content,excerpt,date,date_gmt,modified,featured_media,categories`,{timeout:60000,headers:{'Cache-Control':'no-cache'}});
      assert(response.ok(),`Legacy posts REST failed ${slug} page ${pageNo}: HTTP ${response.status()}`);
      const batch=await response.json();
      for(const row of batch){
        postsById.set(Number(row.id),{
          id:Number(row.id),slug:String(row.slug||''),title:decodeEntities(row.title?.rendered||''),
          content:String(row.content?.rendered||''),excerpt:String(row.excerpt?.rendered||''),
          date:String(row.date||''),dateGmt:String(row.date_gmt||''),modified:String(row.modified||''),
          featuredMedia:Number(row.featured_media||0),categories:Array.isArray(row.categories)?row.categories.map(Number):[],
        });
      }
    }
  }
  assert(postsById.size===226,`Legacy unique News post count changed: ${postsById.size}`);
  for(const [slug,category] of Object.entries(categories)){
    const count=[...postsById.values()].filter(post=>post.categories.includes(category.id)).length;
    assert(count===category.count,`Legacy category count mismatch ${slug}: posts=${count} category=${category.count}`);
  }
  const galleryResponse=await request.get(legacy+'/wp-json/wp/v2/pages?slug=thu-vien-pps&status=publish&per_page=20&_fields=id,slug,title,content,date,date_gmt,modified,featured_media',{timeout:40000,headers:{'Cache-Control':'no-cache'}});
  assert(galleryResponse.ok(),'Legacy PPS gallery Page REST unavailable');
  const galleryRows=await galleryResponse.json();
  assert(galleryRows.length===1,'Legacy PPS gallery Page missing or ambiguous');
  const galleryRaw=galleryRows[0];
  const gallery={
    id:Number(galleryRaw.id),slug:String(galleryRaw.slug||''),title:decodeEntities(galleryRaw.title?.rendered||''),
    content:String(galleryRaw.content?.rendered||''),date:String(galleryRaw.date||''),dateGmt:String(galleryRaw.date_gmt||''),
    featuredMedia:Number(galleryRaw.featured_media||0),
  };
  const imageCount=[...gallery.content.matchAll(/<img\b[^>]*\bsrc=["'][^"']+["'][^>]*>/gi)].length;
  assert(gallery.id===2&&imageCount===8,`Legacy PPS gallery baseline changed id=${gallery.id} images=${imageCount}`);
  log('SOURCE_PASS',{categories:Object.fromEntries(Object.entries(categories).map(([k,v])=>[k,{id:v.id,count:v.count,parent:v.parent}])),uniquePosts:postsById.size,gallery:{id:gallery.id,imageCount}});
  return {categories,posts:[...postsById.values()],gallery};
}

async function sourceMediaByIds(ids,posts=[]){
  const result=new Map();
  for(let i=0;i<ids.length;i+=100){
    const chunk=ids.slice(i,i+100);
    if(!chunk.length)continue;
    const response=await context.request.get(legacy+`/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,slug,source_url,alt_text,title,caption,mime_type`,{timeout:50000,headers:{'Cache-Control':'no-cache'}});
    assert(response.ok(),`Legacy media batch HTTP ${response.status()}`);
    for(const row of await response.json()) result.set(Number(row.id),row);
  }
  for(const id of ids){
    if(result.has(id))continue;
    const direct=await context.request.get(legacy+`/wp-json/wp/v2/media/${id}?_fields=id,slug,source_url,alt_text,title,caption,mime_type`,{timeout:40000,headers:{'Cache-Control':'no-cache'}});
    if(direct.ok()){
      const row=await direct.json();
      if(Number(row?.id)===Number(id)){result.set(Number(id),row);log('FEATURED_MEDIA_RECOVERED',{id,state:'DIRECT_READ'});continue;}
    }
    const matchingPosts=posts.filter(post=>Number(post.featuredMedia)===Number(id));
    let recovered=null;
    for(const post of matchingPosts){
      const expectedClass=`wp-image-${id}`;
      const tags=String(post.content||'').match(/<img\b[^>]*>/gi)||[];
      for(const tag of tags){
        const className=tag.match(/\bclass=["']([^"']*)["']/i)?.[1]||'';
        if(!className.split(/\s+/).includes(expectedClass))continue;
        const src=tag.match(/\bsrc=["']([^"']+)["']/i)?.[1]||'';
        const sourceUrl=normalizeSourceAsset(src);
        if(!sourceUrl)continue;
        const alt=tag.match(/\balt=["']([^"']*)["']/i)?.[1]||'';
        recovered={id:Number(id),slug:`legacy-media-${id}`,source_url:sourceUrl,alt_text:decodeEntities(alt),title:post.title,caption:'',mime_type:''};
        break;
      }
      if(recovered)break;
    }
    if(recovered){result.set(Number(id),recovered);log('FEATURED_MEDIA_RECOVERED',{id,state:'CONTENT_WP_IMAGE',source_url:recovered.source_url});continue;}
    const refs=matchingPosts.map(post=>({id:post.id,slug:post.slug,title:post.title,contentAssets:extractAssets(post.content).slice(0,3)}));
    log('FEATURED_MEDIA_MISSING',{id,http:direct.status(),posts:refs});
  }
  for(const id of ids) assert(result.has(id),`Legacy featured media missing ${id}`);
  return result;
}

function addSourceFallbacks(original,candidates){
  const normalized=normalizeSourceAsset(original);if(!normalized)return;
  const expanded=[];
  for(const candidate of candidates||[]){
    const value=normalizeSourceAsset(candidate);if(!value||value===normalized)continue;
    expanded.push(value,legacyMediaAlias(value),...wordpressDerivativeFallbacks(value));
  }
  const existing=sourceAssetFallbacks.get(normalized)||[];
  sourceAssetFallbacks.set(normalized,[...new Set([...expanded.filter(Boolean),...existing])]);
}

function inlineImageAttachmentRefs(html){
  const refs=[];
  for(const tag of String(html||'').match(/<img\b[^>]*>/gi)||[]){
    const className=tag.match(/\bclass=["']([^"']*)["']/i)?.[1]||'';
    const classId=className.match(/(?:^|\s)wp-image-(\d+)(?:\s|$)/)?.[1]||'';
    const dataId=tag.match(/\bdata-attachment-id=["'](\d+)["']/i)?.[1]||'';
    const id=Number(dataId||classId||0);
    const urls=[...new Set((tag.match(sourceAssetRe)||[]).map(normalizeSourceAsset).filter(Boolean))];
    if(!urls.length)continue;
    refs.push({id,urls});
    if(id)for(const original of urls)addSourceFallbacks(original,urls.filter(value=>value!==original));
  }
  return refs;
}

function addSourceAssetContext(url,contextValue){
  const normalized=normalizeSourceAsset(url);if(!normalized)return;
  const existing=sourceAssetContexts.get(normalized)||[];
  const key=JSON.stringify(contextValue);
  if(!existing.some(value=>JSON.stringify(value)===key))sourceAssetContexts.set(normalized,[...existing,contextValue]);
}

async function registerInlineAttachmentFallbacks(source){
  const byId=new Map();
  const htmlBlocks=[
    ...source.posts.flatMap(post=>[
      {kind:'post-content',id:post.id,slug:post.slug,html:post.content},
      {kind:'post-excerpt',id:post.id,slug:post.slug,html:post.excerpt},
    ]),
    {kind:'gallery',id:source.gallery.id,slug:source.gallery.slug,html:source.gallery.content},
  ];
  for(const block of htmlBlocks){
    for(const ref of inlineImageAttachmentRefs(block.html)){
      for(const url of ref.urls)addSourceAssetContext(url,{kind:block.kind,id:block.id,slug:block.slug,attachmentId:ref.id||0});
      if(!ref.id)continue;
      if(!byId.has(ref.id))byId.set(ref.id,new Set());
      for(const url of ref.urls)byId.get(ref.id).add(url);
    }
  }
  const ids=[...byId.keys()];
  const found=new Map();
  for(let i=0;i<ids.length;i+=100){
    const chunk=ids.slice(i,i+100);
    const response=await context.request.get(legacy+`/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,source_url,media_details`,{timeout:50000,headers:{'Cache-Control':'no-cache'}});
    assert(response.ok(),`Legacy inline media batch HTTP ${response.status()}`);
    for(const row of await response.json())found.set(Number(row.id),row);
  }
  for(const [id,originals] of byId){
    const row=found.get(id);if(!row)continue;
    const mediaUrls=[row.source_url,...Object.values(row.media_details?.sizes||{}).map(item=>item?.source_url)]
      .map(normalizeSourceAsset).filter(Boolean);
    for(const original of originals)addSourceFallbacks(original,mediaUrls);
  }
  log('INLINE_MEDIA_FALLBACKS',{attachmentIds:ids.length,found:found.size,sources:sourceAssetFallbacks.size});
}

async function targetSnapshot(n){
  const categories=[];
  for(const slug of categorySlugs){
    const {response,body}=await api('GET',`/wp-json/wp/v2/categories?context=edit&hide_empty=false&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,name,count,parent`,n);
    assert(response.ok(),`Target category snapshot failed ${slug}`);
    categories.push(...(body||[]));
  }
  const {response:galleryResponse,body:gallery}=await api('GET','/wp-json/wp/v2/pages?context=edit&status=any&slug=thu-vien-pps&per_page=20&_fields=id,slug,status,title,acf',n);
  assert(galleryResponse.ok(),'Target gallery snapshot failed');
  const snapshot={capturedAt:new Date().toISOString(),categories,gallery:gallery||[],note:'Pre-write snapshot; migration is idempotent and never deletes existing records.'};
  await writeFile(`${artifactDir}/prewrite.json`,JSON.stringify(snapshot,null,2));
  log('PREWRITE_SNAPSHOT',{categories:categories.length,gallery:(gallery||[]).length});
}

async function ensureCategories(source,n){
  const ordered=Object.values(source.categories).sort((a,b)=>Number(a.parent>0)-Number(b.parent>0));
  for(const item of ordered){
    const {response,body}=await api('GET',`/wp-json/wp/v2/categories?context=edit&hide_empty=false&slug=${encodeURIComponent(item.slug)}&per_page=20&_fields=id,slug,name,count,parent`,n);
    assert(response.ok(),`Target category lookup failed ${item.slug}`);
    assert((body||[]).length<=1,`Target category duplicate ${item.slug}`);
    const parentTarget=item.parent?targetCategoryBySourceId.get(item.parent)||0:0;
    if(item.parent)assert(parentTarget,`Target parent mapping missing for ${item.slug}`);
    let category=body?.[0]||null;
    if(!category){
      const createdResponse=await api('POST','/wp-json/wp/v2/categories',n,{name:item.name,slug:item.slug,parent:Number(parentTarget)});
      assert(createdResponse.response.ok()&&createdResponse.body?.id,`Category create failed ${item.slug}: HTTP ${createdResponse.response.status()}`);
      category=createdResponse.body;created.categories.push(Number(category.id));writes++;
      log('CATEGORY',{slug:item.slug,id:category.id,state:'CREATED'});
    }else{
      const needs=clean(category.name)!==item.name||Number(category.parent||0)!==Number(parentTarget);
      if(needs){
        const updateResponse=await api('POST',`/wp-json/wp/v2/categories/${category.id}`,n,{name:item.name,parent:Number(parentTarget)});
        assert(updateResponse.response.ok(),`Category update failed ${item.slug}`);
        category=updateResponse.body;updated.categories.push(Number(category.id));writes++;
        log('CATEGORY',{slug:item.slug,id:category.id,state:'UPDATED'});
      }else log('CATEGORY',{slug:item.slug,id:category.id,state:'SKIP_EXISTING'});
    }
    targetCategoryBySourceId.set(Number(item.id),Number(category.id));
  }
}

function normalizeSourceAsset(value){
  let raw=String(value||'').trim();
  if(!raw)return null;
  if(raw.startsWith('//'))raw='https:'+raw;
  if(raw.startsWith('/wp-content/uploads/'))raw=legacy+raw;
  try{
    const u=new URL(raw);
    if(!/^https?:$/.test(u.protocol)||u.hostname!=='ptscps.com.vn'||!u.pathname.startsWith('/wp-content/uploads/'))return null;
    u.protocol='https:';u.hash='';
    return u.href;
  }catch{return null;}
}

function legacyMediaAlias(value){
  const normalized=normalizeSourceAsset(value);if(!normalized)return null;
  const u=new URL(normalized);
  return `${legacyMediaAliasOrigin}${u.pathname}${u.search}`;
}

function wordpressDerivativeFallbacks(value){
  const normalized=normalizeSourceAsset(value);if(!normalized)return [];
  const u=new URL(normalized);
  const originalPath=u.pathname
    .replace(/-\d+x\d+(?=\.[^./]+$)/,'')
    .replace(/-scaled(?=\.[^./]+$)/,'');
  if(originalPath===u.pathname)return [];
  u.pathname=originalPath;
  const original=u.href;
  return [original,legacyMediaAlias(original)].filter(Boolean);
}

function currentPtscNewsAssetFallbacks(value,siblingValues=[]){
  const normalized=normalizeSourceAsset(value);if(!normalized)return [];
  const contexts=sourceAssetContexts.get(normalized)||[];
  const slugs=[...new Set(contexts.map(item=>String(item?.slug||'').trim()).filter(Boolean))];
  const sourceCandidates=[...new Set([
    normalized,
    ...wordpressDerivativeFallbacks(normalized),
    ...siblingValues,
    ...siblingValues.flatMap(wordpressDerivativeFallbacks),
  ].map(normalizeSourceAsset).filter(Boolean))];
  const filenames=[...new Set(sourceCandidates.map(candidate=>{
    try{return decodeURIComponent(basename(new URL(candidate).pathname));}catch{return '';}
  }).filter(Boolean))];
  const fallbacks=[];
  for(const slug of slugs){
    for(const folder of currentPtscNewsAssetFolders.get(slug)||[]){
      for(const filename of filenames){
        fallbacks.push(new URL(`${folder}${encodeURIComponent(filename)}`,legacyMediaAliasOrigin).href);
      }
    }
  }
  return [...new Set(fallbacks)];
}

function assetStem(value){
  try{
    const u=new URL(value,legacyMediaAliasOrigin);
    const filename=decodeURIComponent(basename(u.pathname));
    const extension=extname(filename);
    return basename(filename,extension).replace(/-\d+x\d+$/,'').replace(/-scaled$/,'').toLowerCase();
  }catch{return '';}
}

async function currentPtscArticleFallbacks(value){
  const normalized=normalizeSourceAsset(value);if(!normalized)return [];
  const wantedStem=assetStem(normalized);if(!wantedStem)return [];
  const contexts=sourceAssetContexts.get(normalized)||[];
  const slugs=[...new Set(contexts.map(item=>String(item?.slug||'').trim()).filter(Boolean))];
  const matches=[];
  for(const slug of slugs){
    const articleSlugVariants=[slug];
    for(const transform of [
      candidate=>candidate.replace(/(\d{4})-(\d{4})(?=$|-)/g,'$1--$2'),
      candidate=>candidate.replace(/-cong-ty-ptsc-/g,'-cong-ty-pps-'),
      candidate=>candidate.replace(/-fpso-fso-/g,'-fpsofso-'),
    ]){
      for(const candidate of [...articleSlugVariants])articleSlugVariants.push(transform(candidate));
    }
    const articleSlugs=[...new Set(articleSlugVariants)];
    const articleTargets=[
      ...articleSlugs.map(articleSlug=>({slug:articleSlug,path:`/${articleSlug}`})),
      ...(currentPtscArticlePathOverrides.get(slug)||[]).map(path=>({slug,path})),
    ];
    for(const articleTarget of articleTargets){
      const cacheKey=articleTarget.path;
      let html=currentPtscArticleCache.get(cacheKey);
      if(html===undefined){
        const response=await fetch(`${legacyMediaAliasOrigin}${articleTarget.path}`,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)}).catch(()=>null);
        html=response?.ok?await response.text():'';
        currentPtscArticleCache.set(cacheKey,html);
      }
      if(!html)continue;
      for(const tag of html.match(/<img\b[^>]*>/gi)||[]){
        const candidates=new Set();
        for(const match of tag.matchAll(/\b(?:src|data-src|data-original|data-lazy-src)=(["'])([^"']+)\1/gi)){
          if(match[2])candidates.add(match[2]);
        }
        for(const match of tag.matchAll(/\b(?:srcset|data-srcset)=(["'])([^"']+)\1/gi)){
          for(const item of String(match[2]||'').split(',')){
            const raw=item.trim().split(/\s+/)[0];
            if(raw)candidates.add(raw);
          }
        }
        for(const raw of candidates){
          try{
            const candidate=new URL(raw,legacyMediaAliasOrigin);
            if(!/^https?:$/.test(candidate.protocol)||!/(^|\.)ptsc\.com\.vn$/i.test(candidate.hostname))continue;
            if(assetStem(candidate.href)!==wantedStem)continue;
            matches.push(candidate.href);
          }catch{}
        }
      }
    }
  }
  const unique=[...new Set(matches)];
  if(unique.length)log('CURRENT_PTSC_MEDIA_MATCH',{requested:normalized,contexts,matched:unique});
  return unique;
}

function archivedMimeAccepted(value,contentType){
  const type=String(contentType||'').split(';')[0].trim().toLowerCase();
  if(!type||/^(?:text\/|application\/(?:json|xml|xhtml\+xml))/.test(type))return false;
  const ext=extname(new URL(value).pathname).toLowerCase();
  if(['.jpg','.jpeg','.png','.gif','.webp','.bmp','.tif','.tiff','.svg'].includes(ext))return type.startsWith('image/')||type==='application/octet-stream';
  if(['.mp4','.m4v','.mov','.webm','.avi'].includes(ext))return type.startsWith('video/')||type==='application/octet-stream';
  if(ext==='.pdf')return type==='application/pdf'||type==='application/octet-stream';
  return true;
}

async function waybackSnapshots(value){
  const normalized=normalizeSourceAsset(value);if(!normalized)return [];
  if(waybackAssetCache.has(normalized))return waybackAssetCache.get(normalized);
  const promise=(async()=>{
    const cdx=`https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(normalized)}&output=json&filter=statuscode:200&fl=timestamp,original,mimetype,digest&collapse=digest&limit=10`;
    const response=await fetch(cdx,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(12000)}).catch(()=>null);
    if(!response?.ok)return [];
    const rows=await response.json().catch(()=>null);
    if(!Array.isArray(rows)||rows.length<2)return [];
    const snapshots=[];
    for(const row of rows.slice(1).reverse()){
      if(!Array.isArray(row)||row.length<3)continue;
      const timestamp=String(row[0]||'').trim();
      const original=String(row[1]||'').trim();
      const mimetype=String(row[2]||'').trim();
      if(!/^\d{14}$/.test(timestamp)||!/^https?:\/\//i.test(original)||!archivedMimeAccepted(normalized,mimetype))continue;
      snapshots.push({timestamp,original,mimetype,url:`https://web.archive.org/web/${timestamp}id_/${original}`});
    }
    const unique=[...new Map(snapshots.map(item=>[item.url,item])).values()].slice(0,10);
    if(unique.length)log('WAYBACK_MATCH',{requested:normalized,count:unique.length,first:{timestamp:unique[0].timestamp,original:unique[0].original,mimetype:unique[0].mimetype}});
    return unique;
  })();
  waybackAssetCache.set(normalized,promise);
  return promise;
}

async function currentPtscArticleImageInventory(slug){
  const articleSlugVariants=[slug];
  for(const transform of [
    candidate=>candidate.replace(/(\d{4})-(\d{4})(?=$|-)/g,'$1--$2'),
    candidate=>candidate.replace(/-cong-ty-ptsc-/g,'-cong-ty-pps-'),
    candidate=>candidate.replace(/-fpso-fso-/g,'-fpsofso-'),
  ]){
    for(const candidate of [...articleSlugVariants])articleSlugVariants.push(transform(candidate));
  }
  const articleTargets=[
    ...[...new Set(articleSlugVariants)].map(articleSlug=>({slug:articleSlug,path:`/${articleSlug}`})),
    ...(currentPtscArticlePathOverrides.get(slug)||[]).map(path=>({slug,path})),
  ];
  const articles=[];
  for(const target of articleTargets){
    const cacheKey=target.path;
    let html=currentPtscArticleCache.get(cacheKey);
    if(html===undefined){
      const response=await fetch(`${legacyMediaAliasOrigin}${target.path}`,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)}).catch(()=>null);
      html=response?.ok?await response.text():'';
      currentPtscArticleCache.set(cacheKey,html);
    }
    if(!html)continue;
    const images=[];
    const tags=html.match(/<img\b[^>]*>/gi)||[];
    for(let index=0;index<tags.length;index++){
      const tag=tags[index];
      const alt=decodeEntities(tag.match(/\balt=(["'])([^"']*)\1/i)?.[2]||'');
      const candidates=[];
      for(const attribute of ['data-original','data-lazy-src','data-src','src']){
        const escaped=attribute.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
        const raw=tag.match(new RegExp(`\\b${escaped}=(["'])([^"']+)\\1`,'i'))?.[2]||'';
        if(raw){candidates.push(raw);break;}
      }
      if(!candidates.length){
        const srcset=tag.match(/\b(?:srcset|data-srcset)=(["'])([^"']+)\1/i)?.[2]||'';
        const raw=srcset.split(',').map(item=>item.trim().split(/\s+/)[0]).find(Boolean)||'';
        if(raw)candidates.push(raw);
      }
      for(const raw of candidates){
        try{
          const candidate=new URL(raw,legacyMediaAliasOrigin);
          if(!/^https?:$/.test(candidate.protocol)||!/(^|\.)ptsc\.com\.vn$/i.test(candidate.hostname))continue;
          if(!/\/Data\/Sites\/1\/(?:media|News)\//i.test(candidate.pathname))continue;
          images.push({index,url:candidate.href,alt});
          break;
        }catch{}
      }
    }
    const uniqueImages=[...new Map(images.map(item=>[item.url,item])).values()];
    articles.push({slug:target.slug,path:target.path,images:uniqueImages});
  }
  return articles;
}

function assetSlug(url){return 'legacy-news-'+createHash('sha256').update(url).digest('hex').slice(0,20);}
function assetFilename(url,mime=''){
  const u=new URL(url);let ext=extname(u.pathname).toLowerCase();
  if(!/^\.[a-z0-9]{1,8}$/.test(ext)){
    if(/jpeg/.test(mime))ext='.jpg'; else if(/png/.test(mime))ext='.png'; else if(/webp/.test(mime))ext='.webp'; else if(/pdf/.test(mime))ext='.pdf'; else ext='';
  }
  return assetSlug(url)+ext;
}
function assetPriority(url){
  const ext=extname(new URL(url).pathname).toLowerCase();
  return ['.mp4','.m4v','.mov','.webm'].includes(ext)?0:1;
}

async function lookupMedia(n,slug,{refresh=false}={}){
  if(!refresh&&targetMediaLookupCache.has(slug))return targetMediaLookupCache.get(slug);
  const {response,body}=await api('GET',`/wp-json/wp/v2/media?context=edit&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,source_url,alt_text,title,mime_type`,n);
  assert(response.ok(),`Target media lookup failed ${slug}`);assert((body||[]).length<=1,`Duplicate target media ${slug}`);
  const media=body?.[0]||null;targetMediaLookupCache.set(slug,media);return media;
}

async function preloadTargetMedia(n,urls){
  const slugs=[...new Set(urls.map(assetSlug))];
  let probeSlug='';
  for(const slug of slugs.slice(0,20)){
    if(await lookupMedia(n,slug)){probeSlug=slug;break;}
  }
  let batchSupported=false;
  if(probeSlug){
    const sample=[probeSlug,...slugs.filter(slug=>slug!==probeSlug).slice(0,9)];
    const {response,body}=await api('GET',`/wp-json/wp/v2/media?context=edit&slug=${sample.map(encodeURIComponent).join(',')}&per_page=${sample.length}&_fields=id,slug,source_url,alt_text,title,mime_type`,n);
    batchSupported=response.ok()&&(body||[]).some(row=>String(row.slug||'')===probeSlug);
  }
  if(batchSupported){
    const batchSize=50;
    log('MEDIA_LOOKUP_MODE',{mode:'batch',batchSize});
    for(let i=0;i<slugs.length;i+=batchSize){
      const batch=slugs.slice(i,i+batchSize);
      const {response,body}=await api('GET',`/wp-json/wp/v2/media?context=edit&slug=${batch.map(encodeURIComponent).join(',')}&per_page=${batch.length}&_fields=id,slug,source_url,alt_text,title,mime_type`,n);
      assert(response.ok(),`Target media batch lookup failed at ${i}`);
      const rows=new Map();
      for(const row of body||[]){
        const slug=String(row.slug||'');
        assert(batch.includes(slug),`Unexpected target media slug ${slug}`);
        assert(!rows.has(slug),`Duplicate target media ${slug}`);
        rows.set(slug,row);
      }
      for(const slug of batch)targetMediaLookupCache.set(slug,rows.get(slug)||null);
      const done=Math.min(i+batch.length,slugs.length);
      if(done%200===0||done===slugs.length)log('MEDIA_LOOKUP_PROGRESS',{done,total:slugs.length,existing:[...targetMediaLookupCache.values()].filter(Boolean).length});
    }
  }else{
    log('MEDIA_LOOKUP_MODE',{mode:'individual-fallback'});
    for(let i=0;i<slugs.length;i+=mediaLookupConcurrency){
      await Promise.all(slugs.slice(i,i+mediaLookupConcurrency).map(slug=>lookupMedia(n,slug)));
      const done=Math.min(i+mediaLookupConcurrency,slugs.length);
      if(done%120===0||done===slugs.length)log('MEDIA_LOOKUP_PROGRESS',{done,total:slugs.length,existing:[...targetMediaLookupCache.values()].filter(Boolean).length});
    }
  }
  log('MEDIA_LOOKUP_PASS',{total:slugs.length,existing:[...targetMediaLookupCache.values()].filter(Boolean).length});
}

function mediaPath(value){
  const raw=String(value||'').trim();
  assert(raw,'Target media source_url missing');
  return new URL(raw,wp).pathname;
}

async function ensureAsset(n,url,meta={}){
  const normalized=normalizeSourceAsset(url);if(!normalized)return null;
  if(assetCache.has(normalized))return assetCache.get(normalized);
  const promise=(async()=>{
    const verifiedRecovery=verifiedExternalAssetRecoveries.get(normalized);
    const canonicalNormalized=verifiedRecovery?.canonicalSource||normalized;
    const slug=assetSlug(canonicalNormalized);
    let media=await lookupMedia(n,slug);
    if(media){
      const mediaUrl=String(media.source_url||'');
      if(canonicalNormalized!==normalized)log('MEDIA_CANONICAL_REUSE',{requested:normalized,canonical:canonicalNormalized,mediaId:Number(media.id)});
      return {id:Number(media.id),url:mediaUrl,path:mediaPath(mediaUrl),state:'existing'};
    }
    for(const fallback of wordpressDerivativeFallbacks(normalized)){
      const original=normalizeSourceAsset(fallback);if(!original)continue;
      const originalMedia=await lookupMedia(n,assetSlug(original));
      if(!originalMedia)continue;
      const mediaUrl=String(originalMedia.source_url||'');
      log('MEDIA_DERIVATIVE_REUSE',{requested:normalized,canonical:original,mediaId:Number(originalMedia.id)});
      return {id:Number(originalMedia.id),url:mediaUrl,path:mediaPath(mediaUrl),state:'existing-derivative-reuse'};
    }
    for(const fallback of sourceAssetFallbacks.get(normalized)||[]){
      const sibling=normalizeSourceAsset(fallback);if(!sibling)continue;
      const siblingMedia=await lookupMedia(n,assetSlug(sibling));
      if(!siblingMedia)continue;
      const mediaUrl=String(siblingMedia.source_url||'');
      log('MEDIA_SIBLING_REUSE',{requested:normalized,canonical:sibling,mediaId:Number(siblingMedia.id)});
      return {id:Number(siblingMedia.id),url:mediaUrl,path:mediaPath(mediaUrl),state:'existing-sibling-reuse'};
    }
    let source=await fetch(normalized,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)});
    let resolvedSource=normalized;
    let attemptedFallbacks=[];
    if(source.status===404){
      const responsiveFallbacks=sourceAssetFallbacks.get(normalized)||[];
      attemptedFallbacks=[...new Set([
        verifiedRecovery?.url,
        legacyMediaAlias(normalized),
        ...wordpressDerivativeFallbacks(normalized),
        ...responsiveFallbacks,
        ...responsiveFallbacks.flatMap(wordpressDerivativeFallbacks),
      ].filter(Boolean))];
      for(const fallback of attemptedFallbacks){
        const candidate=await fetch(fallback,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)}).catch(()=>null);
        if(candidate?.ok){
          source=candidate;
          resolvedSource=fallback;
          if(verifiedRecovery?.url===fallback)log('MEDIA_SOURCE_RECOVERED_VERIFIED',{requested:normalized,resolved:fallback,article:verifiedRecovery.article,note:verifiedRecovery.note});
          else log('MEDIA_SOURCE_RECOVERED',{requested:normalized,resolved:fallback});
          break;
        }
      }
      if(!source.ok){
        const currentPtscFallbacks=await currentPtscArticleFallbacks(normalized);
        attemptedFallbacks=[...new Set([...attemptedFallbacks,...currentPtscFallbacks])];
        for(const fallback of currentPtscFallbacks){
          const candidate=await fetch(fallback,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)}).catch(()=>null);
          if(candidate?.ok){source=candidate;resolvedSource=fallback;log('MEDIA_SOURCE_RECOVERED_CURRENT_PTSC',{requested:normalized,resolved:fallback});break;}
        }
      }
      if(!source.ok){
        const currentNewsAssetFallbacks=currentPtscNewsAssetFallbacks(normalized,responsiveFallbacks);
        attemptedFallbacks=[...new Set([...attemptedFallbacks,...currentNewsAssetFallbacks])];
        for(const fallback of currentNewsAssetFallbacks){
          const candidate=await fetch(fallback,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(20000)}).catch(()=>null);
          const contentType=String(candidate?.headers?.get('content-type')||'').toLowerCase();
          if(!candidate?.ok||!contentType.startsWith('image/'))continue;
          source=candidate;resolvedSource=fallback;
          log('MEDIA_SOURCE_RECOVERED_CURRENT_NEWS_ASSET',{requested:normalized,resolved:fallback});
          break;
        }
      }
      if(!source.ok){
        const archiveBaseCandidates=[...new Set([
          normalized,
          ...wordpressDerivativeFallbacks(normalized),
          ...responsiveFallbacks,
          ...responsiveFallbacks.flatMap(wordpressDerivativeFallbacks),
        ].map(normalizeSourceAsset).filter(Boolean))];
        const archiveCandidates=[...new Set(archiveBaseCandidates.flatMap(candidate=>[
          candidate,
          legacyMediaAlias(candidate),
        ]).filter(Boolean))];
        for(const archiveCandidate of archiveCandidates){
          const snapshots=await waybackSnapshots(archiveCandidate);
          for(const snapshot of snapshots){
            const candidate=await fetch(snapshot.url,{headers:{'User-Agent':'PTSCPS News migration/1.0'},signal:AbortSignal.timeout(60000)}).catch(()=>null);
            if(!candidate?.ok||!archivedMimeAccepted(archiveCandidate,candidate.headers.get('content-type')))continue;
            source=candidate;resolvedSource=snapshot.url;attemptedFallbacks.push(snapshot.url);
            log('MEDIA_SOURCE_RECOVERED_WAYBACK',{requested:normalized,archivedOriginal:snapshot.original,timestamp:snapshot.timestamp,resolved:snapshot.url});
            break;
          }
          if(source.ok)break;
        }
      }
    }
    if(!source.ok)log('MEDIA_SOURCE_MISSING',{requested:normalized,http:source.status,references:sourceAssetContexts.get(normalized)||[],fallbacks:attemptedFallbacks.slice(0,40)});
    assert(source.ok,`Legacy asset HTTP ${source.status}: ${normalized}`);
    const bytes=Buffer.from(await source.arrayBuffer());
    assert(bytes.length>0,`Legacy asset empty: ${normalized}`);
    assert(bytes.length<=maxAssetBytes,`Legacy asset exceeds 256MB safety cap: ${normalized}`);
    if(bytes.length>largeAssetThreshold){
      log('MEDIA_LARGE',{url:normalized,bytes:bytes.length,mib:Number((bytes.length/1024/1024).toFixed(1))});
    }
    const contentType=String(source.headers.get('content-type')||meta.mime_type||'application/octet-stream').split(';')[0];
    const file=assetFilename(normalized,contentType);
    const uploadTimeout=bytes.length>largeAssetThreshold?240000:90000;
    let createdMedia=null;
    for(let attempt=1;attempt<=3&&!createdMedia;attempt++){
      const upload=await page.request.post(uri('/wp-json/wp/v2/media'),{
        headers:{'X-WP-Nonce':n,'Content-Type':contentType,'Content-Disposition':`attachment; filename="${file}"`},
        data:bytes,timeout:uploadTimeout,
      }).catch(()=>null);
      const body=upload?await upload.json().catch(()=>null):null;
      if(upload?.ok()&&body?.id){createdMedia=body;break;}
      await sleep(700*attempt);
      const recovered=await lookupMedia(n,slug,{refresh:true}).catch(()=>null);
      if(recovered){createdMedia=recovered;break;}
      log('MEDIA_RETRY',{slug,attempt,http:upload?.status?.()||0});
    }
    assert(createdMedia?.id,`Target media upload failed ${normalized}`);
    const metadata={
      alt_text:String(meta.alt_text||''),
      title:decodeEntities(meta.title?.rendered||meta.title||basename(new URL(normalized).pathname)),
      caption:String(meta.caption?.rendered||meta.caption||''),
    };
    const update=await api('POST',`/wp-json/wp/v2/media/${createdMedia.id}`,n,metadata);
    assert(update.response.ok(),`Target media metadata update failed ${createdMedia.id}`);
    media=update.body||createdMedia;created.media.push(Number(media.id));writes++;
    targetMediaLookupCache.set(slug,media);
    const mediaUrl=String(media.source_url||createdMedia.source_url||'');
    return {id:Number(media.id),url:mediaUrl,path:mediaPath(mediaUrl),state:'created'};
  })();
  assetCache.set(normalized,promise);
  return promise;
}

function registerResponsiveFallbacks(html){
  for(const tag of String(html||'').match(/<img\b[^>]*>/gi)||[]){
    const src=tag.match(/\bsrc=(["'])([^"']+)\1/i)?.[2]||'';
    const original=normalizeSourceAsset(src);
    if(!original)continue;
    const srcset=tag.match(/\bsrcset=(["'])([\s\S]*?)\1/i)?.[2]||'';
    const candidates=[...(srcset.match(sourceAssetRe)||[])]
      .map(normalizeSourceAsset)
      .filter(value=>value&&value!==original)
      .reverse();
    if(!candidates.length)continue;
    const recoveryCandidates=candidates.flatMap(value=>[value,legacyMediaAlias(value)]).filter(Boolean);
    const existing=sourceAssetFallbacks.get(original)||[];
    sourceAssetFallbacks.set(original,[...new Set([...recoveryCandidates,...existing])]);
  }
  for(const anchor of String(html||'').match(/<a\b[\s\S]*?<\/a>/gi)||[]){
    const href=anchor.match(/\bhref=(["'])([^"']+)\1/i)?.[2]||'';
    const original=normalizeSourceAsset(href);
    if(!original)continue;
    const img=anchor.match(/<img\b[^>]*>/i)?.[0]||'';
    if(!img)continue;
    const src=img.match(/\bsrc=(["'])([^"']+)\1/i)?.[2]||'';
    const srcset=img.match(/\bsrcset=(["'])([\s\S]*?)\1/i)?.[2]||'';
    const originalUrl=new URL(original);
    const originalExt=extname(originalUrl.pathname).toLowerCase();
    const originalStem=basename(originalUrl.pathname,originalExt).replace(/-\d+x\d+$/,'');
    const originalDir=originalUrl.pathname.slice(0,originalUrl.pathname.lastIndexOf('/')+1);
    const candidates=[src,...(srcset.match(sourceAssetRe)||[])].map(normalizeSourceAsset).filter(value=>{
      if(!value||value===original)return false;
      const candidateUrl=new URL(value);const candidateExt=extname(candidateUrl.pathname).toLowerCase();
      const candidateStem=basename(candidateUrl.pathname,candidateExt).replace(/-\d+x\d+$/,'');
      const candidateDir=candidateUrl.pathname.slice(0,candidateUrl.pathname.lastIndexOf('/')+1);
      return candidateDir===originalDir&&candidateStem===originalStem&&candidateExt===originalExt;
    });
    if(candidates.length){
      const recoveryCandidates=candidates.flatMap(value=>[value,legacyMediaAlias(value)]).filter(Boolean);
      const existing=sourceAssetFallbacks.get(original)||[];sourceAssetFallbacks.set(original,[...new Set([...recoveryCandidates,...existing])]);
    }
  }
}

function stripLegacyResponsiveAttrs(html){
  return String(html||'').replace(/<img\b[^>]*>/gi,tag=>{
    const srcset=tag.match(/\s+srcset=(["'])([\s\S]*?)\1/i);
    if(!srcset||!sourceAssetInTextRe.test(srcset[2]))return tag;
    return tag.replace(srcset[0],'').replace(/\s+sizes=(["'])([\s\S]*?)\1/i,'');
  });
}

function extractAssets(html){
  const normalizedHtml=stripLegacyResponsiveAttrs(html);
  return [...new Set((normalizedHtml.match(sourceAssetRe)||[]).map(normalizeSourceAsset).filter(Boolean))];
}

async function rewriteAssets(n,html){
  let result=stripLegacyResponsiveAttrs(html);
  const originals=[...new Set(result.match(sourceAssetRe)||[])];
  for(const raw of originals){
    const normalized=normalizeSourceAsset(raw);if(!normalized)continue;
    const media=await ensureAsset(n,normalized);
    assert(media?.path,`Asset mapping missing ${normalized}`);
    result=result.split(raw).join(media.path);
  }
  return result.replace(/https?:\/\/ptscps\.com\.vn(?=\/)/gi,'');
}

async function setAcf(n,collection,id,values){
  const attempt=await api('POST',`/wp-json/wp/v2/${collection}/${id}`,n,{acf:values});
  if(attempt.response.ok()){
    const verify=await api('GET',`/wp-json/wp/v2/${collection}/${id}?context=edit&_fields=id,acf`,n);
    if(verify.response.ok()&&Object.entries(values).every(([key,value])=>String(verify.body?.acf?.[key]?.value??verify.body?.acf?.[key]??'')===String(value)))return;
  }
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit&esc_full_admin=1`),{waitUntil:'domcontentloaded',timeout:50000});
  for(const [name,value] of Object.entries(values)){
    const row=page.locator(`.acf-field[data-name="${name}"]`).first();
    assert(await row.count()===1,`ACF field ${name} missing for ${collection} ${id}`);
    const select=row.locator('select').first();
    if(await select.count())await select.selectOption(String(value));
    else{
      const radio=row.locator(`input[type="radio"][value="${String(value).replace(/"/g,'\\"')}"]`).first();
      if(await radio.count())await radio.check();
      else{
        const input=row.locator('input[type="text"],input:not([type]),textarea').first();
        assert(await input.count(),`ACF field input ${name} missing for ${collection} ${id}`);await input.fill(String(value));
      }
    }
  }
  const publish=page.locator('#publish').first();assert(await publish.count(),`Update control missing for ${collection} ${id}`);
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}).catch(()=>null),publish.click()]);
  const verify=await api('GET',`/wp-json/wp/v2/${collection}/${id}?context=edit&_fields=id,acf`,n);
  assert(verify.response.ok(),`ACF readback failed ${collection} ${id}`);
  for(const [key,value] of Object.entries(values)) assert(String(verify.body?.acf?.[key]?.value??verify.body?.acf?.[key]??'')===String(value),`ACF ${key} mismatch ${collection} ${id}`);
}

async function postBySlug(n,slug){
  const {response,body}=await api('GET',`/wp-json/wp/v2/posts?context=edit&status=any&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,status,title,content,excerpt,date,date_gmt,featured_media,categories,acf`,n);
  assert(response.ok(),`Target post lookup failed ${slug}`);assert((body||[]).length<=1,`Duplicate target post ${slug}`);return body?.[0]||null;
}

async function migratePosts(source,n,featuredMap){
  let index=0;
  for(const post of source.posts){
    const targetCategories=post.categories.map(id=>targetCategoryBySourceId.get(id)).filter(Boolean).map(Number);
    assert(targetCategories.length>0,`No mapped News category for source post ${post.id}`);
    const content=await rewriteAssets(n,post.content);
    const excerpt=await rewriteAssets(n,post.excerpt);
    let featured=0;
    if(post.featuredMedia){
      const sourceMedia=featuredMap.get(post.featuredMedia);assert(sourceMedia,`Source featured media metadata missing ${post.featuredMedia}`);
      featured=Number((await ensureAsset(n,sourceMedia.source_url,sourceMedia)).id);
    }
    const payload={
      title:post.title,slug:post.slug,status:'publish',content,excerpt,
      date:post.date,date_gmt:post.dateGmt,categories:targetCategories,featured_media:featured,
    };
    let target=await postBySlug(n,post.slug);let state='UPDATED';
    if(!target){
      const createdResponse=await api('POST','/wp-json/wp/v2/posts',n,payload,90000);
      assert(createdResponse.response.ok()&&createdResponse.body?.id,`Post create failed source=${post.id} HTTP ${createdResponse.response.status()}`);
      target=createdResponse.body;created.posts.push(Number(target.id));state='CREATED';writes++;
    }else{
      const currentLang=String(target.acf?.product_lang?.value??target.acf?.product_lang??'');
      const currentCats=(target.categories||[]).map(Number).sort((a,b)=>a-b);
      const exact=clean(decodeEntities(target.title?.raw??target.title?.rendered))===clean(post.title)
        &&String(target.date_gmt||'').slice(0,19)===post.dateGmt.slice(0,19)
        &&Number(target.featured_media||0)===featured
        &&JSON.stringify(currentCats)===JSON.stringify([...targetCategories].sort((a,b)=>a-b))
        &&currentLang===productLang
        &&String(target.content?.raw??'')===content
        &&String(target.excerpt?.raw??'')===excerpt;
      if(exact){index++;if(index%25===0||index===source.posts.length)log('POST_PROGRESS',{done:index,total:source.posts.length,writes});continue;}
      const updateResponse=await api('POST',`/wp-json/wp/v2/posts/${target.id}`,n,payload,90000);
      assert(updateResponse.response.ok(),`Post update failed source=${post.id} HTTP ${updateResponse.response.status()}`);
      updated.posts.push(Number(target.id));writes++;
    }
    await setAcf(n,'posts',Number(target.id),{product_lang:productLang});
    const readback=await postBySlug(n,post.slug);assert(readback?.status==='publish',`Post readback missing ${post.slug}`);
    assert(String(readback.acf?.product_lang?.value??readback.acf?.product_lang??'')===productLang,`Post language mismatch ${post.slug}`);
    const rbCats=(readback.categories||[]).map(Number).sort((a,b)=>a-b);
    assert(JSON.stringify(rbCats)===JSON.stringify([...targetCategories].sort((a,b)=>a-b)),`Post category mismatch ${post.slug}`);
    assert(Number(readback.featured_media||0)===featured,`Post featured media mismatch ${post.slug}`);
    index++;if(index%25===0||index===source.posts.length)log('POST_PROGRESS',{done:index,total:source.posts.length,writes,lastState:state});
  }
}

async function pageBySlug(n,slug){
  const {response,body}=await api('GET',`/wp-json/wp/v2/pages?context=edit&status=any&slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,status,title,content,date,date_gmt,featured_media,acf`,n);
  assert(response.ok(),`Target Page lookup failed ${slug}`);assert((body||[]).length<=1,`Duplicate target Page ${slug}`);return body?.[0]||null;
}

async function migrateGallery(source,n){
  const gallery=source.gallery;
  const content=await rewriteAssets(n,gallery.content);
  const payload={title:gallery.title,slug:gallery.slug,status:'publish',content,date:gallery.date,date_gmt:gallery.dateGmt};
  let target=await pageBySlug(n,gallery.slug);
  if(!target){
    const createdResponse=await api('POST','/wp-json/wp/v2/pages',n,payload,90000);
    assert(createdResponse.response.ok()&&createdResponse.body?.id,`Gallery Page create failed HTTP ${createdResponse.response.status()}`);
    target=createdResponse.body;created.pages.push(Number(target.id));writes++;
    log('GALLERY',{id:target.id,state:'CREATED'});
  }else{
    const currentLang=String(target.acf?.product_lang?.value??target.acf?.product_lang??'');
    const currentKey=String(target.acf?.key||'');const currentAction=String(target.acf?.action||'');
    if(currentLang===productLang&&currentKey==='news-gallery'&&currentAction==='IntroPage'&&String(target.content?.raw??'')===content){
      log('GALLERY',{id:target.id,state:'SKIP_EXISTING'});
    }else{
      const updateResponse=await api('POST',`/wp-json/wp/v2/pages/${target.id}`,n,payload,90000);assert(updateResponse.response.ok(),'Gallery Page update failed');updated.pages.push(Number(target.id));writes++;
    }
  }
  await setAcf(n,'pages',Number(target.id),{product_lang:productLang,key:'news-gallery',action:'IntroPage'});
  const readback=await pageBySlug(n,gallery.slug);assert(readback?.status==='publish','Gallery Page readback missing');
  assert(String(readback.acf?.product_lang?.value??readback.acf?.product_lang??'')===productLang,'Gallery Page language mismatch');
  assert(String(readback.acf?.key||'')==='news-gallery'&&String(readback.acf?.action||'')==='IntroPage','Gallery Page frontend metadata mismatch');
  const rendered=String(readback.content?.raw??readback.content?.rendered??'');
  assert(!/https?:\/\/ptscps\.com\.vn\/wp-content\/uploads\//i.test(rendered),'Gallery Page still references legacy media origin');
  log('GALLERY',{id:readback.id,state:'PASS',key:'news-gallery',action:'IntroPage'});
}

async function verify(source,n){
  const targetCategoryIds={};
  for(const [slug,item] of Object.entries(source.categories)){
    const {response,body}=await api('GET',`/wp-json/wp/v2/categories?slug=${encodeURIComponent(slug)}&per_page=20&_fields=id,slug,name,count,parent`,n);
    assert(response.ok()&&(body||[]).length===1,`Final category readback failed ${slug}`);
    const row=body[0];targetCategoryIds[slug]=Number(row.id);
    assert(Number(row.count||0)===Number(item.count),`Final category count mismatch ${slug}: target=${row.count} source=${item.count}`);
  }
  const allTarget=new Map();
  for(const [slug,item] of Object.entries(source.categories)){
    const targetId=targetCategoryIds[slug];const totalPages=Math.max(1,Math.ceil(Number(item.count||0)/100));
    for(let pageNo=1;pageNo<=totalPages;pageNo++){
      const {response,body}=await api('GET',`/wp-json/wp/v2/posts?context=edit&status=publish&categories=${targetId}&per_page=100&page=${pageNo}&orderby=date&order=desc&_fields=id,slug,title,date,date_gmt,featured_media,categories,acf`,n);
      assert(response.ok(),`Final target posts readback failed ${slug} page ${pageNo}`);
      for(const row of body||[])allTarget.set(String(row.slug||''),row);
    }
  }
  assert(allTarget.size===source.posts.length,`Final unique Post count mismatch target=${allTarget.size} source=${source.posts.length}`);
  for(const post of source.posts){
    const row=allTarget.get(post.slug);assert(row,`Final target Post missing ${post.slug}`);
    assert(clean(decodeEntities(row.title?.raw??row.title?.rendered))===clean(post.title),`Final title mismatch ${post.slug}`);
    assert(String(row.acf?.product_lang?.value??row.acf?.product_lang??'')===productLang,`Final language mismatch ${post.slug}`);
    const expectedCats=post.categories.map(id=>targetCategoryBySourceId.get(id)).filter(Boolean).map(Number).sort((a,b)=>a-b);
    const actualCats=(row.categories||[]).map(Number).sort((a,b)=>a-b);
    assert(JSON.stringify(actualCats)===JSON.stringify(expectedCats),`Final category mapping mismatch ${post.slug}`);
    if(post.featuredMedia)assert(Number(row.featured_media||0)>0,`Final featured media missing ${post.slug}`);
  }
  const gallery=await pageBySlug(n,'thu-vien-pps');assert(gallery?.status==='publish','Final gallery Page missing');
  assert(String(gallery.acf?.product_lang?.value??gallery.acf?.product_lang??'')===productLang,'Final gallery lang mismatch');
  assert(String(gallery.acf?.key||'')==='news-gallery','Final gallery key mismatch');
  const summary={status:'PASS',uniquePosts:allTarget.size,categories:Object.fromEntries(Object.entries(source.categories).map(([slug,item])=>[slug,item.count])),galleryId:Number(gallery.id),productLang,writes,created,updated,mediaMapped:assetCache.size};
  await writeFile(`${artifactDir}/result.json`,JSON.stringify(summary,null,2));
  log('READBACK_PASS',summary);
}

try{
  const source=await readSource();
  await login();
  const n=await nonce();
  await targetSnapshot(n);
  await ensureCategories(source,n);

  await registerInlineAttachmentFallbacks(source);
  const featuredIds=[...new Set(source.posts.map(post=>post.featuredMedia).filter(Boolean))];
  const featuredMap=await sourceMediaByIds(featuredIds,source.posts);
  for(const post of source.posts){
    if(!post.featuredMedia)continue;
    const row=featuredMap.get(post.featuredMedia);
    const url=normalizeSourceAsset(row?.source_url);
    if(url)addSourceAssetContext(url,{kind:'post-featured',id:post.id,slug:post.slug,attachmentId:post.featuredMedia});
  }
  const assetSet=new Set();
  for(const post of source.posts){
    registerResponsiveFallbacks(post.content);
    registerResponsiveFallbacks(post.excerpt);
    for(const url of extractAssets(post.content)){
      addSourceAssetContext(url,{kind:'post-content-asset',id:post.id,slug:post.slug});
      assetSet.add(url);
    }
    for(const url of extractAssets(post.excerpt)){
      addSourceAssetContext(url,{kind:'post-excerpt-asset',id:post.id,slug:post.slug});
      assetSet.add(url);
    }
  }
  for(const row of featuredMap.values()){const url=normalizeSourceAsset(row.source_url);if(url)assetSet.add(url);}
  registerResponsiveFallbacks(source.gallery.content);
  for(const url of extractAssets(source.gallery.content)){
    addSourceAssetContext(url,{kind:'gallery-content-asset',id:source.gallery.id,slug:source.gallery.slug});
    assetSet.add(url);
  }
  log('MEDIA_RESPONSIVE_FALLBACKS',{sources:sourceAssetFallbacks.size});
  await preloadTargetMedia(n,[...assetSet]);
  log('MEDIA_PLAN',{uniqueAssets:assetSet.size,featuredAttachments:featuredIds.length});
  const assets=[...assetSet].sort((a,b)=>assetPriority(a)-assetPriority(b));
  const mediaConcurrency=2;
  const missingSourceAssets=[];
  for(let i=0;i<assets.length;i+=mediaConcurrency){
    const batch=assets.slice(i,i+mediaConcurrency);
    const results=await Promise.allSettled(batch.map(url=>ensureAsset(n,url)));
    for(let index=0;index<results.length;index++){
      const result=results[index];
      if(result.status==='fulfilled')continue;
      const message=String(result.reason?.message||result.reason||'');
      if(message.startsWith('Legacy asset HTTP 404:')){
        const url=batch[index];
        missingSourceAssets.push({url,references:sourceAssetContexts.get(url)||[]});
        continue;
      }
      throw result.reason;
    }
    const done=Math.min(i+mediaConcurrency,assets.length);if(done%40===0||done===assets.length)log('MEDIA_PROGRESS',{done,total:assets.length,created:created.media.length,missing:missingSourceAssets.length});
  }
  if(missingSourceAssets.length){
    const affectedPostIds=[...new Set(missingSourceAssets.flatMap(item=>item.references.map(ref=>Number(ref?.id||0))).filter(Boolean))];
    const diagnostics=[];
    for(const postId of affectedPostIds){
      const post=source.posts.find(item=>Number(item.id)===postId);
      if(!post)continue;
      const legacyImages=inlineImageAttachmentRefs(post.content).map((ref,index)=>({
        index,
        attachmentId:Number(ref.id||0),
        urls:ref.urls,
      }));
      diagnostics.push({
        postId:post.id,slug:post.slug,title:post.title,
        legacyImages,
        currentArticles:await currentPtscArticleImageInventory(post.slug),
      });
    }
    const missingAttachmentIds=[...new Set(missingSourceAssets.flatMap(item=>item.references.map(ref=>Number(ref?.attachmentId||0))).filter(Boolean))];
    const legacyMediaEvidence=[];
    for(let i=0;i<missingAttachmentIds.length;i+=100){
      const chunk=missingAttachmentIds.slice(i,i+100);
      const response=await context.request.get(legacy+`/wp-json/wp/v2/media?include=${chunk.join(',')}&per_page=100&_fields=id,slug,source_url,alt_text,title,caption,mime_type,media_details`,{timeout:50000,headers:{'Cache-Control':'no-cache'}});
      assert(response.ok(),`Legacy missing-media evidence batch HTTP ${response.status()}`);
      for(const row of await response.json())legacyMediaEvidence.push(row);
    }
    const featuredBySourceUrl=new Map();
    for(const row of featuredMap.values()){
      const sourceUrl=normalizeSourceAsset(row?.source_url);
      if(sourceUrl)featuredBySourceUrl.set(sourceUrl,row);
    }
    const unreferencedEvidence=missingSourceAssets.filter(item=>!item.references.length).map(item=>({
      url:item.url,
      featuredMedia:featuredBySourceUrl.get(item.url)||null,
    }));
    const summary={count:missingSourceAssets.length,items:missingSourceAssets,diagnostics,legacyMediaEvidence,unreferencedEvidence};
    await writeFile(`${artifactDir}/missing-source-assets.json`,JSON.stringify(summary,null,2));
    log('MEDIA_SOURCE_MISSING_SUMMARY',summary);
    throw Error(`Legacy source assets still missing: ${missingSourceAssets.length}`);
  }

  await migratePosts(source,n,featuredMap);
  await migrateGallery(source,n);
  await verify(source,n);
  log('RESULT',{status:'PASS',writes,created:{categories:created.categories.length,media:created.media.length,posts:created.posts.length,pages:created.pages.length},updated:{categories:updated.categories.length,posts:updated.posts.length,pages:updated.pages.length}});
}finally{
  await browser.close();
}
