import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const wp = process.env.WP_ORIGIN;
const front = process.env.FRONT_ORIGIN;
const user = process.env.WP_ADMIN_USERNAME;
const pass = process.env.WP_ADMIN_PASSWORD;
const phase = String(process.env.EN_REMAINING_PHASE || 'cms').trim();
assert(wp && front && user && pass, 'Missing configured PTSCPS origins or WordPress admin credentials');
assert(['cms','qa'].includes(phase), `Unsupported EN_REMAINING_PHASE=${phase}`);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const browser = await chromium.launch({ headless:true });
const context = await browser.newContext({ viewport:{ width:1440, height:1000 } });
const page = await context.newPage();
const uri = path => wp + path;
const clean = value => String(value ?? '').replace(/<[^>]+>/g, '').trim();
const report = (key, value) => console.log(`EN_REMAINING_${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`);
const fields = ['type','group','title','content','meta','href','img'];
const labels = ['Content Type','Group','Title','Content','Additional Info','Link','Image'];

const specs = [
  {
    sourceId:'about_01', id:'about_01_en', originId:82645, originalSlug:'gioi-thieu-cong-ty', originalTitle:'Giới thiệu công ty',
    slug:'introduction', title:'Introduction', key:'about-company', description:'ABOUT US', snippet:'officially put into operation on September 15, 2002',
    expectedTypes:['prose','section','service','service','service','service'],
    rows: source => {
      assert.equal(source.items.length, 6, 'about_01 row count changed');
      assert.deepEqual(source.items.map(x=>String(x.type||'')), ['prose','section','service','service','service','service'], 'about_01 structure changed');
      return [
        ['prose','','','PTSC Production Services Joint Stock Company, formerly known as Petroleum Production Services Enterprise, was officially put into operation on September 15, 2002. On March 19, 2007, the Company was transformed into PTSC Production Services Limited Company. With the growing development, the Company officially transformed into a Joint Stock Company with the name PTSC Production Services Joint Stock Company on April 01, 2011.','','',''],
        ['section','','PTSC Production Services JSC provides the core services including:','','','',''],
        ['service','','','Operation & Maintenance Services for FPSO/FSO/MOPU','','',''],
        ['service','','','Skilled Technical Manpower Supply','','',''],
        ['service','','','Engineering Procurement Construction and Installation (EPCI)','','',''],
        ['service','','','Repairs & Maintenance Service for industrial plants','','',''],
      ];
    },
  },
  {
    sourceId:'about_02', id:'about_02_en', originId:82647, originalSlug:'ban-lanh-dao', originalTitle:'Ban lãnh đạo',
    slug:'board-of-directors', title:'Board of Directors', key:'about-leadership', description:'ABOUT US', snippet:'Mr. Nguyen Viet Long',
    expectedTypes:Array(8).fill('leader'),
    rows: source => {
      const expectedNames = ['Nguyễn Viết Long','Phạm Đình Kiên','Nguyễn Văn Tùng','Phạm Quốc Huy','Lê Toàn Thắng','Nguyễn Quốc Hoàng','Nguyễn Văn Hải','Thịnh Văn Thìn'];
      assert.equal(source.items.length, expectedNames.length, 'about_02 row count changed');
      assert.deepEqual(source.items.map(x=>String(x.type||'')), Array(expectedNames.length).fill('leader'), 'about_02 structure changed');
      assert.deepEqual(source.items.map(x=>String(x.title||'').replace(/^Ông\s+/u,'')), expectedNames, 'Current Vietnamese leadership changed; review English mapping before publishing');
      return [
        ['leader','Board of Directors','Mr. Nguyen Viet Long','','Chairman','',''],
        ['leader','Board of Directors','Mr. Pham Dinh Kien','','Member of Board of Directors','',''],
        ['leader','Board of Directors','Mr. Nguyen Van Tung','','Member of Board of Directors','',''],
        ['leader','Board of Directors','Mr. Pham Quoc Huy','','Member of Board of Directors','',''],
        ['leader','Board of Directors','Mr. Le Toan Thang','','Member of Board of Directors','',''],
        ['leader','Board of Executives','Mr. Nguyen Quoc Hoang','','Managing Director','',''],
        ['leader','Board of Executives','Mr. Nguyen Van Hai','','Deputy Director','',''],
        ['leader','Board of Executives','Mr. Thinh Van Thin','','Deputy Director','',''],
      ];
    },
  },
  {
    sourceId:'about_03', id:'about_03_en', originId:82649, originalSlug:'qua-trinh-phat-trien', originalTitle:'Quá trình phát triển',
    slug:'our-history', title:'Our History', key:'about-history', description:'ABOUT US', snippet:'Took over the title of FSO MV12',
    expectedTypes:Array(27).fill('timeline'),
    rows: source => historyRows(source),
  },
  {
    sourceId:'about_04', id:'about_04_en', originId:82651, originalSlug:'dinh-huong-phat-trien', originalTitle:'Định hướng phát triển',
    slug:'mission-vision', title:'Mission & Vision', key:'about-direction', description:'ABOUT US', snippet:'strategic and reliable partner',
    expectedTypes:['prose'],
    rows: source => {
      assert.equal(source.items.length, 1, 'about_04 row count changed');
      assert.equal(String(source.items[0]?.type||''), 'prose', 'about_04 structure changed');
      return [[
        'prose','','','PTSC Production Services JSC aims to be a strategic and reliable partner in providing O&M services for FPSO / FSO / MOPU in Vietnam and regional markets; providing operation and maintenance services for industrial, petroleum and petrochemical facilities onshore and offshore; supplying technical manpower for operation and maintenance; and providing other related services e.g. engineering, procurement, fabrication, repairs and maintenance.','','',''
      ]];
    },
  },
];

