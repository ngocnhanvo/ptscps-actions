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
  for (const test of [
    { label: /giới\s*thiệu\s*công\s*ty/i, table:'about_01', url:'/gioi-thieu-cong-ty', fields:['title','content'] },
    { label: /ban\s+lãnh\s+đạo/i, table:'about_02', url:'/ban-lanh-dao', fields:['title','meta','group'] },
    { label: /quá\s+trình\s+phát\s+triển/i, table:'about_03', url:'/qua-trinh-phat-trien', fields:['content','meta','title'] },
    { label: /định\s+hướng\s+phát\s+triển/i, table:'about_04', url:'/dinh-huong-phat-trien', fields:['content'] },
  ]) {
    const choice = choices.find(option=>test.label.test(option.label));
    assert(choice && /^\d+$/.test(choice.id),'Missing WordPress Page '+test.url);
    await page.goto(wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page='+choice.id,
      {waitUntil:'domcontentloaded',timeout:45000});
    const pane = await page.locator('#esc-vb-frame').elementHandle().then(handle=>handle.contentFrame());
    await pane.locator('html.esc-builder-preview').waitFor({state:'attached',timeout:60000});
    const wrapper = pane.locator('[data-tablepress-preview="'+test.table+'"]').first();
    await wrapper.waitFor({state:'visible',timeout:60000});
    const elements = await wrapper.locator('[data-esc-builder-cell-row][data-esc-builder-cell-field]')
      .evaluateAll(nodes=>nodes.map(node=>({
        row:node.getAttribute('data-esc-builder-cell-row'),
        field:node.getAttribute('data-esc-builder-cell-field'),
        text:(node.textContent||'').trim()
      })).filter(item=>item.text));
    assert(elements.some(item=>item.row==='section'&&item.field==='section_title'),
      'Missing source-bound heading '+test.table);
    const matching=elements.filter(item=>test.fields.includes(item.field)&&/^\d+$/.test(item.row||''));
    assert(matching.length>0,'No row-bound content for '+test.table);
    if(test.table==='about_01') {
      const headings=wrapper.locator('h3');
      assert(await headings.count()>0,'Company introduction lacks service cards');
      assert.equal(await headings.count(),await wrapper.locator('h3[data-esc-builder-cell-field="title"][data-esc-builder-cell-row]').count(),
        'Company service title lacks source cell coordinate');
      assert.equal(await wrapper.locator('p').count(),await wrapper.locator('p[data-esc-builder-cell-row][data-esc-builder-cell-field]').count(),
        'Company visible paragraph lacks source cell coordinate');
      assert(await wrapper.locator('h2[data-esc-builder-cell-field="title"][data-esc-builder-cell-row]').count()>0,'Company section heading not mapped');
    }
    const foundVersion=JSON.parse(await pane.locator('#esc-vb-region-rules').getAttribute('data-versions')||'{}')[test.table];
    assert(/^[a-f0-9]{64}$/.test(foundVersion||''),'Missing source version for '+test.table);
    const response=await page.evaluate(async({wp,pageId,tableId,foundVersion})=>{
      const nonce=window.wpApiSettings?.nonce||document.documentElement.innerHTML.match(/"nonce"\s*:\s*"([a-f0-9]+)"/)?.[1];
      const ticket=await window.escVBGetTicket(false);
      const res=await fetch(wp+'/wp-json/esc-builder/v1/editable-text',{
        method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-WP-Nonce':nonce},
        body:JSON.stringify({ticket,page_id:Number(pageId),table_id:tableId,rendered_version:foundVersion})
      });
      return {status:res.status,data:await res.json()};
    },{wp,pageId:choice.id,tableId:test.table,foundVersion});
    assert.equal(response.status,200,'Native REST editable-text failed '+test.table);
    assert(response.data.section_title?.editable,'Hero title not editable '+test.table);
    const canEdit=matching.find(item=>response.data.rows.some(row=>String(row.row)===item.row&&row.field===item.field&&row.editable));
    assert(canEdit,'No editable source row for '+test.table);
    await wrapper.locator('[data-esc-builder-cell-row="'+canEdit.row+'"][data-esc-builder-cell-field="'+canEdit.field+'"]').first().click();
    await page.waitForFunction(()=>{
      const el=document.querySelector('#esc-vb-edit-title');return el&&!el.disabled;
    },null,{timeout:30000});
    const publicDetail=await context.newPage();
    const load=await publicDetail.goto(client+test.url,{waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(load?.status(),200,'Public route missing '+test.url);
    assert(await publicDetail.locator('[data-tablepress-preview="'+test.table+'"]').count()>0,
      'Public page no longer has canonical '+test.table);
    await publicDetail.close();
    console.log('PTSCPS_ABOUT_BUILDER_PASS table='+test.table+' editable_rows='+matching.length+' cms_writes=0');
  }
  const servicePage = choices.find(option=>/^dịch\s*vụ$/i.test(option.label));
  assert(servicePage && /^\d+$/.test(servicePage.id),'Native Page picker lacks root Dịch vụ');
  const categories = [
    'dich-vu-sua-chua-bao-duong-cac-thiet-bi-va-cong-trinh-cong-nghiep',
    'van-hanh-va-bao-duong-fpso-fso-mopu',
    'dich-vu-thiet-ke-mua-sam-gia-cong-che-tao',
    'cung-ung-nhan-luc-ky-thuat-van-hanh-va-bao-duong',
  ];
  const categoryIndex = await context.newPage();
  const indexResponse = await categoryIndex.goto(client+'/dich-vu',
    {waitUntil:'domcontentloaded',timeout:45000});
  assert.equal(indexResponse?.status(),200,'Public services landing not HTTP 200');
  assert(await categoryIndex.locator('[data-tablepress-preview="services_00_vi"]').count()>0,
    'Services landing missing canonical ESC Table services_00_vi');
  const indexHeading=categoryIndex.locator('[data-tablepress-preview="services_00_vi"] h1').first();
  assert.equal(await indexHeading.getAttribute('data-esc-builder-cell-row'),'section',
    'Services index heading is not bound to ESC Table section metadata');
  assert.equal(await indexHeading.getAttribute('data-esc-builder-cell-field'),'section_title',
    'Services index heading must be editable as section_title');
  await categoryIndex.close();
  const previewResponses=[];
  page.on('response',response=>{
    if (!response.url().startsWith(client+'/esc-builder/preview/')) return;
    const u=new URL(response.url());
    previewResponses.push({category:u.searchParams.get('category'),status:response.status()});
  });
  for (const slug of categories) {
    const tableId='pub_service_'+slug;
    const url=wp+'/wp-admin/edit.php?post_type=page&page=esc-visual-builder&esc_vb_page='+
      servicePage.id+'&esc_vb_category='+encodeURIComponent(slug);
    await page.goto(url,{waitUntil:'domcontentloaded',timeout:45000});
    const option=page.locator('#esc-vb-category option[value="'+slug+'"]');
    const dropdownOptions=await page.locator('#esc-vb-category option').evaluateAll(nodes=>nodes.map(node=>({value:node.value,label:node.textContent?.trim()})));
    assert.equal(await option.count(),1,'Service category missing in Builder dropdown: '+JSON.stringify({slug,servicePage,dropdownOptions,pageMatches:choices.filter(item=>/^dịch\s*vụ$/i.test(item.label))}));
    assert.equal(await page.locator('#esc-vb-category').inputValue(),slug,
      'Builder category selection mismatch: '+slug);
    const iframe=page.locator('#esc-vb-frame');
    const frameUrl=new URL(await iframe.getAttribute('src'));
    assert.equal(frameUrl.searchParams.get('category'),slug,
      'Private Builder preview lost service category: '+slug);
    const serviceFrame=await iframe.elementHandle().then(handle=>handle.contentFrame());
    try {
      await serviceFrame.locator('html.esc-builder-preview').waitFor({state:'attached',timeout:60000});
    } catch(error) {
      const frameText=await serviceFrame.locator('body').innerText({timeout:2500}).catch(()=>'');
      let framePath='';
      try { framePath=new URL(serviceFrame.url()).pathname; } catch {}
      console.log('PTSCPS_SERVICE_PREVIEW_DIAGNOSTIC='+JSON.stringify({
        slug,framePath,bodyExcerpt:frameText.replace(/\s+/g,' ').slice(0,160),
        responses:previewResponses.filter(item=>item.category===slug),
      }));
      throw error;
    }
    const detail=serviceFrame.locator('[data-tablepress-preview="'+tableId+'"]').first();
    await detail.waitFor({state:'visible',timeout:60000});
    const markers=await detail.locator('[data-esc-builder-cell-row][data-esc-builder-cell-field]')
      .evaluateAll(nodes=>nodes.map(node=>({
        row:node.getAttribute('data-esc-builder-cell-row'),
        field:node.getAttribute('data-esc-builder-cell-field'),
        text:(node.textContent||'').trim()
      })).filter(item=>/^\d+$/.test(item.row||'')&&item.text));
    assert(markers.length>0,'Service detail has no source cell coordinates: '+slug);
    const versions=JSON.parse(await serviceFrame.locator('#esc-vb-region-rules')
      .getAttribute('data-versions')||'{}');
    const version=versions[tableId];
    assert(/^[a-f0-9]{64}$/.test(version||''),'Missing canonical service table version: '+tableId);
    await page.waitForFunction(()=>typeof window.escVBGetTicket==='function');
    const response=await page.evaluate(async({wp,pageId,tableId,version,slug})=>{
      const nonce=window.wpApiSettings?.nonce||
        document.documentElement.innerHTML.match(/"nonce"\s*:\s*"([a-f0-9]+)"/)?.[1];
      const ticket=await window.escVBGetTicket(false);
      const request=await fetch(wp+'/wp-json/esc-builder/v1/editable-text',{
        method:'POST',credentials:'same-origin',cache:'no-store',
        headers:{'Content-Type':'application/json','X-WP-Nonce':nonce},
        body:JSON.stringify({ticket,page_id:Number(pageId),table_id:tableId,
          rendered_version:version,category:slug})
      });
      return {status:request.status,body:await request.json()};
    },{wp,pageId:servicePage.id,tableId,version,slug});
    assert.equal(response.status,200,'Native source rejected '+tableId+': '+response.body?.code);
    const selected=markers.find(item=>response.body?.rows?.some(row=>
      String(row.row)===item.row&&row.field===item.field&&row.editable));
    assert(selected,'Service detail has no editable native cell: '+tableId);
    await detail.locator('[data-esc-builder-cell-row="'+selected.row+'"]'+
      '[data-esc-builder-cell-field="'+selected.field+'"]').first().click();
    await page.waitForFunction(()=>{
      const editor=document.querySelector('#esc-vb-edit-title');
      return editor&&!editor.disabled;
    },null,{timeout:30000});
    assert.equal(await page.locator('#esc-vb-edit-row').inputValue(),
      selected.row+':'+selected.field,'Service detail selection drifted: '+tableId);
    const publicDetail=await context.newPage();
    const publicResponse=await publicDetail.goto(client+'/dich-vu/'+slug,
      {waitUntil:'domcontentloaded',timeout:45000});
    assert.equal(publicResponse?.status(),200,'Service route not HTTP 200: '+slug);
    assert(await publicDetail.locator('[data-service-detail-content]').count()>0,
      'Service detail content missing from public route: '+slug);
    await publicDetail.close();
    console.log('PTSCPS_SERVICE_DETAIL_BUILDER_PASS='+tableId+
      ' cells='+markers.length+' source=ESC_TABLE cms_writes=0');
  }
  console.log('PTSCPS_ABOUT00_BUILDER_QA_PASS=1 prose='+prose.length+
    ' awards='+awardTitles.length+' source=ESC_TABLE click_selection=PASS cms_writes=0');
}finally{
  await browser.close();
}
