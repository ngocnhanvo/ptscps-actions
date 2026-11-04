import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
assert(wp && front && user && pass, 'Missing configured PTSCPS origins or WordPress admin credentials');
const target = { id: 'about_00_en', slug: 'top-message', title: 'Top Message', key: 'about-letter', description: 'ABOUT US' };
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();
const uri = path => wp + path;
const pageFields = ['key','action','product_lang','origin_page_id'];
const readTable = async id => {
  const response = await page.request.get(uri(`/wp-json/tablepress/v1/table/${id}`), { timeout: 30000, headers: { 'Cache-Control': 'no-cache' } });
  if (response.status() === 404) return null;
  assert(response.ok(), `TablePress ${id} HTTP ${response.status()}`);
  return response.json();
};
const clean = value => String(value ?? '').replace(/<[^>]+>/g, '').trim();

async function getOriginal() {
  const res = await page.request.get(uri('/wp-json/wp/v2/pages?slug=thu-ngo&status=publish&per_page=20&_fields=id,slug,status,acf,content'), { timeout: 30000 });
  assert(res.ok(), 'Vietnamese original page unavailable');
  const pages = await res.json();
  assert(pages.length === 1 && (pages[0].acf?.product_lang?.value || pages[0].acf?.product_lang) === 'vi', 'Expected exactly one Vietnamese original');
  const table = await readTable('about_00');
  const fields = table?.fields?.map(field => String(field.key || '')) || [];
  assert.deepEqual(fields, ['type','group','title','content','meta','href','img'], 'Vietnamese source TablePress schema changed');
  const awards = (table.items || []).filter(row => row.type === 'award');
  assert(awards.length === 2 && awards.every(row => /<img\b/i.test(String(row.img || ''))), 'Source award images are missing');
  for (const award of awards) {
    const src = /\bsrc=["']([^"']+)["']/i.exec(String(award.img || ''))?.[1] || '';
    const mediaUrl = new URL(src, wp);
    assert(mediaUrl.origin === wp && mediaUrl.pathname.startsWith('/wp-content/uploads/'), 'Source award image is not a local Media Library asset');
  }
  console.log('EN_TOP_SOURCE=PASS original_id=' + pages[0].id + ' awards=2');
  return { original: pages[0], source: table, awards };
}
function translatedRows(awards) {
  // Native Insert Image can store the WordPress admin origin; output a relative
  // media path so the Astro build localizes the asset instead of leaking it.
  const image = (award, title) => {
    const src = /\bsrc=["']([^"']+)["']/i.exec(String(award.img))?.[1] || '';
    const parsed = new URL(src, wp);
    assert(parsed.origin === wp && parsed.pathname.startsWith('/wp-content/uploads/'), 'Award image escaped Media Library');
    return `<img src="${parsed.pathname}${parsed.search}" alt="${title} - PTSC PPS">`;
  };
  return [
    ['prose','','','Over nearly 25 years of development alongside PetroVietnam Technical Services Corporation (PTSC) and the Vietnam National Industry–Energy Group, PTSC Production Services JSC has successfully delivered safe and efficient operation and maintenance services for FPSO/FSO projects in Vietnam and the region.','','',''],
    ['prose','','','Our mission is to provide operation and maintenance services of the highest quality, with safety and efficiency at the forefront of everything we do, earning the recognition and trust of our clients.','','',''],
    ['prose','','','As the oil and gas industry faces new challenges and global demand for energy continues to grow, we remain committed to building on our experience and established values. We strive to maintain our leading position in FPSO/FSO operation and maintenance services in Vietnam while expanding into new areas in line with the development strategies of PTSC and the Vietnam National Industry–Energy Group.','','',''],
    ['award','','Prime Minister’s Certificate of Merit','','2010','',image(awards[0], 'Prime Minister’s Certificate of Merit')],
    ['award','','Third-Class Labor Medal','','2012','',image(awards[1], 'Third-Class Labor Medal')],
  ];
}
async function nativeSaveTable() {
  const save = page.getByRole('button', { name: /^(Save Changes|Lưu thay đổi)$/i });
  assert(await save.count() > 0, 'TablePress Save Changes unavailable');
  await save.last().click();
}
async function ensureTable(sourceAwards) {
  const rows = translatedRows(sourceAwards);
  let existing = await readTable(target.id);
  if (existing?.items?.length) {
    assert(existing.items.length === rows.length, 'Existing English sample table has unexpected rows; no overwrite');
    assert(existing.fields?.map(f => f.key).join(',') === 'type,group,title,content,meta,href,img', 'Existing English sample schema differs');
    assert(existing.items.every((item, i) => item.type === rows[i][0] && item.content === rows[i][3] && item.title === rows[i][2]), 'Existing English sample content differs; refusing overwrite');
    assert(existing.items.filter(item => item.type === 'award').every(item => /<img\b/i.test(String(item.img || ''))), 'Existing English sample award media missing');
    console.log('EN_TOP_TABLE=ALREADY_PRESENT_VERIFIED_SKIP_WRITE');
    return;
  }
  if (!existing) {
    const allResponse = await page.request.get(uri('/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1'), { timeout: 30000 });
    assert(allResponse.ok(), 'Unable to inspect existing TablePress tables');
    const candidates = (await allResponse.json()).filter(row => String(row.name || row.title || '') === target.title && String(row.id) !== target.id);
    assert(candidates.length === 0, 'Ambiguous preexisting English TablePress draft, refusing duplicate creation');
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'), { waitUntil:'domcontentloaded', timeout:45000 });
    await page.locator('input[name="table[name]"]').fill(target.title);
    await page.locator('textarea[name="table[description]"]').fill(target.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill('7');
    await page.getByRole('button', { name: /^(Add Table|Thêm bảng)$/i }).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/, { timeout:45000 });
    const currentId = new URL(page.url()).searchParams.get('table_id') || await page.locator('#table-id').inputValue();
    assert(currentId, 'Missing TablePress generated ID');
    let confirmed = false;
    page.once('dialog', async d => { confirmed = true; await d.accept(); });
    await page.locator('#table-id').fill(target.id);
    await page.locator('#table-name').click();
    for (let k = 0; k < 10 && !confirmed; k++) await sleep(100);
    assert(confirmed, 'Native TablePress rename confirmation missing');
    await nativeSaveTable();
    for (let k = 0; k < 12; k++) { await sleep(800); existing = await readTable(target.id); if (existing) break; }
    assert(existing, 'English TablePress ID rename did not persist');
  }
  assert(!existing.items?.length, 'Refusing to overwrite populated English table');
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${target.id}`), { waitUntil:'domcontentloaded', timeout:45000 });
  await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append), null, { timeout:25000 });
  await page.locator('#table-name').fill(target.title);
  await page.locator('#table-description').fill(target.description);
  await page.evaluate(({fields,rows}) => {
    const ed = window.tp.editor;
    assertColumns();
    function assertColumns(){if(ed.options.columns.length !== fields.length)throw Error('English TablePress columns mismatch');}
    const required = rows.length + 2;
    if (ed.options.data.length < required) window.tp.callbacks.append('rows', required - ed.options.data.length);
    if (ed.options.data.length > required) throw Error('Unexpected existing TablePress extra rows');
    const labels = ['Content Type','Group','Title','Content','Additional Info','Link','Image'];
    for(let c=0;c<fields.length;c++) { ed.setValueFromCoords(c,0,fields[c]); ed.setValueFromCoords(c,1,labels[c]); }
    for(let r=0;r<rows.length;r++)for(let c=0;c<fields.length;c++)ed.setValueFromCoords(c,r+2,String(rows[r][c] ?? ''));
    window.tp.helpers.unsaved_changes.set();
  }, { fields:['type','group','title','content','meta','href','img'], rows });
  await nativeSaveTable();
  let saved = null;
  for(let k=0;k<14;k++) { await sleep(850); saved = await readTable(target.id); if(saved?.items?.length === rows.length)break; }
  assert(saved?.items?.length === rows.length, 'TablePress EN data not persisted');
  assert(saved.fields.map(f=>f.key).join(',') === 'type,group,title,content,meta,href,img', 'EN table schema not saved');
  assert(saved.items.filter(x=>x.type==='award').every(x=>/<img\b/i.test(String(x.img||''))), 'English award image cells missing');
  console.log('EN_TOP_TABLE=PASS id='+target.id+' rows='+saved.items.length);
}
async function setAcf(name, value) {
  const field = page.locator(`.acf-field[data-name="${name}"]`).first();
  assert(await field.count(), `ACF ${name} missing`);
  const select = field.locator('select').first();
  if (await select.count()) { await select.selectOption(String(value)); return; }
  const radio = field.locator(`input[type="radio"][value="${String(value)}"]`).first();
  if (await radio.count()) { await radio.check(); return; }
  const input = field.locator('input[type="text"],input[type="number"]').first();
  assert(await input.count(), `ACF ${name} unsupported`);
  await input.fill(String(value));
}
async function ensureTranslationOrigin(original) {
  const field = page.locator('.acf-field[data-name="origin_page_id"]');
  assert(await field.count() === 1, 'Translation origin ACF missing');
  const select = field.locator('select').first();
  if (!await select.count()) return setAcf('origin_page_id', original.id);
  if (String(await select.inputValue()) === String(original.id)) return;
  const picker = field.locator('.select2-selection').first();
  await picker.waitFor({state:'visible',timeout:15000});
  await picker.click();
  const search = page.locator('.select2-container--open input.select2-search__field').first();
  await search.fill('Thư ngỏ');
  const matches = page.locator('.select2-container--open .select2-results__option[role="option"]');
  await matches.first().waitFor({state:'visible',timeout:15000});
  const choice = matches.filter({hasText:'Thư ngỏ'}).first();
  assert(await choice.count(), 'Original Vietnamese Page not in native ACF picker');
  await choice.click();
  assert(String(await select.inputValue()) === String(original.id), 'Wrong WordPress translation origin selected');
}
async function insertNativeShortcode() {
  const visual=page.locator('#content-tmce');
  if(await visual.count()) await visual.click();
  await page.waitForFunction(() => Boolean(window.tinymce?.get('content')?.initialized && !window.tinymce.get('content').isHidden()), null, {timeout:25000});
  const contents = await page.evaluate(() => window.tinymce.get('content').getContent() || '');
  if (contents.includes(target.id)) return;
  assert(!clean(contents), 'Existing English page content is not empty; refusing overwrite');
  await page.evaluate(() => { window.tinymce.get('content').setContent(''); window.tinymce.get('content').focus(); if(window.tb_remove)window.tb_remove(); });
  await page.locator('#TB_iframeContent').waitFor({state:'detached',timeout:10000});
  const picker=page.frameLocator('#TB_iframeContent');
  let ready=false;
  for(let k=0;k<3&&!ready;k++){
    await page.evaluate(() => { if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('Native TablePress Insert Code missing');window.tablepress_open_shortcode_thickbox(); });
    ready=await picker.locator('input.insert-shortcode').first().waitFor({state:'visible',timeout:12000}).then(()=>true).catch(()=>false);
    if(!ready){await page.evaluate(() => window.tb_remove?.()); await page.locator('#TB_iframeContent').waitFor({state:'detached',timeout:12000});}
  }
  assert(ready, 'Native TablePress Insert Code picker did not open');
  const choose=picker.locator(`input.insert-shortcode[title*="${target.id}"]`).first();
  if(!await choose.isVisible().catch(()=>false)){
    const search=picker.locator('input[type="search"],#tablepress-search,#table-search-input,input[name="s"]').first();
    if(await search.count()){await search.fill(target.id);await search.press('Enter');await choose.waitFor({state:'visible',timeout:9000}).catch(()=>null);}
    if(!await choose.isVisible().catch(()=>false)) {
      for(let n=0;n<16&&!await choose.isVisible().catch(()=>false);n++){
        const next=picker.locator('a.next-page,button.next-page').first();
        if(!await next.isVisible().catch(()=>false))break;
        await next.click();await choose.waitFor({state:'visible',timeout:2000}).catch(()=>null);
      }
    }
  }
  assert(await choose.isVisible(), 'Native picker does not contain '+target.id);
  await choose.click();
  let inserted=false;
  for(let k=0;k<10;k++){await sleep(400);if((await page.evaluate(() => window.tinymce?.get('content')?.getContent() || '')).includes(target.id)){inserted=true;break;}}
  assert(inserted,'Native TablePress shortcode insertion failed');
  if(await page.locator('#TB_iframeContent').count())await page.evaluate(()=>window.tb_remove?.());
  await page.locator('#content-html').click();
  assert((await page.locator('#content').inputValue()).includes(target.id), 'Editor content did not retain inserted TablePress shortcode');
}
async function ensurePage(original) {
  const published = await page.request.get(uri('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,acf,content,title'), {timeout:30000});
  assert(published.ok(),'Cannot list published WordPress pages');
  const matches=(await published.json()).filter(p=>p.slug===target.slug);
  assert(matches.length<=1,'Duplicate published English Top Message pages');
  const current=matches[0];
  if (current) {
    const translatedFrom = current.acf?.origin_page_id?.ID ?? current.acf?.origin_page_id?.id ?? current.acf?.origin_page_id?.value ?? current.acf?.origin_page_id;
    assert(current.acf?.action==='IntroPage' && (current.acf.product_lang?.value||current.acf.product_lang)==='en' && String(translatedFrom)===String(original.id), 'Existing Top Message is not correct English translation');
    assert(String(current.content?.rendered||'').includes(target.id), 'Existing English page does not reference EN TablePress');
    console.log('EN_TOP_PAGE=ALREADY_PRESENT_SKIP_WRITE id='+current.id);
    return;
  }
  // Recover only an unambiguous empty English draft, never overwrite unrelated content.
  const draftSearch = await page.request.get(uri('/wp-json/wp/v2/pages?status=draft&slug='+target.slug+'&per_page=20&_fields=id,slug,acf,content'), {timeout:30000});
  const drafts = draftSearch.ok() ? await draftSearch.json() : [];
  assert(drafts.length <= 1, 'Multiple same-slug English drafts; refusing duplicate creation');
  const draft = drafts[0];
  if (draft) {
    assert((draft.acf?.product_lang?.value||draft.acf?.product_lang) === 'en' && (draft.acf?.key === target.key || !draft.acf?.key), 'Existing draft language/key conflict');
    await page.goto(uri('/wp-admin/post.php?post='+draft.id+'&action=edit'), {waitUntil:'domcontentloaded',timeout:45000});
  } else {
    await page.goto(uri('/wp-admin/post-new.php?post_type=page&esc_ml_origin='+original.id+'&esc_ml_lang=en'), {waitUntil:'domcontentloaded',timeout:45000});
  }
  await page.locator('#title').fill(target.title);
  await setAcf('key',target.key);
  await setAcf('action','IntroPage');
  await setAcf('product_lang','en');
  await ensureTranslationOrigin(original);
  await insertNativeShortcode();
  if (draft) {
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}),page.locator('#save-post').click()]);
  } else {
    await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit/, {timeout:45000}),page.locator('#save-post').click()]);
  }
  const id=Number(await page.locator('#post_ID').inputValue());
  assert(id>0,'English draft Page ID missing');
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit`), {waitUntil:'domcontentloaded',timeout:45000});
  const edit=page.locator('#edit-slug-buttons .edit-slug');
  if(await edit.isVisible().catch(()=>false)){
    await edit.click();await page.locator('#new-post-slug').fill(target.slug);await page.locator('#edit-slug-buttons .save').click();
  }else {await page.locator('#post_name').fill(target.slug);}
  const pre=await page.evaluate(() => ({slug:document.querySelector('#editable-post-name-full')?.textContent?.trim()||document.querySelector('#post_name')?.value,lang:document.querySelector('[data-name="product_lang"] select')?.value||document.querySelector('[data-name="product_lang"] input:checked')?.value,origin:document.querySelector('[data-name="origin_page_id"] select')?.value||document.querySelector('[data-name="origin_page_id"] input')?.value,key:document.querySelector('[data-name="key"] input')?.value,action:document.querySelector('[data-name="action"] input')?.value,content:document.querySelector('#content')?.value}));
  assert(pre.slug===target.slug && pre.lang==='en' && String(pre.origin)===String(original.id) && pre.key===target.key && pre.action==='IntroPage' && String(pre.content).includes(target.id),'English draft ACF/slug/shortcode preflight failed');
  await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}), page.locator('#publish').click()]);
  const res=await page.request.get(uri('/wp-json/wp/v2/pages/'+id+'?_fields=id,slug,status,acf,content'),{timeout:30000});
  assert(res.ok(),'Cannot verify WordPress EN page after publication');
  const publishedPage=await res.json();
  assert(publishedPage.slug===target.slug && publishedPage.status==='publish' && (publishedPage.acf?.product_lang?.value||publishedPage.acf?.product_lang)==='en' && String(publishedPage.content?.rendered).includes(target.id),'English published page failed REST readback');
  console.log('EN_TOP_PAGE=PUBLISHED_READBACK_PASS id='+id+' slug='+target.slug+' origin='+original.id);
}
async function sampleIsAlreadyLive() {
  const response = await context.request.get(front+'/'+target.slug+'?_en_sample_preflight='+Date.now(), {timeout:25000, headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
  if (response?.status() !== 200) return false;
  const html = await response.text();
  return html.includes('Top Message') && html.includes('Our mission is to provide') && html.includes('Prime Minister');
}
async function buildViaWordPress() {
  await page.goto(uri('/wp-admin/admin.php?page=vcs-build-trigger'),{waitUntil:'domcontentloaded',timeout:45000});
  const button=page.locator('#vcs-build-btn-main');
  assert(await button.count()===1,'WordPress Build Website tool unavailable');
  let state=await page.evaluate(() => ({
    configured:window.vcsBuild?.build_configured,
    active:window.vcsBuild?.initial_active,
    pending:window.vcsBuild?.pending_count,
    buttonDisabled:document.querySelector('#vcs-build-btn-main')?.disabled,
    forceDisabled:document.querySelector('#vcs-force-build')?.disabled,
  }));
  console.log('EN_TOP_BUILD_NATIVE_STATE='+JSON.stringify(state));
  assert(state.configured===true || state.configured==='1' || state.configured===1, 'WordPress native build is not configured');
  if(state.active){
    // A previous run can finish while the WordPress active flag remains stale.
    // Only the native AJAX status API may reconcile and release its lock.
    const status=await page.waitForResponse(r => r.url().startsWith(wp+'/wp-admin/admin-ajax.php') &&
      r.request().method()==='POST' && String(r.request().postData()||'').includes('action=vcs_check_build_status'),
      {timeout:20000}).catch(()=>null);
    if(status){const info=await status.json().catch(()=>({}));console.log('EN_TOP_BUILD_RECONCILE='+JSON.stringify({status:info?.data?.status,active:info?.data?.build_active}));}
    await page.reload({waitUntil:'domcontentloaded',timeout:45000});
    state=await page.evaluate(() => ({configured:window.vcsBuild?.build_configured,active:window.vcsBuild?.initial_active,pending:window.vcsBuild?.pending_count}));
    console.log('EN_TOP_BUILD_AFTER_RECONCILE='+JSON.stringify(state));
  }
  if(state.active){console.log('EN_TOP_BUILD=OTHER_BUILD_RUNNING_SKIP_DUPLICATE');return;}
  const force=page.locator('#vcs-force-build');
  assert(await force.count()===1 && !await force.isDisabled(),'WordPress force-build control still unavailable after native state reconciliation');
  await force.check();
  assert(!await button.isDisabled(),'WordPress native build button remains disabled');
  const response=page.waitForResponse(r=>r.url().startsWith(wp+'/wp-admin/admin-ajax.php') &&
    r.request().method()==='POST' && String(r.request().postData()||'').includes('action=vcs_trigger_build'),
    {timeout:45000});
  await button.click();
  const ack=await response;
  assert(ack.ok(),'WordPress Build HTTP '+ack.status());
  const j=await ack.json();
  assert(j?.success,'WordPress Build rejected: '+String(j?.data?.message||j?.data?.code||'unknown'));
  console.log('EN_TOP_BUILD=TRIGGERED_VIA_WORDPRESS');
}

async function verifyProduction() {
  for(let k=0;k<52;k++){
    const res=await context.request.get(front+'/'+target.slug+'?_en_sample='+Date.now(),{timeout:25000,headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
    const html=res?.ok()?await res.text():'';
    if(res?.status()===200 && html.includes('Top Message') && html.includes('Our mission is to provide') && html.includes('Prime Minister')){
      await mkdir('artifacts/ptscps-intro-en-sample',{recursive:true});
      const ui=await context.newPage();
      const loaded=await ui.goto(front+'/'+target.slug,{waitUntil:'domcontentloaded',timeout:45000});
      assert(loaded?.status()===200,'Desktop sample route failed');
      assert((await ui.locator('main h1').innerText()).trim()===target.title,'English sample heading incorrect');
      assert(await ui.locator('main img').count()>=2,'English award images not rendered');
      await ui.screenshot({path:'artifacts/ptscps-intro-en-sample/desktop-top-message.png',fullPage:true});
      await ui.setViewportSize({width:390,height:844});
      await ui.reload({waitUntil:'domcontentloaded'});
      await ui.screenshot({path:'artifacts/ptscps-intro-en-sample/mobile-top-message.png',fullPage:true});
      console.log('EN_TOP_PRODUCTION_QA=PASS url='+front+'/'+target.slug);
      await ui.close();return;
    }
    console.log('EN_TOP_WAIT='+JSON.stringify({attempt:k+1,http:res?.status()||'error'}));
    await sleep(15000);
  }
  throw Error('English Top Message not visible on frontend after native WordPress build');
}
try {
  await page.goto(uri('/wp-login.php'),{waitUntil:'domcontentloaded',timeout:50000});
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  console.log('EN_TOP_ADMIN_AUTH=PASS');
  const {original,awards}=await getOriginal();
  await ensureTable(awards);
  await ensurePage(original);
  if (await sampleIsAlreadyLive()) console.log('EN_TOP_BUILD=ALREADY_DEPLOYED_SKIP_TRIGGER');
  else await buildViaWordPress();
  await verifyProduction();
  console.log('EN_TOP_SAMPLE=PASS');
} finally { await browser.close(); }
