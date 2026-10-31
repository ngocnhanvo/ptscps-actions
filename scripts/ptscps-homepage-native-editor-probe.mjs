import { chromium } from 'playwright';
const root = process.env.WP_ORIGIN;
const username = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!root || !username || !password) throw new Error('Missing WordPress URL or admin credentials');
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1380,height:900}});
const log = (label, value) => console.log(`${label}=${JSON.stringify(value).slice(0,5500)}`);
try {
  await page.goto(root + '/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(username);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);
  if (!page.url().startsWith(root+'/wp-admin/')) throw new Error('Admin authentication not confirmed');
  console.log('PTSCPS_WP_AUTH=PASS');
  for (const [key,path] of [['tablepress_add','/wp-admin/admin.php?page=tablepress&action=add'], ['tablepress_list','/wp-admin/admin.php?page=tablepress'], ['new_page','/wp-admin/post-new.php?post_type=page']]) {
    await page.goto(root+path,{waitUntil:'domcontentloaded',timeout:45000});
    await page.waitForTimeout(1500);
    const result = await page.evaluate(() => ({
      title:document.title,
      headings:[...document.querySelectorAll('h1,h2')].map(e=>e.textContent.trim()).filter(Boolean).slice(0,16),
      inputs:[...document.querySelectorAll('input,textarea,select')].filter(e=>!['hidden','password'].includes(e.type)).slice(0,45).map(e=>({tag:e.tagName,id:e.id,name:e.name,type:e.type,placeholder:e.placeholder,aria:e.getAttribute('aria-label')})),
      buttons:[...document.querySelectorAll('button,input[type=submit],a.button')].slice(0,40).map(e=>({text:(e.innerText||e.value||'').trim().slice(0,90),id:e.id,aria:e.getAttribute('aria-label')})),
      acf:[...document.querySelectorAll('[data-name]')].filter(e=>e.matches('.acf-field')).slice(0,25).map(e=>({name:e.getAttribute('data-name'),type:e.getAttribute('data-type')})),
    }));
    log(`PROBE_${key.toUpperCase()}`,result);
  }
  const response = await page.request.get(root+'/wp-json/tablepress/v1/tables/prefix/home_?per_page=30&page=1');
  log('PTSCPS_TABLES_EXISTING',{status:response.status(),body:(await response.text()).slice(0,1800)});
  console.log('PTSCPS_CMS_ADMIN_PROBE=PASS_READ_ONLY');
} finally { await browser.close(); }
