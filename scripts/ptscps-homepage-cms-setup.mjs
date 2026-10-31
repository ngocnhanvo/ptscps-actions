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
page.on('dialog', async dialog => {
  if (dialog.type()==='confirm' && /table id|mã bảng/i.test(dialog.message())) {
    report('NATIVE_TABLE_ID_CONFIRM=ACCEPTED');
    await dialog.accept();
  } else {
    report('UNEXPECTED_DIALOG='+dialog.type());
    await dialog.dismiss();
  }
});
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
  const allTables = await page.request.get(uri('/wp-json/tablepress/v1/tables/prefix/all?per_page=30&page=1'));
  if (!allTables.ok()) throw Error('Cannot read ESC Table list');
  const tableList = await allTables.json();
  const originalIdByName = new Map(tableList.map(t=>[t.title,t.id]));
  for (const spec of specs) {
    if (await existing(spec.id)) { report(spec.id,'EXISTS'); continue; }
    const existingOldId = originalIdByName.get(spec.title);
    if (existingOldId) {
      report(spec.id,'RECOVER_EXISTING_TABLE_ID='+existingOldId);
      await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=edit&table_id='+encodeURIComponent(existingOldId)),{waitUntil:'domcontentloaded'});
    } else {
      await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'),{waitUntil:'domcontentloaded'});
      await page.locator('input[name="table[name]"]').fill(spec.title);
      await page.locator('textarea[name="table[description]"]').fill('Section quản trị độc lập cho trang chủ PTSC PPS, theo thiết kế duyệt 31/10/2026.');
      await page.locator('input[name="table[rows]"]').fill('2');
      await page.locator('input[name="table[columns]"]').fill(String(spec.columns));
      await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
      await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:50000});
    }
    const newId = await page.locator('#table-id').inputValue();
    report(spec.id,'CURRENT_ID='+newId);
    await page.locator('#table-id').fill(spec.id);
    // The native ESC Table edit UI saves both the table ID and row layout.
    const save = page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
    if (await save.count()<1) {
      report('EDIT_CONTROLS',await page.evaluate(()=>[...document.querySelectorAll('button')].map(e=>({id:e.id,text:e.textContent.trim().slice(0,60)})).filter(x=>x.text).slice(-30)));
      throw Error('Cannot identify native ESC Table Save Changes control');
    }
    const ajaxResult = page.waitForResponse(r=>r.url().includes('admin-ajax.php') && (r.request().postData()||'').includes('tablepress_save_table'),{timeout:18000}).catch(()=>null);
    await save.last().click();
    const saveResponse = await ajaxResult;
    if (saveResponse) {
      const body = await saveResponse.json().catch(()=>null);
      report(spec.id,'SAVE_RESPONSE',body?{success:body.success,message:body.message,table_id:body.table_id,error_details:body.error_details}:saveResponse.status());
    }
    let readBack=false;
    for(let attempt=0;attempt<5;attempt++) {
      await page.waitForTimeout(900);
      if(await existing(spec.id)){readBack=true;break;}
    }
    if (!readBack) throw Error('Native save did not persist table ID '+spec.id);
    report(spec.id,'CREATED_AND_READBACK=PASS');
  }
  // The page must be authored through Classic Editor and native Insert Code;
  // never create raw shortcode strings using REST, SQL or textarea fill.
  await page.goto(uri('/wp-admin/edit.php?post_type=page&post_status=all&s=Trang+ch%E1%BB%A7'),{waitUntil:'domcontentloaded'});
  const matching = page.locator('a.row-title').filter({hasText:'Trang chủ'});
  const pageMatches = await matching.allTextContents();
  if (pageMatches.filter(s=>s.trim().toLowerCase()==='trang chủ').length > 1) throw Error('Multiple homepage Pages exist; refusing ambiguous edit');
  if (pageMatches.some(s=>s.trim().toLowerCase()==='trang chủ')) {
    await matching.first().click();
    await page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:30000});
    report('REUSING_EXISTING_PAGE_ID='+await page.locator('#post_ID').inputValue());
  } else {
    await page.goto(uri('/wp-admin/post-new.php?post_type=page'),{waitUntil:'domcontentloaded'});
    report('CREATING_NEW_PAGE_DRAFT');
  }
  // Existing autogenerated drafts must be inspected, not mistaken for finished work.
  const prevContent = await page.locator('#content').inputValue();
  const previouslyKnown = specs.some(s=>prevContent.includes(s.id));
  if (prevContent.trim() && !previouslyKnown) throw Error('Existing page contains unrelated content; refusing overwrite');
  {
    await page.locator('#title').fill('Trang chủ');
    const key = details('key');
    const action = details('action');
    const acfNames = await page.locator('.acf-field[data-name]').evaluateAll(els=>els.map(e=>e.getAttribute('data-name')));
    report('ACF_NAMES',acfNames);
    if (await key.count()<1 || await action.count()<1) throw Error('Missing required WordPress Page ACF key/action controls');
    await key.locator('input[type="text"]').fill('home');
    await action.locator('input[type="text"]').fill('HomePage');
    // Native ESC Table picker is provided by the plugin in the Classic Editor.
    // The native Classic Editor toolbar has both a Text-mode Quicktag and
    // a Visual-mode TinyMCE button. Select through the plugin's picker only.
    const visualTab = page.locator('#content-tmce');
    if (await visualTab.count()) await visualTab.click();
    const currentEditorContent = async () => page.evaluate(() => {
      const ed=window.tinymce?.get('content');
      return (ed?.getContent?.() || '') + '\n' + (document.querySelector('#content')?.value || '');
    });
    await page.waitForFunction(() => Boolean(window.tinymce?.get('content')?.initialized && !window.tinymce?.get('content')?.isHidden()), null, {timeout:20000});
    for (const spec of specs) {
      if ((await currentEditorContent()).includes(spec.id)) { report(spec.id,'ALREADY_INSERTED'); continue; }
      await page.evaluate(() => {
        const ed=window.tinymce?.get('content');
        if(ed && !ed.isHidden()) { ed.focus(); ed.selection.select(ed.getBody(), true); ed.selection.collapse(false); }
      });
      const visualButton = page.locator('button[aria-label*="ESC Table"],button[title*="ESC Table"]').first();
      const quickTag = page.locator('#qt_content_tablepress_quicktags_button');
      if (await visualButton.count() && await visualButton.isVisible()) await visualButton.click();
      else if (await quickTag.isVisible()) await quickTag.click();
      else {
        // Open the plugin's actual native Insert Code picker; no shortcode is injected.
        await page.evaluate(() => {
          if(typeof window.tablepress_open_shortcode_thickbox !== 'function') throw Error('Native ESC Table picker unavailable');
          window.tablepress_open_shortcode_thickbox();
        });
      }
      const iframe = page.frameLocator('#TB_iframeContent');
      const rowButton = iframe.locator(`input.insert-shortcode[title*="${spec.id}"]`);
      await rowButton.waitFor({state:'visible',timeout:20000});
      await rowButton.click();
      let nativeInserted = false;
      for (let attempt = 0; attempt < 8; attempt++) {
        await page.waitForTimeout(600);
        if ((await currentEditorContent()).includes(spec.id)) { nativeInserted = true; break; }
      }
      if (!nativeInserted) {
        const diagnosis = await page.evaluate(() => ({
          active: window.tinymce?.activeEditor?.id || '(none)',
          content: String(window.tinymce?.get('content')?.getContent?.() || '').slice(0,350),
          textarea: String(document.querySelector('#content')?.value || '').slice(0,350),
          editors: (window.tinymce?.editors || []).map(e => ({id:e.id,initialized:e.initialized,hidden:e.isHidden?.(),contentLength:(e.getContent?.()||'').length,containsTable:(e.getContent?.()||'').includes('home_00')})),
          thickboxVisible: Boolean(document.querySelector('#TB_window')?.offsetParent),
          sendToEditor:typeof window.send_to_editor
        }));
        report(spec.id,'NATIVE_PICKER_DIAGNOSIS',diagnosis);
        throw Error('Native Insert Code did not appear in Page content for '+spec.id);
      }
      report(spec.id,'NATIVE_INSERT_CODE=PASS');
    }
    // Switching via the native tab synchronizes TinyMCE content to the textarea.
    const textTab = page.locator('#content-html');
    if(await textTab.count()) await textTab.click();
    const content = await page.locator('#content').inputValue();
    for (const spec of specs) if (!content.includes(spec.id)) throw Error('Page missing section '+spec.id);
    await page.locator('#save-post').click(); // DRAFT, never Publish.
    await page.waitForTimeout(1600);
    const postId = await page.locator('#post_ID').inputValue();
    if (!/^\d+$/.test(postId)) throw Error('WordPress did not return a saved Page ID');
    await page.goto(uri('/wp-admin/post.php?post='+postId+'&action=edit'),{waitUntil:'domcontentloaded'});
    const reread = await page.locator('#content').inputValue();
    const missing = specs.filter(s=>!reread.includes(s.id)).map(s=>s.id);
    if (missing.length) throw Error('Read-after-save missing native ESC sections: '+missing.join(','));
    const savedKey = await page.locator('[data-name="key"] input[type="text"]').inputValue();
    const savedAction = await page.locator('[data-name="action"] input[type="text"]').inputValue();
    if(savedKey!=='home'||savedAction!=='HomePage') throw Error('WordPress Page ACF read-after-write mismatch');
    report('PAGE_DRAFT_SAVED_AND_REREAD_ID='+postId);
    report('PAGE_ESC_SECTIONS_ORDER='+specs.map(s=>s.id).join(','));
  }
  for (const spec of specs) if (!await existing(spec.id)) throw Error('Read-after-write missing '+spec.id);
  report('CMS_HOME_TABLES=6; PAGE_DRAFT_CHECKED=YES; MIGRATION_IMPORT=NO; PUBLICATION=NO');
} finally { await browser.close(); }