const historyTranslations = [
  ['2002','The Company established.'],
  ['2002','Took-over and provided O&M for FPSO Ruby Princess for Petronas Carigali Vietnam Limited (PCVL).'],
  ['2003','Performed EPCI contract for WHP-A and pipelines for Su Tu Den project for Cuu Long JOC.'],
  ['2005','Performed the Transportation, Installation, hook-up and commissioning service for RBDP-B project for PCVL.'],
  ['2006','Performed T&I contract for Bunga Tulip A WHP for Talisman (Malaysia).'],
  ['2006','Performed T&I contract for PM3-CAMAU gas pipeline project for PetroVietnam.'],
  ['2008','Performed T&I contract for FSO Orkid for MVOT/Talisman.'],
  ['2008','Performed O&M contract (O&M Manpower supply) for FSO Orkid in Malaysia for MVOT/Talisman Malaysia.'],
  ['2008','Performed O&M contract (O&M Manpower supply) for FPSO Thai Binh VN for Cuu Long JOC.'],
  ['2010','Performed T&I contract for FPSO Ruby II for VOFT/PCVL.'],
  ['2010','Performed O&M contract for FPSO Ruby II for VOFT/PCVL.'],
  ['2010','Performed O&M contract for FSO PTSC Bach Ho for Vietsovpetro (VSP).'],
  ['2010','Performed the Disconnect and Decommissioning service for FPSO Ruby Princess.'],
  ['2011','Transformed into PTSC Production Services Joint Stock Company.'],
  ['2013','Performed O&M contract for FSO PTSC Bien Dong 01 for PTSC/Bien Dong POC.'],
  ['2013','Performed the disconnect and decommissioning project for FSO Queensway.'],
  ['2014','Performed O&M contract for FPSO PTSC Lam Son for PTSC/Lam Son JOC.'],
  ['2017','Performed maintenance & repair contract for Fuel Hydrant system in Tan Son Nhat International Airport for Tapetco.'],
  ['2018','O&M contract awarded for FSO Golden Star by MVOT/Idemitsu Gas Production (Vietnam) Co., Ltd.'],
  ['2019','Performed O&M contract (Manpower supply) for Thai Binh Platform, BLOCKS 102 & 106 for PETRONAS Carigali Overseas Sdn Bhd (PCOSB).'],
  ['2019','Performed Repair & Lifetime Extension (RLE) project for FPSO Ruby II for VOFT.'],
  ['2019','Performed refurbishing, repair and maintenance services and supplied spare parts for valves at Nghi Son Refinery and Petrochemical Complex (NSRP).'],
  ['2019','Performed maintenance & repair services for valves at Dung Quat Refinery Plant - Binh Son Refinery and Petrochemical Co., Ltd.'],
  ['2021','Certified for compliance with the International Management Code for the Safe Operation of Ships and for Pollution Prevention (ISM Code) for the ship type “Gas Carrier”.'],
  ['2022','Performed O&M Contract for FPSO LEWEK EMAS and BLOCK 12W offshore Vietnam for PREMIER OIL VIETNAM.'],
  ['2023','Provision of manpower, tools and equipment for daily maintenance for the Upstream Plant of LSP.'],
  ['2024','Took over the title of FSO MV12 (FSO PPS 01) and performed the Time Charter Party contract for FSO PPS 01 for ZNEP.'],
];
const historyAlt = {
  '2002':'PTSC PPS team during the company establishment in 2002',
  '2003':'Offshore facility in the PTSC PPS development history in 2003',
  '2005':'Offshore facility in the PTSC PPS development history in 2005',
  '2006':'PTSC PPS offshore oil and gas facility in 2006',
  '2008':'FSO Orkid contract signing in the PTSC PPS development history in 2008',
  '2010':'FPSO Ruby II in PTSC PPS operations in 2010',
  '2011':'FPSO PTSC Lam Son in the PTSC PPS development history in 2011',
  '2013':'FSO PTSC Bien Dong 01 in the PTSC PPS development history in 2013',
  '2014':'FPSO PTSC Lam Son in PTSC PPS operations in 2014',
  '2017':'PTSC PPS equipment maintenance and repair services in 2017',
  '2018':'FPSO Ruby II in PTSC PPS operations in 2018',
  '2019':'FPSO Ruby II in PTSC PPS operations in 2019',
  '2021':'PTSC PPS Interim Document of Compliance certification in 2021',
  '2022':'FPSO Lewek Emas in PTSC PPS operations in 2022',
  '2023':'Long Son upstream project area in PTSC PPS operations in 2023',
  '2024':'FSO PPS 01 in the PTSC PPS development history in 2024',
};

