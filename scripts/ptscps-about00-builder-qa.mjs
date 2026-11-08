/** Read-only production acceptance for PTSCPS introduction letter ESC Table. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(path.resolve('.qa/package.json'));
const { chromium } = require('playwright');
const wp = process.env.WP_ORIGIN;
const client = process.env.CLIENT_ORIGIN;
assert.equal(wp, 'https://admin-ptscps.thegioihosting.io.vn');
assert.equal(client, 'https://ptscps.thegioihosting.io.vn');
assert(process.env.WP_ADMIN_USERNAME && process.env.WP_ADMIN_PASSWORD);
const browser = await chromium.launch({headless:true});
const context = await browser.newContext({viewport:{width:1440,height:900}});
const page = await context.newPage();
page.setDefaultTimeout(20000);
try {
  await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await page.locator('#wp-submit').click();
  await page.waitForURL(url=>url.origin===wp && url.pathname.startsWith('/wp-admin/'),{timeout:45000});
  await page.goto(wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder',
    {waitUntil:'domcontentloaded',timeout:45000});
  const choices=await page.locator('#esc-vb-page option').evaluateAll(options=>
    options.map(o=>({id:o.value,label:o.textContent.trim()})));
  const letter=choices.find(o=>/thư\s*ngỏ/i.test(o.label));
  assert(letter && /^\d+$/.test(letter.id),'Native WordPress Page picker lacks Thư ngỏ');
  await page.goto(wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page='+letter.id,
    {waitUntil:'domcontentloaded',timeout:45000});
  const iframe=page.locator('#esc-vb-frame');
  await iframe.waitFor({state:'attached'});
  const iframeUrl=new URL(await iframe.getAttribute('src'));
  assert.equal(iframeUrl.origin,client);
  const frame=await iframe.elementHandle().then(h=>h.contentFrame());
  await frame.locator('html.esc-builder-preview').waitFor({state:'attached',timeout:60000});
  const table=frame.locator('[data-tablepress-preview="about_00"]').first();
  await table.waitFor({state:'visible',timeout:60000});
  const markers=await table.locator('[data-esc-builder-cell-row][data-esc-builder-cell-field]').evaluateAll(nodes=>
    nodes.map(node=>({row:node.getAttribute('data-esc-builder-cell-row'),
      field:node.getAttribute('data-esc-builder-cell-field'),text:(node.textContent||'').trim()})));
  assert(markers.some(x=>x.row==='section'&&x.field==='section_title'&&x.text),'Missing hero title coordinate');
  const prose=markers.filter(x=>x.field==='content');
  assert(prose.length>0,'Missing exact row coordinates on letter prose');
  assert(prose.every(x=>/^\d+$/.test(x.row||'')&&x.text),'Invalid letter prose mapping');
  const awardTitles=markers.filter(x=>x.field==='title');
  assert(awardTitles.every(x=>/^\d+$/.test(x.row||'')),'Invalid award title mapping');
  const version=await frame.locator('#esc-vb-region-rules').getAttribute('data-versions');
  const versions=JSON.parse(version||'{}');
  assert(/^[a-f0-9]{64}$/.test(versions.about_00||''),'Missing verified about_00 source version');
  await page.waitForFunction(()=>typeof window.escVBGetTicket==='function');
  const source=await page.evaluate(async ({wp,pageId,version})=>{
    const nonce=window.wpApiSettings?.nonce ||
      document.documentElement.innerHTML.match(/"nonce"\s*:\s*"([a-f0-9]+)"/)?.[1];
    if(!nonce)throw Error('WP REST nonce unavailable');
    const ticket=await window.escVBGetTicket(false);
    const response=await fetch(wp+'/wp-json/esc-builder/v1/editable-text',{
      method:'POST',credentials:'same-origin',cache:'no-store',
      headers:{'Content-Type':'application/json','X-WP-Nonce':nonce},
      body:JSON.stringify({ticket,page_id:Number(pageId),table_id:'about_00',rendered_version:version})
    });
    const data=await response.json();
    return {status:response.status,source:data};
  },{wp,pageId:letter.id,version:versions.about_00});
  assert.equal(source.status,200,'editable-text must read native about_00: '+source.source?.code);
  assert(source.source?.section_title?.editable,'Letter hero title not editable in canonical source');
  for(const item of prose){
    assert(source.source.rows.some(r=>String(r.row)===item.row && r.field==='content' && r.editable),
      'Letter prose coordinate absent or locked: '+item.row);
  }
  const desc=markers.find(x=>x.row==='description'&&x.field==='section_description');
  if(desc) assert(source.source.rows.some(r=>r.field==='section_description'&&r.editable),
    'Letter eyebrow is present but native metadata edit disabled');
  for(const item of awardTitles){
    assert(source.source.rows.some(r=>String(r.row)===item.row && r.field==='title' && r.editable),
      'Award title not editable: '+item.row);
  }
  await table.locator('[data-esc-builder-cell-field="content"]').first().click();
  const inspector=page.locator('#esc-vb-text-editor');
  await inspector.waitFor({state:'visible',timeout:30000});
  // The inspector becomes visible before its authenticated REST read finishes.
  // Wait for the native editor to unlock rather than sampling its loading state.
  try {
    await page.waitForFunction(() => {
      const editor = document.querySelector('#esc-vb-edit-title');
      return editor && !editor.disabled;
    }, null, { timeout: 30000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      caption: document.querySelector('#esc-vb-edit-caption')?.textContent?.slice(0,180),
      feedback: document.querySelector('#esc-vb-edit-feedback')?.textContent?.slice(0,200),
      row: document.querySelector('#esc-vb-edit-row')?.value,
      panel: document.querySelector('#esc-vb-text-editor')?.style.display,
    }));
    throw new Error('Letter paragraph editor did not unlock: '+JSON.stringify(state), {cause:error});
  }
  const current=await inspector.locator('#esc-vb-edit-row').inputValue();
  assert(current.endsWith(':content'),'Selected ESC row/field does not match clicked letter paragraph');
  const publicPage=await context.newPage();
  const publicResponse=await publicPage.goto(client+'/thu-ngo',
    {waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(publicResponse?.status(),200,'Production /thu-ngo HTTP status');
  assert(await publicPage.locator('[data-tablepress-preview="about_00"]').count()>0,
    'Public letter does not render from ESC Table about_00');
  await publicPage.close();
  console.log('PTSCPS_ABOUT00_BUILDER_QA_PASS=1 prose='+prose.length+
    ' awards='+awardTitles.length+' source=ESC_TABLE click_selection=PASS cms_writes=0');
}finally{
  await browser.close();
}
