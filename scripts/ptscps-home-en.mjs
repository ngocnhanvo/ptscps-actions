import { chromium } from 'playwright';
const origin=process.env.WP_ORIGIN, user=process.env.WP_ADMIN_USERNAME, password=process.env.WP_ADMIN_PASSWORD;
if(!origin||!user||!password)throw Error('Missing WordPress Admin configuration');
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:960}});
try{
  await page.goto(origin+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  console.log('EN_AUDIT_AUTH=PASS');
  const pages=[];
  for(let pg=1;pg<=4;pg++){
    let r=await page.request.get(`${origin}/wp-json/wp/v2/pages?context=edit&per_page=100&page=${pg}&_fields=id,slug,title,status,acf,content,parent,modified`,{timeout:30000});
    if(r.status()===401||r.status()===403){
      // WordPress cookie-authenticated REST edit context requires X-WP-Nonce.
      // Public publish-only data is enough for the initial inventory; admin
      // list separately confirms draft titles without any writes.
      r=await page.request.get(`${origin}/wp-json/wp/v2/pages?per_page=100&page=${pg}&_fields=id,slug,title,status,acf,content,parent,modified`,{timeout:30000});
      console.log('EN_AUDIT_PAGES_FALLBACK=public-published-only');
    }
    if(r.status()===400)break;
    if(!r.ok())throw Error('Page inventory HTTP '+r.status());
    const data=await r.json();pages.push(...data);
    if(data.length<100)break;
  }
  const adminList=await page.goto(origin+'/wp-admin/edit.php?post_type=page&post_status=all',{waitUntil:'domcontentloaded',timeout:45000});
  console.log('EN_AUDIT_ADMIN_LIST='+JSON.stringify({status:adminList?.status(),relevant:await page.locator('#the-list tr').evaluateAll(rows=>rows.map(row=>({id:row.id,title:row.querySelector('.row-title')?.textContent?.trim(),status:row.querySelector('.post-state')?.textContent?.trim()})).filter(row=>/home|trang chủ|homepage|english/i.test(row.title||'')))}));
  const relevant=pages.filter(p=>{const acf=p.acf||{};const title=String(p.title?.raw||p.title?.rendered||'').toLowerCase();return acf.key==='home'||/home|trang chủ|homepage|english/i.test(title)||String(acf.product_lang||'').includes('en');});
  console.log('EN_AUDIT_PAGES='+JSON.stringify({total:pages.length,relevant:relevant.map(p=>({id:p.id,title:p.title?.raw||p.title?.rendered,status:p.status,slug:p.slug,acf:{key:p.acf?.key,action:p.acf?.action,lang:p.acf?.product_lang,origin_page_id:p.acf?.origin_page_id},shortcodes:[...String(p.content?.raw||'').matchAll(/\[table\s+id=([^\s\]]+)\s*\/\]/gi)].map(m=>m[1]),contentChars:String(p.content?.raw||'').length}))}));
  const tables=[];
  for(let pg=1;pg<=5;pg++){
    const r=await page.request.get(origin+`/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=${pg}`);
    if(r.status()===400)break;
    if(!r.ok())throw Error('Table inventory HTTP '+r.status());
    const data=await r.json(); tables.push(...data);
    if(data.length<100)break;
  }
  console.log('EN_AUDIT_TABLES='+JSON.stringify({count:tables.length,homes:tables.filter(t=>/^home_/i.test(t.id)).map(t=>({id:t.id,title:t.title}))}));
  for(const id of ['home_00','home_01','home_02','home_03','home_04','home_05','home_14','home_15']){
    const r=await page.request.get(origin+'/wp-json/tablepress/v1/table/'+id);
    if(!r.ok())throw Error('VI Table missing '+id+' HTTP '+r.status());
    const d=await r.json();
    const fields=(d.fields||[]).map(f=>({key:f.key,label:f.label}));
    const items=(d.items||[]).map(x=>Object.fromEntries(Object.entries(x).map(([k,v])=>[k,typeof v==='string'&&v.includes('<img')?{img:true,src:v.match(/src=["']([^"']+)/)?.[1]||'',alt:v.match(/alt=["']([^"']*)/)?.[1]||''}:String(v??'').slice(0,360)])));
    console.log('EN_AUDIT_TABLE='+JSON.stringify({id,title:d.title,description:d.description,fields,items:items.slice(0,id==='home_15'?3:12),rows:(d.data||[]).length,totalItems:d.items?.length||0}));
  }
  console.log('EN_AUDIT=PASS; CMS_WRITES=0');
}finally{await browser.close()}
