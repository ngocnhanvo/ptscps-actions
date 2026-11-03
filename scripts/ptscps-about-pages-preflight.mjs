import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chromium } from 'playwright';

const wp=process.env.WP_ORIGIN;
const front=process.env.FRONT_ORIGIN;
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
assert.ok(wp&&front&&username&&password,'Missing configured PTSCPS audit inputs');

const wanted=['thu-ngo','gioi-thieu-cong-ty','ban-lanh-dao','qua-trinh-phat-trien','dinh-huong-phat-trien'];
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const report=(k,v)=>console.log('ABOUT_PREFLIGHT_'+k+'='+JSON.stringify(v));

const textOnly=(html='')=>String(html).replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/gi,' ').replace(/\s+/g,' ').trim();
const fingerprint=(value='')=>crypto.createHash('sha256').update(String(value)).digest('hex').slice(0,16);

try{
  const publicPages=await page.request.get(wp+'/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,status,title,content,parent,acf,link',{timeout:30000});
  assert.ok(publicPages.ok(),'Cannot read target published Pages');
  const pages=await publicPages.json();
  const matches=pages.filter(p=>wanted.some(slug=>String(p.slug||'')===slug||String(p.slug||'')===slug+'.htm'));
  report('TARGET_PAGES',matches.map(p=>({
    id:p.id,slug:p.slug,status:p.status,parent:p.parent,
    title:textOnly(p.title?.rendered||''),content_chars:String(p.content?.rendered||'').length,
    content_text_chars:textOnly(p.content?.rendered||'').length,content_sha:fingerprint(p.content?.rendered||''),
    key:p.acf?.key||'',action:p.acf?.action||'',product_lang:p.acf?.product_lang?.value||p.acf?.product_lang||''
  })));

  const menuRes=await page.request.get(wp+'/wp-json/esc-api/v1/menus?_about_audit='+Date.now(),{timeout:30000,headers:{'Cache-Control':'no-cache'}});
  assert.ok(menuRes.ok(),'Cannot read ESC menu API');
  const menuPayload=await menuRes.json();
  assert.equal(menuPayload?.success,true,'ESC menu contract invalid');
  const header=menuPayload?.menus?.Header?.vi||null;
  const pack=(node)=>({label:node?.label,key:node?.key,slug:node?.slug,href:node?.href,linkType:node?.linkType,linkMode:node?.linkMode,children:Array.isArray(node?.children)?node.children.map(pack):[]});
  report('HEADER_VI',header?{id:header.id,name:header.name,code:header.code,lang:header.lang,type:header.type,items:(header.items||[]).map(pack)}:null);

  await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  assert.ok(page.url().startsWith(wp+'/wp-admin/'),'WordPress admin authentication not confirmed');
  report('AUTH','PASS');

  const nonceRes=await page.request.post(wp+'/wp-admin/admin-ajax.php',{form:{action:'rest-nonce'},timeout:20000});
  const nonce=(await nonceRes.text()).trim();
  assert.ok(nonceRes.ok()&&/^[a-f\d]{8,20}$/i.test(nonce),'REST nonce unavailable');
  const headers={'X-WP-Nonce':nonce,'Cache-Control':'no-cache'};

  const nativeMenus=await page.request.get(wp+'/wp-json/wp/v2/menus?per_page=100',{headers,timeout:25000});
  report('NATIVE_MENUS',nativeMenus.ok()?(await nativeMenus.json()).map(m=>({id:m.id,name:m.name,slug:m.slug,count:m.count})): {http:nativeMenus.status()});

  if(header?.id){
    const itemsRes=await page.request.get(wp+'/wp-json/wp/v2/menu-items?menus='+encodeURIComponent(header.id)+'&per_page=100&orderby=menu_order&order=asc',{headers,timeout:25000});
    assert.ok(itemsRes.ok(),'Cannot read native Header menu items');
    const items=await itemsRes.json();
    report('NATIVE_HEADER_ITEMS',items.map(i=>({id:i.id,title:textOnly(i.title?.rendered||''),parent:i.parent,menu_order:i.menu_order,type:i.type,url:i.url,status:i.status,object:i.object,object_id:i.object_id})));
  }

  for(const slug of wanted){
    const r=await page.request.get(wp+'/wp-json/wp/v2/pages?context=edit&status=any&slug='+encodeURIComponent(slug)+'&per_page=20&_fields=id,slug,status,title,content,parent,acf,link',{headers,timeout:25000});
    assert.ok(r.ok(),'Cannot inspect target page slug '+slug);
    const records=await r.json();
    report('PAGE_'+slug.toUpperCase().replace(/-/g,'_'),records.map(p=>({id:p.id,slug:p.slug,status:p.status,parent:p.parent,title:textOnly(p.title?.rendered||p.title?.raw||''),content_chars:String(p.content?.raw||p.content?.rendered||'').length,content_text_chars:textOnly(p.content?.raw||p.content?.rendered||'').length,content_sha:fingerprint(p.content?.raw||p.content?.rendered||''),key:p.acf?.key||'',action:p.acf?.action||'',product_lang:p.acf?.product_lang?.value||p.acf?.product_lang||''})));
  }

  const frontRes=await page.request.get(front+'/',{timeout:25000});
  assert.ok(frontRes.ok(),'Frontend production origin unavailable');
  report('FRONT_HTTP',frontRes.status());
  console.log('ABOUT_PREFLIGHT_RESULT=PASS_READ_ONLY writes=0');
} finally { await browser.close(); }