function imageForEnglish(sourceHtml, year) {
  const html = String(sourceHtml || '');
  if (!/<img\b/i.test(html)) return '';
  const src = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(html)?.[1] || '';
  const parsed = new URL(src, wp);
  assert(parsed.origin === wp, `History image escaped current WordPress origin year=${year}`);
  assert(parsed.pathname.startsWith('/wp-content/uploads/'), `History image is outside Media Library year=${year}`);
  assert(historyAlt[year], `History English alt missing year=${year}`);
  return `<img src="${parsed.pathname}${parsed.search}" alt="${historyAlt[year]}" loading="lazy">`;
}

function historyRows(source) {
  assert.equal(source.items.length, historyTranslations.length, 'about_03 row count changed');
  assert.deepEqual(source.items.map(x=>String(x.type||'')), Array(historyTranslations.length).fill('timeline'), 'about_03 structure changed');
  assert.deepEqual(source.items.map(x=>String(x.meta||'')), historyTranslations.map(x=>x[0]), 'about_03 year/order checkpoint changed');
  const rows = source.items.map((item,index) => {
    const [year, content] = historyTranslations[index];
    return ['timeline','','',content,year,'',imageForEnglish(item.img, year)];
  });
  const images = rows.filter(row => /<img\b/i.test(row[6]));
  assert.equal(images.length, 16, 'English history must preserve 16 current year images');
  return rows;
}

async function readTable(id) {
  for (let attempt=1; attempt<=4; attempt++) {
    try {
      const response = await page.request.get(uri(`/wp-json/tablepress/v1/table/${id}?_en_remaining=${Date.now()}`), { timeout:30000, headers:{'Cache-Control':'no-cache'} });
      if (response.status() === 404) return null;
      assert(response.ok(), `TablePress ${id} HTTP ${response.status()}`);
      return response.json();
    } catch (error) {
      if (attempt === 4) throw error;
      await sleep(900 * attempt);
    }
  }
}

async function login() {
  await page.goto(uri('/wp-login.php'), { waitUntil:'domcontentloaded', timeout:50000 });
  await page.locator('#user_login').fill(user);
  await page.locator('#user_pass').fill(pass);
  await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:50000}),page.locator('#wp-submit').click()]);
  assert.equal(new URL(page.url()).origin, wp, 'WordPress authentication escaped configured origin');
  report('ADMIN_AUTH','PASS');
}

async function sourceFor(spec) {
  const pagesResponse = await page.request.get(uri(`/wp-json/wp/v2/pages?slug=${encodeURIComponent(spec.originalSlug)}&status=publish&per_page=20&_fields=id,slug,title,status,acf,content`), { timeout:30000 });
  assert(pagesResponse.ok(), `Vietnamese Page HTTP ${pagesResponse.status()} ${spec.originalSlug}`);
  const pages = await pagesResponse.json();
  assert.equal(pages.length, 1, `Expected exactly one Vietnamese Page ${spec.originalSlug}`);
  const original = pages[0];
  assert.equal(Number(original.id), spec.originId, `Vietnamese origin Page ID changed ${spec.originalSlug}`);
  assert.equal(String(original?.acf?.product_lang?.value || original?.acf?.product_lang || ''), 'vi', `Vietnamese origin language changed ${spec.originalSlug}`);
  const source = await readTable(spec.sourceId);
  assert(source?.items, `Vietnamese source ESC Table missing ${spec.sourceId}`);
  const rows = spec.rows(source);
  assert.equal(rows.length, source.items.length, `English row parity failed ${spec.id}`);
  report('SOURCE', { source:spec.sourceId, target:spec.id, rows:rows.length, origin:original.id });
  return { original, source, rows };
}

async function nativeSaveTable() {
  const save = page.getByRole('button', { name:/^(Save Changes|Lưu thay đổi)$/i });
  assert(await save.count() > 0, 'Native ESC Table Save Changes unavailable');
  await save.last().click();
}

