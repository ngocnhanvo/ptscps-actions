import { chromium } from 'playwright';

const wp=process.env.WP_ORIGIN;
const front=process.env.FRONT_ORIGIN;
const username=process.env.WP_ADMIN_USERNAME;
const password=process.env.WP_ADMIN_PASSWORD;
if (![wp,front,username,password].every(Boolean)) throw Error('Missing validated WordPress configuration');
const report=(k,v)=>console.log(`NATIVE_MENU_${k}=${JSON.stringify(v)}`);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:900}});
const apiRead=async()=>{
  const r=await page.request.get(`${wp}/wp-json/esc-api/v1/menus?_menu_check=${Date.now()}`,{timeout:25000,headers:{'Cache-Control':'no-cache'}});
  if(!r.ok())throw Error('ESC menu API unavailable');
  const data=await r.json();if(data?.success!==true)throw Error('ESC menu API returned invalid response');
  return data.menus?.Header?.vi || null;
};
const snap=m=>m && ({id:m.id,code:m.code,lang:m.lang,type:m.type,items:(m.items||[]).map(x=>({label:x.label,key:x.key,href:x.href,slug:x.slug,linkMode:x.linkMode,linkType:x.linkType}))});
try {
  const existing=await apiRead();
  report('INITIAL',snap(existing));
  if(existing?.items?.length){report('RESULT','NOOP_EXISTING_HEADER_PRESERVED');}
  else {
    const pagesRes=await page.request.get(`${wp}/wp-json/wp/v2/pages?per_page=100&status=publish&_fields=id,slug,title`,{timeout:25000});
    if(!pagesRes.ok())throw Error('Cannot verify WordPress published pages');
    const pages=await pagesRes.json();
    const home=pages.find(x=>x.id===82467&&x.slug==='trang-chu'&&String(x.title?.rendered||'').replace(/<[^>]*>/g,'').trim()==='Trang chủ');
    if(!home)throw Error('Published homepage changed; no write');
    const homeResponse=await page.request.get(front+'/',{timeout:25000});
    if(homeResponse.status()!==200)throw Error('Frontend homepage target unavailable; no write');
    await page.goto(`${wp}/wp-login.php`,{waitUntil:'domcontentloaded',timeout:50000});
    await page.locator('#user_login').fill(username);
    await page.locator('#user_pass').fill(password);
    await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
    report('AUTH','PASS');
    const nonceRes=await page.request.post(`${wp}/wp-admin/admin-ajax.php`,{form:{action:'rest-nonce'},timeout:20000});
    const nonce=(await nonceRes.text()).trim();
    if(!nonceRes.ok()||!/^[a-f\d]{8,20}$/i.test(nonce))throw Error(`Core WordPress REST nonce unavailable HTTP=${nonceRes.status()}`);
    const headers={'X-WP-Nonce':nonce,'Cache-Control':'no-cache'};
    const menuListRes=await page.request.get(`${wp}/wp-json/wp/v2/menus?per_page=100`,{headers,timeout:20000});
    if(!menuListRes.ok())throw Error(`Native WP menu list unavailable HTTP=${menuListRes.status()}; no writes`);
    const menuList=await menuListRes.json();
    if(!Array.isArray(menuList))throw Error('Unexpected WordPress native menus REST response; no write');
    report('NATIVE_MENU_LIST',menuList.map(m=>({id:m.id,name:m.name,slug:m.slug,count:m.count})).slice(0,60));
    let selected=menuList.filter(m=>m.name==='Header Tiếng Việt');
    if(selected.length>1)throw Error('Duplicate native WordPress Header menus detected; no write');
    if(selected.length===0){
      if(menuList.some(m=>m.name?.toLowerCase()==='header'||m.name?.toLowerCase()==='header vi'))throw Error('Ambiguous alternate Header menu exists; no write');
      const createRes=await page.request.post(`${wp}/wp-json/wp/v2/menus`,{headers,data:{name:'Header Tiếng Việt',description:'Menu Header tiếng Việt cho frontend Astro'},timeout:25000});
      const created=await createRes.json().catch(()=>({}));
      if(!createRes.ok()||!created.id)throw Error(`Native WP REST menu create rejected HTTP=${createRes.status()} code=${created.code||'unknown'}`);
      selected=[created];report('CREATED_MENU_ID',created.id);
    }else report('REUSE_MENU_ID',selected[0].id);
    const menuId=Number(selected[0].id);
    if(!Number.isInteger(menuId)||menuId<=0)throw Error('Invalid menu ID');
    let escMenu=await apiRead();
    if(!escMenu){
      await page.goto(`${wp}/wp-admin/nav-menus.php?menu=${menuId}`,{waitUntil:'domcontentloaded',timeout:30000});
      const nativeForm=await page.evaluate((id)=>{
        const f=document.querySelector('form#update-nav-menu');
        const code=document.querySelector('#esc-menu-code');
        const lang=document.querySelector('#esc-menu-lang');
        const type=document.querySelector('#esc-menu-type');
        const menu=document.querySelector('#update-nav-menu input[name="menu"]');
        return {present:!!(f&&code&&lang&&type&&menu),menuId:menu?.value,validLang:[...(lang?.options||[])].some(o=>o.value==='vi'),nonce:[...(f?.elements||[])].some(n=>/nonce/i.test(n.name||''))};
      },menuId);
      report('WORDPRESS_EDIT_FORM',nativeForm);
      if(!nativeForm.present||!nativeForm.validLang||!nativeForm.nonce||Number(nativeForm.menuId)!==menuId)throw Error('Native WordPress edit form safety check failed; no metadata write');
      await page.evaluate(()=>{
        const form=document.querySelector('form#update-nav-menu');
        const fields=document.querySelector('#esc-menu-identity-fields');
        if(!form.contains(fields))form.appendChild(fields);
        form.querySelector('#esc-menu-code').value='Header';
        form.querySelector('#esc-menu-lang').value='vi';
        form.querySelector('#esc-menu-type').value='dropdown';
        const action=form.querySelector('input[name="action"]');
        if(!action)throw Error('Native WordPress action input missing');
        action.value='update';
        const save=document.createElement('input');save.type='hidden';save.name='save_menu';save.value='Lưu menu';form.appendChild(save);
      });
      const navigation=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:40000});
      await page.evaluate(()=>HTMLFormElement.prototype.submit.call(document.querySelector('form#update-nav-menu')));
      const response=await navigation;
      report('WP_META_SAVE_HTTP',response?.status()||null);
      escMenu=await apiRead();
      report('AFTER_IDENTITY',snap(escMenu));
      if(escMenu?.id!==menuId||escMenu.code!=='Header'||escMenu.lang!=='vi')throw Error('Native menu metadata not visible in ESC API after WordPress save');
    }
    if((escMenu.items||[]).length){
      report('RESULT','NOOP_EXISTING_MENU_ITEMS_PRESERVED');
    } else {
      const createItemRes=await page.request.post(`${wp}/wp-json/wp/v2/menu-items`,{headers,data:{title:'Trang chủ',type:'custom',url:'/',menus:menuId,status:'publish'},timeout:25000});
      const createdItem=await createItemRes.json().catch(()=>({}));
      if(!createItemRes.ok()||!createdItem.id)throw Error(`Native WP REST menu-item creation rejected HTTP=${createItemRes.status()} code=${createdItem.code||'unknown'}`);
      report('CREATED_ITEM_ID',createdItem.id);
      escMenu=await apiRead();
      report('AFTER_ITEM',snap(escMenu));
      if(escMenu?.items?.length!==1||escMenu.items[0].label!=='Trang chủ'||escMenu.items[0].href!=='/'||escMenu.items[0].linkType!=='internal')throw Error('ESC menu readback after native item creation failed');
      report('RESULT','PASS_NATIVE_HEADER_READY_FOR_WP_BUILD');
    }
  }
} finally {await browser.close();}
