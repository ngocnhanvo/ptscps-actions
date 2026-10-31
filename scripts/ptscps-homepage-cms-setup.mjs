import { chromium } from 'playwright';
const origin = process.env.WP_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const password = process.env.WP_ADMIN_PASSWORD;
if (!origin || !user || !password) throw Error('Missing configured WordPress credentials');
const specs = [
  {id:'home_00',title:'Trang chủ — Banner chính', columns:8, keys:['eyebrow','title','description','image','primary_label','primary_href','secondary_label','secondary_href']},
  {id:'home_01',title:'Trang chủ — Lĩnh vực hoạt động',columns:6,keys:['title','description','image','icon','link','label']},
  {id:'home_02',title:'Trang chủ — Giới thiệu PPS',columns:5,keys:['title','description','image','button_text','href']},
  {id:'home_03',title:'Trang chủ — Giá trị hoạt động',columns:3,keys:['title','description','icon']},
  {id:'home_04',title:'Trang chủ — Dự án tiêu biểu',columns:5,keys:['title','description','image','link','date']},
  {id:'home_05',title:'Trang chủ — Tin tức',columns:5,keys:['title','description','image','link','date']},
];
const browser = await chromium.launch({headless:true});
const page = await browser.newPage({viewport:{width:1420,height:960}});
const uri = p => origin+p;
const report = (...args)=>console.log('CMS_SETUP',...args);
const existing = async id => {
  const r = await page.request.get(uri('/wp-json/tablepress/v1/table/'+id));
  if (r.status()===404) return false;
  if (!r.ok()) throw Error('Table REST status '+r.status()+' for '+id);
  const t=await r.json(); return t?.id===id;
};
const details = name => page.locator(`[data-name="${name}"]`).first();
try {
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(password);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  report('ADMIN_AUTH=PASS');
  const initial = await page.request.get(uri('/wp-json/tablepress/v1/tables/prefix/home_?per_page=30&page=1'));
  if (!initial.ok()) throw Error('Cannot read existing ESC Tables');
  const initialTables = await initial.json();
  report('EXISTING_TABLE_COUNT='+initialTables.length);
  for (const spec of specs) {
    if (await existing(spec.id)) { report(spec.id,'EXISTS'); continue; }
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'),{waitUntil:'domcontentloaded'});
    await page.locator('input[name="table[name]"]').fill(spec.title);
    await page.locator('textarea[name="table[description]"]').fill('Section quản trị độc lập cho trang chủ PTSC PPS, theo thiết kế duyệt 31/10/2026.');
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill(String(spec.columns));
    await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:50000});
    const newId = await page.locator('#table-id').inputValue();
    report(spec.id,'NEW_ID='+newId);
    await page.locator('#table-id').fill(spec.id);
    // The native ESC Table edit UI saves both the table ID and row layout.
    const save = page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
    if (await save.count()<1) {
      report('EDIT_CONTROLS',await page.evaluate(()=>[...document.querySelectorAll('button')].map(e=>({id:e.id,text:e.textContent.trim().slice(0,60)})).filter(x=>x.text).slice(-30)));
      throw Error('Cannot identify native ESC Table Save Changes control');
    }
    await save.last().click();
    await page.waitForTimeout(1800);
    if (!await existing(spec.id)) throw Error('Native save did not persist table ID '+spec.id);
    report(spec.id,'CREATED_AND_READBACK=PASS');
  }
  // The page must be authored through Classic Editor and native Insert Code;
  // never create raw shortcode strings using REST, SQL or textarea fill.
  await page.goto(uri('/wp-admin/edit.php?post_type=page&post_status=all&s=Trang+ch%E1%BB%A7'),{waitUntil:'domcontentloaded'});
  const oldPages = await page.locator('a.row-title').allTextContents();
  if (oldPages.some(s=>s.trim().toLowerCase()==='trang chủ')) {
    report('PAGE=EXISTS; no duplicate created');
  } else {
    await page.goto(uri('/wp-admin/post-new.php?post_type=page'),{waitUntil:'domcontentloaded'});
    await page.locator('#title').fill('Trang chủ');
    const key = details('key');
    const action = details('action');
    const acfNames = await page.locator('.acf-field[data-name]').evaluateAll(els=>els.map(e=>e.getAttribute('data-name')));
    report('ACF_NAMES',acfNames);
    if (await key.count()<1 || await action.count()<1) throw Error('Missing required WordPress Page ACF key/action controls');
    await key.locator('input[type="text"]').fill('home');
    await action.locator('input[type="text"]').fill('HomePage');
    // Native ESC Table picker is provided by the plugin in the Classic Editor.
    const switchToText = page.locator('#content-html');
    if(await switchToText.count()>0) await switchToText.click();
    for (const spec of specs) {
      const quickTag = page.locator('#qt_content_tablepress_quicktags_button');
      if (!await quickTag.count()) throw Error('Native ESC Table Insert Code button unavailable');
      await page.locator('#content').focus();
      await page.locator('#content').press('ControlOrMeta+End');
      await quickTag.click();
      const iframe = page.frameLocator('#TB_iframeContent');
      const rowButton = iframe.locator(`a.insert-shortcode[title*="${spec.id}"]`);
      await rowButton.waitFor({state:'visible',timeout:20000});
      await rowButton.click();
      await page.waitForTimeout(450);
      const content = await page.locator('#content').inputValue();
      if (!content.includes(spec.id)) throw Error('Native Insert Code failed for '+spec.id);
      await page.locator('#content').press('End');
      await page.locator('#content').press('Enter');
      report(spec.id,'NATIVE_INSERT_CODE=PASS');
    }
    const content = await page.locator('#content').inputValue();
    for (const spec of specs) if (!content.includes(spec.id)) throw Error('Page missing section '+spec.id);
    await page.locator('#save-post').click(); // DRAFT, no public content publication.
    await page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:50000});
    const postId = await page.locator('#post_ID').inputValue();
    report('PAGE_DRAFT_SAVED_ID='+postId);
  }
  for (const spec of specs) if (!await existing(spec.id)) throw Error('Read-after-write missing '+spec.id);
  report('CMS_HOME_TABLES=6; PAGE_DRAFT_CHECKED=YES; MIGRATION_IMPORT=NO; PUBLICATION=NO');
} finally { await browser.close(); }