function assertTableExact(spec, table, rows) {
  assert(table, `English ESC Table missing ${spec.id}`);
  assert.deepEqual((table.fields||[]).map(f=>String(f.key||'')), fields, `English ESC Table schema mismatch ${spec.id}`);
  assert.equal(table.items?.length, rows.length, `English ESC Table row count mismatch ${spec.id}`);
  for (let i=0;i<rows.length;i++) {
    for (let c=0;c<fields.length;c++) {
      assert.equal(String(table.items[i]?.[fields[c]] ?? ''), String(rows[i][c] ?? ''), `English ESC Table cell mismatch ${spec.id} row=${i} field=${fields[c]}`);
    }
  }
}

async function ensureTable(spec, rows) {
  let existing = await readTable(spec.id);
  if (existing?.items?.length) {
    assertTableExact(spec, existing, rows);
    report('TABLE', { id:spec.id, state:'ALREADY_PRESENT_VERIFIED_SKIP_WRITE', rows:rows.length });
    return;
  }
  if (!existing) {
    const all = await page.request.get(uri('/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1'), { timeout:30000 });
    assert(all.ok(), 'Unable to inspect existing ESC Tables');
    const candidates = (await all.json()).filter(row => clean(row.name || row.title) === spec.title && String(row.id) !== spec.id);
    assert.equal(candidates.length, 0, `Ambiguous preexisting English ESC Table for ${spec.title}`);
    await page.goto(uri('/wp-admin/admin.php?page=tablepress&action=add'), { waitUntil:'domcontentloaded', timeout:45000 });
    await page.locator('input[name="table[name]"]').fill(spec.title);
    await page.locator('textarea[name="table[description]"]').fill(spec.description);
    await page.locator('input[name="table[rows]"]').fill('2');
    await page.locator('input[name="table[columns]"]').fill(String(fields.length));
    await page.getByRole('button', { name:/^(Add Table|Thêm bảng)$/i }).click();
    await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/, { timeout:45000 });
    const currentId = new URL(page.url()).searchParams.get('table_id') || await page.locator('#table-id').inputValue();
    assert(currentId, `Generated ESC Table ID missing ${spec.title}`);
    let confirmed=false;
    page.once('dialog', async dialog => { confirmed=true; await dialog.accept(); });
    await page.locator('#table-id').fill(spec.id);
    await page.locator('#table-name').click();
    for (let k=0;k<10 && !confirmed;k++) await sleep(100);
    assert(confirmed, `Native ESC Table rename confirmation missing ${spec.id}`);
    await nativeSaveTable();
    for (let k=0;k<14;k++) { await sleep(800); existing=await readTable(spec.id).catch(()=>null); if(existing)break; }
    assert(existing, `English ESC Table ID rename did not persist ${spec.id}`);
  }
  assert(!(existing.items||[]).length, `Refusing to overwrite populated English ESC Table ${spec.id}`);
  await page.goto(uri(`/wp-admin/admin.php?page=tablepress&action=edit&table_id=${spec.id}`), { waitUntil:'domcontentloaded', timeout:45000 });
  await page.waitForFunction(() => Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append), null, { timeout:30000 });
  await page.locator('#table-name').fill(spec.title);
  await page.locator('#table-description').fill(spec.description);
  await page.evaluate(({fields,labels,rows}) => {
    const ed=window.tp.editor;
    if (ed.options.columns.length !== fields.length) throw Error('English ESC Table column count mismatch before write');
    const required=rows.length+2;
    if(ed.options.data.length<required)window.tp.callbacks.append('rows',required-ed.options.data.length);
    if(ed.options.data.length>required)throw Error('Unexpected existing ESC Table extra rows');
    for(let c=0;c<fields.length;c++){ed.setValueFromCoords(c,0,fields[c]);ed.setValueFromCoords(c,1,labels[c]);}
    for(let r=0;r<rows.length;r++)for(let c=0;c<fields.length;c++)ed.setValueFromCoords(c,r+2,String(rows[r][c]??''));
    window.tp.helpers.unsaved_changes.set();
  }, {fields,labels,rows});
  await nativeSaveTable();
  let saved=null;
  for(let k=0;k<16;k++){await sleep(850);saved=await readTable(spec.id).catch(()=>null);if(saved?.items?.length===rows.length)break;}
  assertTableExact(spec,saved,rows);
  report('TABLE', { id:spec.id, state:'PASS', rows:rows.length });
}

async function setAcf(name, value) {
  const field=page.locator(`.acf-field[data-name="${name}"]`).first();
  assert(await field.count(), `ACF ${name} missing`);
  const select=field.locator('select').first();
  if(await select.count()){await select.selectOption(String(value));return;}
  const radio=field.locator(`input[type="radio"][value="${String(value)}"]`).first();
  if(await radio.count()){await radio.check();return;}
  const input=field.locator('input[type="text"],input[type="number"]').first();
  assert(await input.count(), `ACF ${name} unsupported`);
  await input.fill(String(value));
}

