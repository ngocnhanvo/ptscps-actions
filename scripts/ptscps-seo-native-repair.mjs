import { chromium } from 'playwright';

const wpOrigin=process.env.WP_ORIGIN;
const clientOrigin=process.env.CLIENT_ORIGIN;
const user=process.env.WP_ADMIN_USERNAME;
const pass=process.env.WP_ADMIN_PASSWORD;
if(!wpOrigin||!clientOrigin||!user||!pass||!/^https:\/\/[^/]+$/.test(wpOrigin)||!/^https:\/\/[^/]+$/.test(clientOrigin))throw Error('PTSCPS_SEO_FIX=BLOCKED: invalid configuration');
const oldOrigin='https://pse.webnvn.com';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1360,height:920}});
async function readConfig(){
  const response=await page.request.get(wpOrigin+'/wp-json/esc-seo-files/v1/public',{headers:{'Cache-Control':'no-cache'},timeout:30000});
  if(!response.ok())throw Error('PTSCPS_SEO_FIX=BLOCKED: WordPress SEO API HTTP '+response.status());
  return response.json();
}
try{
  const current=await readConfig();
  if(current?.site!==clientOrigin||current?.sitemap?.mode!=='manual')throw Error('PTSCPS_SEO_FIX=BLOCKED: site or sitemap mode changed');
  const xml=String(current.sitemap.xml||'');
  const locs=[...xml.matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(m=>m[1].trim());
  if(locs.length!==1||locs[0]!==oldOrigin+'/')throw Error('PTSCPS_SEO_FIX=BLOCKED: manual sitemap does not match verified single old-host URL');
  if(xml.split(oldOrigin+'/').length!==2)throw Error('PTSCPS_SEO_FIX=BLOCKED: unexpected multiple old origins');
  const replacement=xml.replace(oldOrigin+'/',clientOrigin+'/');
  if(replacement===xml||replacement.includes(oldOrigin))throw Error('PTSCPS_SEO_FIX=BLOCKED: cannot safely transform sitemap');

  await page.goto(wpOrigin+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([
    page.waitForURL(url=>url.origin===wpOrigin&&url.pathname.startsWith('/wp-admin/'),{timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(wpOrigin+'/wp-admin/options-general.php?page=esc-seo-files&tab=sitemap',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#esc-seo-xml').waitFor({state:'attached',timeout:25000});
  const editorValue=await page.locator('#esc-seo-xml').inputValue();
  if(editorValue.trim()!==xml.trim())throw Error('PTSCPS_SEO_FIX=BLOCKED: UI form differs from public REST; refusing overwrite');
  await page.locator('input[name="sitemap_mode"][value="manual"]').check();
  await page.locator('#esc-seo-xml').fill(replacement);
  const form=page.locator('form:has(input[name="action"][value="esc_seo_files_save"])');
  const submit=form.locator('input[type="submit"]');
  const navigation=page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000});
  await submit.click();
  const response=await navigation;
  const status=response?.status()||0;
  const url=page.url();
  if(status!==200||!url.includes('updated=1')){
    const msg=(await page.locator('body').innerText()).slice(0,450).replace(/\s+/g,' ');
    throw Error('PTSCPS_SEO_FIX=BLOCKED: WordPress save rejected HTTP '+status+'; '+msg);
  }
  const saved=await readConfig();
  const newLocs=[...String(saved?.sitemap?.xml||'').matchAll(/<loc>\s*([^<]+)\s*<\/loc>/g)].map(m=>m[1].trim());
  if(saved.site!==clientOrigin||saved.sitemap?.mode!=='manual'||newLocs.length!==1||newLocs[0]!==clientOrigin+'/'||saved.sitemap.revision===current.sitemap.revision)
    throw Error('PTSCPS_SEO_FIX=BLOCKED: read-after-write sitemap/revision mismatch');
  console.log('PTSCPS_SEO_FIX=PASS; single legacy sitemap URL corrected through WordPress and verified');
  console.log('PTSCPS_SEO_REVISION_CHANGED=PASS');

  // Build only through the existing WordPress tool after the CMS fix is verified.
  await page.goto(wpOrigin+'/wp-admin/admin.php?page=vcs-build-trigger',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#vcs-build-btn-main').waitFor({state:'attached',timeout:25000});
  const state=await page.evaluate(()=>({configured:window.vcsBuild?.build_configured,active:window.vcsBuild?.initial_active}));
  if(!(state.configured===true||state.configured===1||state.configured==='1'))throw Error('WP_BUILD=BLOCKED: WordPress Build Website is not configured');
  if(state.active){console.log('WP_BUILD=ALREADY_RUNNING; no duplicate triggered');}
  else {
    await page.locator('#vcs-force-build').check();
    const button=page.locator('#vcs-build-btn-main');
    if(await button.isDisabled())throw Error('WP_BUILD=BLOCKED: WordPress build control disabled');
    const ajax=page.waitForResponse(r=>r.url().startsWith(wpOrigin+'/wp-admin/admin-ajax.php')&&r.request().method()==='POST'&&String(r.request().postData()||'').includes('action=vcs_trigger_build'),{timeout:45000});
    await button.click();
    const result=await (await ajax).json();
    if(!result?.success)throw Error('WP_BUILD=BLOCKED: '+String(result?.data?.message||'WordPress rejected build'));
    console.log('WP_BUILD=TRIGGERED_VIA_NATIVE_WORDPRESS_UI');
  }
}finally{await browser.close();}
