import { chromium } from 'playwright';
const origin=process.env.WP_ORIGIN;
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if(!origin||!username||!password)throw Error('WordPress configuration missing');
const browser=await chromium.launch({headless:true});
const p=await browser.newPage({viewport:{width:1420,height:960}});
const ids=Array.from({length:6},(_,i)=>'home_0'+i);
try{
 await p.goto(origin+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
 await p.locator('#user_login').fill(username);
 await p.locator('#user_pass').fill(password);
 await Promise.all([p.waitForURL(/\/wp-admin\//,{timeout:45000}),p.locator('#wp-submit').click()]);
 console.log('CMS_AUDIT_AUTH=PASS');
 for(const id of ids){
  const res=await p.request.get(origin+'/wp-json/tablepress/v1/table/'+id);
  if(!res.ok())throw Error('Missing table '+id+' HTTP '+res.status());
  const data=await res.json();
  if(data.id!==id)throw Error('Wrong Table ID '+id);
  const items=Array.isArray(data.items)?data.items:[];
  const raw=Array.isArray(data.data)?data.data:[];
  console.log('CMS_AUDIT_TABLE='+JSON.stringify({id,title:data.title,keys:Object.keys(data).slice(0,25),rows:raw.length,items:items.length,columnKeys:Object.keys(items[0]||{}).slice(0,20),sampleRow:raw[0]?.map(v=>String(v||'').slice(0,55)),hasImage:JSON.stringify(data).includes('<img')}));
 }
 await p.goto(origin+'/wp-admin/post.php?post=82467&action=edit',{waitUntil:'domcontentloaded',timeout:45000});
 const report=await p.evaluate(()=>{
  const ed=window.tinymce?.get('content');
  const content=ed?.getContent?.()||document.querySelector('#content')?.value||'';
  return {id:document.querySelector('#post_ID')?.value,title:document.querySelector('#title')?.value,status:document.querySelector('#post_status')?.value,slug:document.querySelector('#editable-post-name-full')?.textContent?.trim(),key:document.querySelector('[data-name="key"] input[type="text"]')?.value,action:document.querySelector('[data-name="action"] input[type="text"]')?.value,shortcodes:[...content.matchAll(/\[table\s+id=(\S+?)\s*\/\]/g)].map(m=>m[1]),editorImages:(content.match(/<img\b/gi)||[]).length};
 });
 console.log('CMS_AUDIT_PAGE='+JSON.stringify(report));
 if(report.id!=='82467'||report.key!=='home'||report.action!=='HomePage')throw Error('Homepage settings mismatch');
 const seen=new Set(report.shortcodes.map(x=>x.toLowerCase()));
 if(ids.some(id=>!seen.has(id)))throw Error('Home page is missing native inserted section');
 if(report.status!=='draft')throw Error('Home page status is not draft');
 await p.goto(origin+'/wp-admin/admin.php?page=tablepress&action=edit&table_id=home_00',{waitUntil:'domcontentloaded',timeout:45000});
 const controls=await p.evaluate(()=>({
  tableCells:[...document.querySelectorAll('#tablepress-table tbody tr')].slice(0,2).map(tr=>[...tr.querySelectorAll('td')].map(c=>({text:c.textContent?.trim().slice(0,60),cls:c.className,inputs:[...c.querySelectorAll('input,textarea')].slice(0,2).map(x=>({name:x.name,id:x.id}))}))),
  editors:[...document.querySelectorAll('textarea,input')].filter(x=>/cell|table|row|column/i.test(x.id+' '+x.name)).slice(0,22).map(x=>({name:x.name,id:x.id,type:x.type})),
  actionButtons:[...document.querySelectorAll('button,input[type="submit"]')].filter(x=>/save|add|insert|image|row/i.test((x.textContent||x.value||'')+' '+x.id)).slice(0,25).map(x=>({id:x.id,text:(x.textContent||x.value||'').trim().slice(0,60)}))
 }));
 console.log('CMS_AUDIT_TABLE_EDIT_UI='+JSON.stringify(controls).slice(0,7000));
 console.log('CMS_AUDIT=PASS; EXISTING_ASSETS_REUSED=YES; WRITES=0; PAGE_DRAFT=YES');
}finally{await browser.close();}