async function ensureTranslationOrigin(spec, original) {
  const field=page.locator('.acf-field[data-name="origin_page_id"]');
  assert(await field.count()===1,'Translation origin ACF missing');
  const select=field.locator('select').first();
  if(!await select.count()) return setAcf('origin_page_id',original.id);
  if(String(await select.inputValue())===String(original.id))return;
  const picker=field.locator('.select2-selection').first();
  await picker.waitFor({state:'visible',timeout:15000});
  await picker.click();
  const search=page.locator('.select2-container--open input.select2-search__field').first();
  await search.fill(spec.originalTitle);
  const matches=page.locator('.select2-container--open .select2-results__option[role="option"]');
  await matches.first().waitFor({state:'visible',timeout:15000});
  const choice=matches.filter({hasText:spec.originalTitle}).first();
  assert(await choice.count(), `Vietnamese origin not found in native ACF picker ${spec.originalTitle}`);
  await choice.click();
  assert.equal(String(await select.inputValue()),String(original.id),`Wrong translation origin selected ${spec.title}`);
}

async function insertNativeShortcode(spec) {
  const visual=page.locator('#content-tmce');
  if(await visual.count())await visual.click();
  await page.waitForFunction(()=>Boolean(window.tinymce?.get('content')?.initialized&&!window.tinymce.get('content').isHidden()),null,{timeout:25000});
  const contents=await page.evaluate(()=>window.tinymce.get('content').getContent()||'');
  if(contents.includes(spec.id))return;
  assert(!clean(contents),`Existing English Page content is not empty ${spec.slug}`);
  await page.evaluate(()=>{window.tinymce.get('content').setContent('');window.tinymce.get('content').focus();if(window.tb_remove)window.tb_remove();});
  await page.locator('#TB_iframeContent').waitFor({state:'detached',timeout:10000});
  const picker=page.frameLocator('#TB_iframeContent');
  let ready=false;
  for(let k=0;k<3&&!ready;k++){
    await page.evaluate(()=>{if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('Native TablePress Insert Code missing');window.tablepress_open_shortcode_thickbox();});
    ready=await picker.locator('input.insert-shortcode').first().waitFor({state:'visible',timeout:12000}).then(()=>true).catch(()=>false);
    if(!ready){await page.evaluate(()=>window.tb_remove?.());await page.locator('#TB_iframeContent').waitFor({state:'detached',timeout:12000});}
  }
  assert(ready,'Native TablePress Insert Code picker did not open');
  const choose=picker.locator(`input.insert-shortcode[title*="${spec.id}"]`).first();
  if(!await choose.isVisible().catch(()=>false)){
    const search=picker.locator('input[type="search"],#tablepress-search,#table-search-input,input[name="s"]').first();
    if(await search.count()){await search.fill(spec.id);await search.press('Enter');await choose.waitFor({state:'visible',timeout:9000}).catch(()=>null);}
    if(!await choose.isVisible().catch(()=>false))for(let n=0;n<20&&!await choose.isVisible().catch(()=>false);n++){
      const next=picker.locator('a.next-page,button.next-page').first();if(!await next.isVisible().catch(()=>false))break;await next.click();await choose.waitFor({state:'visible',timeout:1800}).catch(()=>null);
    }
  }
  assert(await choose.isVisible(),`Native Insert Code picker does not contain ${spec.id}`);
  await choose.click();
  let inserted=false;
  for(let k=0;k<12;k++){await sleep(350);if((await page.evaluate(()=>window.tinymce?.get('content')?.getContent()||'')).includes(spec.id)){inserted=true;break;}}
  assert(inserted,`Native TablePress shortcode insertion failed ${spec.id}`);
  if(await page.locator('#TB_iframeContent').count())await page.evaluate(()=>window.tb_remove?.());
  await page.locator('#content-html').click();
  assert((await page.locator('#content').inputValue()).includes(spec.id),`Editor content did not retain native shortcode ${spec.id}`);
}

function originValue(item) {
  const raw=item?.acf?.origin_page_id;
  return raw?.ID ?? raw?.id ?? raw?.value ?? raw ?? '';
}

async function ensurePage(spec, original) {
  const published=await page.request.get(uri(`/wp-json/wp/v2/pages?status=publish&slug=${encodeURIComponent(spec.slug)}&per_page=20&_fields=id,slug,acf,content,title,status`),{timeout:30000});
  assert(published.ok(),`Cannot inspect English Page ${spec.slug}`);
  const matches=await published.json();
  assert(matches.length<=1,`Duplicate published English Page ${spec.slug}`);
  if(matches.length===1){
    const current=matches[0];
    assert.equal(String(current?.acf?.action||''),'IntroPage',`English Page action mismatch ${spec.slug}`);
    assert.equal(String(current?.acf?.product_lang?.value||current?.acf?.product_lang||''),'en',`English Page language mismatch ${spec.slug}`);
    assert.equal(String(originValue(current)),String(original.id),`English Page origin mismatch ${spec.slug}`);
    assert.equal(String(current?.acf?.key||''),spec.key,`English Page key mismatch ${spec.slug}`);
    assert(String(current?.content?.rendered||'').includes(spec.id),`English Page native ESC Table shortcode missing ${spec.slug}`);
    report('PAGE',{slug:spec.slug,state:'ALREADY_PRESENT_VERIFIED_SKIP_WRITE',id:current.id});
    return Number(current.id);
  }
  const draftSearch=await page.request.get(uri(`/wp-json/wp/v2/pages?status=draft&slug=${encodeURIComponent(spec.slug)}&per_page=20&_fields=id,slug,acf,content,title`),{timeout:30000});
  const drafts=draftSearch.ok()?await draftSearch.json():[];
  assert(drafts.length<=1,`Multiple English drafts ${spec.slug}`);
  const draft=drafts[0];
  if(draft){
    assert(['',spec.key].includes(String(draft?.acf?.key||'')),`English draft key conflict ${spec.slug}`);
    assert(['','en'].includes(String(draft?.acf?.product_lang?.value||draft?.acf?.product_lang||'')),`English draft language conflict ${spec.slug}`);
    await page.goto(uri(`/wp-admin/post.php?post=${draft.id}&action=edit`),{waitUntil:'domcontentloaded',timeout:45000});
  } else {
    await page.goto(uri(`/wp-admin/post-new.php?post_type=page&esc_ml_origin=${original.id}&esc_ml_lang=en`),{waitUntil:'domcontentloaded',timeout:45000});
  }
  await page.locator('#title').fill(spec.title);
  await setAcf('key',spec.key);
  await setAcf('action','IntroPage');
  await setAcf('product_lang','en');
  await ensureTranslationOrigin(spec,original);
  await insertNativeShortcode(spec);
  const saveDraft=page.locator('#save-post');
  assert(await saveDraft.count(),`WordPress Save Draft missing ${spec.slug}`);
  if (draft) {
    await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}),saveDraft.click()]);
  } else {
    await Promise.all([page.waitForURL(/post\.php\?post=\d+&action=edit/,{timeout:45000}),saveDraft.click()]);
  }
  const id=Number(await page.locator('#post_ID').inputValue());
  assert(id>0,`English draft ID missing ${spec.slug}`);
  await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit`),{waitUntil:'domcontentloaded',timeout:45000});
  const edit=page.locator('#edit-slug-buttons .edit-slug');
  if(await edit.isVisible().catch(()=>false)){
    await edit.click();await page.locator('#new-post-slug').fill(spec.slug);await page.locator('#edit-slug-buttons .save').click();
  } else if(await page.locator('#post_name').count()) {
    await page.locator('#post_name').fill(spec.slug);
  }
  await setAcf('key',spec.key);
  await setAcf('action','IntroPage');
  await setAcf('product_lang','en');
  await ensureTranslationOrigin(spec,original);
  if(!(await page.locator('#content').inputValue()).includes(spec.id))await insertNativeShortcode(spec);
  const pre=await page.evaluate(() => ({
    slug:document.querySelector('#editable-post-name-full')?.textContent?.trim()||document.querySelector('#post_name')?.value||'',
    lang:document.querySelector('[data-name="product_lang"] select')?.value||document.querySelector('[data-name="product_lang"] input:checked')?.value||'',
    origin:document.querySelector('[data-name="origin_page_id"] select')?.value||document.querySelector('[data-name="origin_page_id"] input')?.value||'',
    key:document.querySelector('[data-name="key"] input')?.value||'',
    action:document.querySelector('[data-name="action"] input')?.value||'',
    content:document.querySelector('#content')?.value||'',
  }));
  assert(pre.slug===spec.slug && pre.lang==='en' && String(pre.origin)===String(original.id) && pre.key===spec.key && pre.action==='IntroPage' && String(pre.content).includes(spec.id),`English draft preflight failed ${spec.slug}`);

  let readback=null;
  for(let publishAttempt=1;publishAttempt<=2;publishAttempt++){
    const publish=page.locator('#publish');
    assert(await publish.count(),`WordPress Publish button missing ${spec.slug}`);
    try {
      await Promise.all([page.waitForNavigation({waitUntil:'domcontentloaded',timeout:45000}),publish.click()]);
    } catch (error) {
      report('PAGE_PUBLISH_NAV_RETRY',{slug:spec.slug,attempt:publishAttempt,error:error?.name||'error'});
    }
    for(let attempt=1;attempt<=10;attempt++){
      const response=await page.request.get(uri(`/wp-json/wp/v2/pages/${id}?context=edit&_fields=id,slug,status,acf,content,title`),{timeout:30000}).catch(()=>null);
      if(response?.ok()){
        readback=await response.json();
        if(readback.status==='publish'&&readback.slug===spec.slug)break;
      }
      await sleep(800*Math.min(attempt,4));
    }
    if(!(readback?.status==='publish'&&readback.slug===spec.slug)){
      for(let attempt=1;attempt<=6;attempt++){
        const publicResponse=await page.request.get(uri(`/wp-json/wp/v2/pages?status=publish&slug=${encodeURIComponent(spec.slug)}&per_page=20&_fields=id,slug,status,acf,content,title`),{timeout:30000,headers:{'Cache-Control':'no-cache'}}).catch(()=>null);
        if(publicResponse?.ok()){
          const rows=await publicResponse.json().catch(()=>[]);
          const exact=Array.isArray(rows)?rows.find(item=>Number(item?.id)===id&&item?.slug===spec.slug&&item?.status==='publish'):null;
          if(exact){
            readback=exact;
            report('PAGE_PUBLISH_PUBLIC_READBACK_RECOVERED',{slug:spec.slug,id,attempt});
            break;
          }
        }
        await sleep(1000*Math.min(attempt,3));
      }
    }
    if(readback?.status==='publish'&&readback.slug===spec.slug)break;
    if(publishAttempt<2){
      report('PAGE_PUBLISH_READBACK_RETRY',{slug:spec.slug,status:readback?.status||'unknown'});
      await page.goto(uri(`/wp-admin/post.php?post=${id}&action=edit`),{waitUntil:'domcontentloaded',timeout:45000});
    }
  }
  assert(readback?.status==='publish',`English Page not published ${spec.slug}`);
  assert.equal(readback.slug,spec.slug,`English Page slug mismatch ${spec.slug}`);
  assert.equal(String(readback?.acf?.product_lang?.value||readback?.acf?.product_lang||''),'en',`English Page lang readback mismatch ${spec.slug}`);
  assert.equal(String(originValue(readback)),String(original.id),`English Page origin readback mismatch ${spec.slug}`);
  assert.equal(String(readback?.acf?.key||''),spec.key,`English Page key readback mismatch ${spec.slug}`);
  assert.equal(String(readback?.acf?.action||''),'IntroPage',`English Page action readback mismatch ${spec.slug}`);
  assert(String(readback?.content?.rendered||'').includes(spec.id),`English Page shortcode readback missing ${spec.slug}`);
  report('PAGE',{slug:spec.slug,state:'PUBLISHED_READBACK_PASS',id});
  return id;
}

async function cmsPhase() {
  await login();
  const created=[];
  for(const spec of specs){
    const {original,rows}=await sourceFor(spec);
    await ensureTable(spec,rows);
    const id=await ensurePage(spec,original);
    created.push({slug:spec.slug,id,table:spec.id,origin:spec.originId});
  }
  const all=await page.request.get(uri('/wp-json/wp/v2/pages?status=publish&per_page=100&_fields=id,slug,title,acf,content'),{timeout:30000});
  assert(all.ok(),'Cannot verify final English Page collection');
  const pages=await all.json();
  for(const spec of specs){
    const matching=pages.filter(item=>item.slug===spec.slug && String(item?.acf?.product_lang?.value||item?.acf?.product_lang||'')==='en');
    assert.equal(matching.length,1,`Final English Page collection mismatch ${spec.slug}`);
    assert.equal(String(originValue(matching[0])),String(spec.originId),`Final English origin collection mismatch ${spec.slug}`);
  }
  report('CMS_RESULT',{status:'PASS',pages:created});
}

async function assertImgLoaded(locator, label) {
  await locator.scrollIntoViewIfNeeded();
  await locator.waitFor({state:'visible',timeout:12000});
  const ok=await locator.evaluate(async img=>{
    if(!(img instanceof HTMLImageElement))return false;
    img.loading='eager';
    if(img.complete&&img.naturalWidth>80&&img.naturalHeight>60)return true;
    await new Promise(resolve=>{
      const done=()=>resolve();
      img.addEventListener('load',done,{once:true});
      img.addEventListener('error',done,{once:true});
      setTimeout(done,8000);
    });
    return img.complete&&img.naturalWidth>80&&img.naturalHeight>60;
  });
  assert(ok,`Broken production image ${label}`);
}

async function qaPhase() {
  await mkdir('artifacts/ptscps-intro-en-remaining',{recursive:true});
  const desktop=await context.newPage();
  await desktop.setViewportSize({width:1440,height:1000});
  for(const spec of specs){
    const response=await desktop.goto(`${front}/${spec.slug}`,{waitUntil:'load',timeout:50000});
    assert.equal(response?.status(),200,`Production route failed ${spec.slug}`);
    const h1=desktop.locator('main h1');
    await h1.waitFor({state:'visible',timeout:12000});
    assert.equal((await h1.innerText()).trim(),spec.title,`Production h1 mismatch ${spec.slug}`);
    assert.equal(await desktop.locator('main aside').count(),0,`Side menu leaked into ${spec.slug}`);
    assert((await desktop.locator('main').innerText()).includes(spec.snippet),`Production content snippet missing ${spec.slug}`);
    assert.equal(await desktop.evaluate(()=>document.documentElement.lang),'en',`HTML lang mismatch ${spec.slug}`);
    const language=desktop.locator('#header-navrow details[data-header-language]:visible').first();
    await language.locator('summary').click();
    const viLink=language.getByRole('link',{name:'Tiếng Việt',exact:true});
    assert(await viLink.count()===1,`Vietnamese language link missing ${spec.slug}`);
    assert.equal(new URL(await viLink.getAttribute('href'),front).pathname,`/${spec.originalSlug}`,`Vietnamese language href mismatch ${spec.slug}`);
    await desktop.keyboard.press('Escape');
    await desktop.screenshot({path:`artifacts/ptscps-intro-en-remaining/desktop-${spec.slug}.png`,fullPage:true});
    report('DESKTOP',{slug:spec.slug,status:'PASS'});
  }
  const history=specs.find(x=>x.id==='about_03_en');
  await desktop.goto(`${front}/${history.slug}`,{waitUntil:'load',timeout:50000});
  const years=desktop.locator('[data-about-history-year]');
  assert.equal(await years.count(),16,'Our History year count mismatch');
  const historyTriggers=desktop.locator('[data-about-history-image][data-gallery-trigger="about03-history"]');
  assert.equal(await historyTriggers.count(),16,'Our History production image trigger count mismatch');
  const historyImages=historyTriggers.locator('img');
  const imageSrcs=[];
  for(let i=0;i<16;i++){
    const img=historyImages.nth(i);
    await assertImgLoaded(img,`history-${i}`);
    const src=String(await img.getAttribute('src')||'');
    assert(src.startsWith('/images/pages/'),`History image is not localized image=${i} src=${src}`);
    assert(!src.includes('admin-ptscps.'),'Admin WordPress domain leaked into history image');
    const alt=String(await img.getAttribute('alt')||'').trim();
    assert(alt.length>12,`English history alt missing image=${i}`);
    imageSrcs.push(src);
  }
  assert.equal(new Set(imageSrcs).size,13,'Our History unique image count mismatch');
  await historyTriggers.first().click();
  const lightbox=desktop.locator('[data-gallery-lightbox="about03-history"]');
  await lightbox.waitFor({state:'visible',timeout:8000});
  assert.equal(await lightbox.locator('[data-gallery-current]').innerText(),'1','Our History lightbox initial index mismatch');
  await desktop.keyboard.press('ArrowRight');
  await desktop.waitForTimeout(220);
  assert.equal(await lightbox.locator('[data-gallery-current]').innerText(),'2','Our History lightbox next navigation failed');
  await desktop.keyboard.press('Escape');
  await lightbox.waitFor({state:'hidden',timeout:3000});
  report('HISTORY_MEDIA',{status:'PASS',years:16,images:16,unique_images:13,lightbox:'PASS'});
  await desktop.close();

  const mobile=await context.newPage();
  await mobile.setViewportSize({width:390,height:844});
  for(const spec of specs){
    const response=await mobile.goto(`${front}/${spec.slug}`,{waitUntil:'load',timeout:50000});
    assert.equal(response?.status(),200,`Mobile production route failed ${spec.slug}`);
    assert.equal(await mobile.locator('main aside').count(),0,`Mobile side menu leaked into ${spec.slug}`);
    assert((await mobile.locator('main').innerText()).includes(spec.snippet),`Mobile content snippet missing ${spec.slug}`);
    await mobile.screenshot({path:`artifacts/ptscps-intro-en-remaining/mobile-${spec.slug}.png`,fullPage:true});
    report('MOBILE',{slug:spec.slug,status:'PASS'});
  }
  await mobile.close();
  report('PRODUCTION_QA',{status:'PASS',pages:specs.map(x=>x.slug),desktop:4,mobile:4,history_images:16,language_switch:'PASS'});
}

try {
  if(phase==='cms')await cmsPhase();
  else await qaPhase();
} finally {
  await browser.close();
}
