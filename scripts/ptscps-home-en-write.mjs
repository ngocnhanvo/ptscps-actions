import { chromium } from 'playwright';
const wp=process.env.WP_ORIGIN, user=process.env.WP_ADMIN_USERNAME, password=process.env.WP_ADMIN_PASSWORD;
if(!wp||!user||!password)throw Error('WordPress admin credentials missing');
const assert=(condition,msg)=>{if(!condition)throw Error(msg)};
const translation={
 home_00:{title:'Home — Main Banner',description:'MAIN BANNER',rows:[
 {eyebrow:'PTSC PRODUCTION SERVICES JSC (PPS)',title:'A Trusted Partner Throughout the Energy Journey',description:'Specialized in the operation and maintenance of offshore oil and gas facilities, including FPSO, FSO and MOPU units, supporting the sustainable development of Vietnam’s energy sector.',primary_label:'Explore Our Services',secondary_label:'About Us'},
 {eyebrow:'Banner Image 2'}, {eyebrow:'Banner Image 3'}]},
 home_01:{title:'Integrated Solutions for Offshore Oil and Gas Facilities',description:'OUR SERVICES',rows:[
 {title:'FPSO/FSO/MOPU Operation and Maintenance',description:'Delivering safe, reliable and efficient operations for offshore oil and gas facilities.',label:'Operations Services'},
 {title:'Technical Manpower Supply for Operations and Maintenance',description:'Experienced, highly qualified technical personnel meeting international industry standards.',label:'Technical Manpower'},
 {title:'Engineering, Procurement and Fabrication',description:'Providing integrated, optimized and effective engineering solutions for oil and gas projects.',label:'Engineering & Fabrication'},
 {title:'Maintenance and Repair of Industrial Equipment and Facilities',description:'Providing planned and corrective maintenance and repairs to maintain equipment availability.',label:'Equipment Maintenance'}]},
 home_02:{title:'Supporting Vietnam’s Energy Industry Since 2002',description:'ABOUT PPS',rows:[
 {title:'PTSC Production Services Joint Stock Company (PPS)',description:'PPS, a member of PetroVietnam Technical Services Corporation (PTSC), provides offshore operation and maintenance services and technical solutions for the oil and gas industry.',button_text:'Learn More'}]},
 home_03:{title:'Our Core Values',description:'Four values guiding our commitment to customers',rows:[
 {title:'Safety First',description:'Putting people, the environment and assets first.'},
 {title:'Professional Excellence',description:'Experienced teams delivering to international standards.'},
 {title:'Effective Solutions',description:'Optimizing costs, reliability and operational availability.'},
 {title:'Sustainable Growth',description:'Building long-term relationships with customers, partners and communities.'}]},
 home_04:{title:'Projects Demonstrating PPS Expertise',description:'FEATURED PROJECTS',rows:[
 {description:'Safe and efficient operation and maintenance supporting Vietnam’s energy supply.'},
 {description:'Comprehensive operation and maintenance services ensuring reliable, continuous performance.'},
 {description:'Supporting clients in operation and maintenance to improve field production efficiency.'}]},
 home_05:{title:'Latest Company News and Highlights',description:'NEWS & EVENTS',rows:[
 {title:'PPS Company Hosts Its 2026 Appreciation Journey in Ho Chi Minh City'},
 {title:'Chim Sao Field ASD & UWILD 2026: Safely Completed Ahead of Schedule'},
 {title:'PPS Successfully Holds Its 2026 Annual General Meeting of Shareholders'}]},
 home_14:{title:'Quick Links',description:'Services and company information',rows:[
 {title:'FPSO/FSO/MOPU Operation and Maintenance'},
 {title:'PPS Library'}, {title:'HSEQ Policy'}, {title:'Careers'}]},
 home_15:{title:'Our Clients',description:'PPS client logo carousel',rows:[]}
};
const sources=Object.keys(translation);
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1440,height:950}});
page.on('dialog', async dialog => { if(dialog.type()==='confirm' && /table|bảng|id|mã/i.test(dialog.message())){ console.log('EN_TABLE_ID_CONFIRM=ACCEPTED'); await dialog.accept(); }else {console.log('EN_UNEXPECTED_DIALOG='+dialog.type()); await dialog.dismiss();} });
async function readTable(id){const r=await page.request.get(`${wp}/wp-json/tablepress/v1/table/${id}`,{timeout:25000});if(r.status()===404)return null;assert(r.ok(),`Unable to fetch table ${id}: ${r.status()}`);return r.json();}
async function verifyTable(id,source,translated){const rows=translated.items||[];assert(translated?.id===id,`English table ID mismatch ${id}`);assert(rows.length===source.items.length,`Row count mismatch ${id}`);
  for(let i=0;i<rows.length;i++){for(const f of source.fields){const key=f.key;if(key==='image'){assert(String(rows[i][key]||'')===String(source.items[i][key]||''),`Media changed ${id} item ${i}`);}else{const wanted=translation[id.replace(/_en$/,'')].rows[i]?.[key]??source.items[i][key];assert(String(rows[i][key]||'')===String(wanted??''),`Translation mismatch ${id} item ${i}.${key}`);}}}}
async function saveTable(id,count){for(let k=0;k<12;k++){await page.waitForTimeout(850);let z=await readTable(id).catch(()=>null);if(z?.items?.length===count)return z;}throw Error(`Read-after-write failed ${id}`);}
async function ensureTable(sourceId){const targetId=sourceId+'_en', source=await readTable(sourceId), spec=translation[sourceId];assert(source?.items?.length,'Missing Vietnamese table '+sourceId);assert(source.items.length=== (spec.rows.length||source.items.length),`Unexpected source row count ${sourceId}`);
  let existing=await readTable(targetId);
  if(existing?.items?.length){await verifyTable(targetId,source,existing);console.log(`EN_TABLE_ALREADY_COMPLETE=${targetId} items=${existing.items.length}`);return;}
  if(!existing){
    // Recover the native table draft created by a previous interrupted run.
    // Never create another table with the same EN title.
    const allResponse=await page.request.get(`${wp}/wp-json/tablepress/v1/tables/prefix/all?per_page=100&page=1`,{timeout:25000});
    assert(allResponse.ok(),'Cannot list tables before EN create');
    const all=await allResponse.json();
    const copies=all.filter(t=>t.title===spec.title);
    assert(copies.length<=1,`Duplicate English table titles ${spec.title}; cannot safely continue`);
    if(copies.length){
      console.log(`EN_TABLE_RECOVER_EXISTING=${targetId} old=${copies[0].id}`);
      await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${encodeURIComponent(copies[0].id)}`,{waitUntil:'domcontentloaded',timeout:45000});
    }else{
      await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=add`,{waitUntil:'domcontentloaded',timeout:45000});
      await page.locator('input[name="table[name]"]').fill(spec.title);
      await page.locator('textarea[name="table[description]"]').fill(spec.description);
      await page.locator('input[name="table[rows]"]').fill('2');
      await page.locator('input[name="table[columns]"]').fill(String(source.fields.length));
      await page.getByRole('button',{name:/^(Add Table|Thêm bảng)$/i}).click();
      await page.waitForURL(/page=tablepress.*action=edit|action=edit.*page=tablepress/,{timeout:40000});
    }
    await page.locator('#table-id').fill(targetId);
    const save=page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});
    assert(await save.count()>0,'Native Save Changes missing');
    const ajax=page.waitForResponse(r=>r.url().includes('admin-ajax.php')&&(r.request().postData()||'').includes('tablepress_save_table'),{timeout:16000}).catch(()=>null);
    await save.last().click();
    const savedResponse=await ajax;console.log('EN_TABLE_ID_SAVE_RESPONSE='+JSON.stringify({id:targetId,status:savedResponse?.status()||null,body:(await savedResponse?.text().catch(()=>''))?.slice(0,360)}));
    for(let k=0;k<12;k++){await page.waitForTimeout(900);existing=await readTable(targetId).catch(()=>null);if(existing)break;}
    assert(existing,`Native table create failed ${targetId}; inspect edit dialog/save response`);
    console.log(`EN_TABLE_CREATED=${targetId}`);
  }
  assert(!existing.items?.length,`Existing EN table has data: ${targetId}; refusing overwrite`);
  await page.goto(`${wp}/wp-admin/admin.php?page=tablepress&action=edit&table_id=${targetId}`,{waitUntil:'domcontentloaded',timeout:45000});
  await page.waitForFunction(()=>Boolean(window.tp?.editor?.options?.data && window.tp?.callbacks?.append),null,{timeout:25000});
  const fields=source.fields.map(f=>f.key),labels=source.fields.map(f=>f.label),rows=source.items.map((item,i)=>fields.map(key=>String(spec.rows[i]?.[key] ?? item[key] ?? '')));
  await page.evaluate(({fields,labels,rows})=>{const ed=window.tp.editor; if(ed.options.columns.length!==fields.length)throw Error('English table column mismatch');if(ed.options.data.length<rows.length+2)window.tp.callbacks.append('rows',rows.length+2-ed.options.data.length);for(let c=0;c<fields.length;c++){ed.setValueFromCoords(c,0,fields[c]);ed.setValueFromCoords(c,1,labels[c]);}for(let r=0;r<rows.length;r++)for(let c=0;c<fields.length;c++)ed.setValueFromCoords(c,r+2,rows[r][c]);window.tp.helpers.unsaved_changes.set();},{fields,labels,rows});
  await page.locator('#table-name').fill(spec.title);
  await page.locator('#table-description').fill(spec.description);
  const save=page.getByRole('button',{name:/^(Save Changes|Lưu thay đổi)$/i});await save.last().click();
  const saved=await saveTable(targetId,source.items.length);
  await verifyTable(targetId,source,saved);
  console.log(`EN_TABLE_SAVED=${targetId} items=${saved.items.length} preserved_media=YES`);
}
async function ensurePage(){
  const existingRes=await page.request.get(`${wp}/wp-json/wp/v2/pages?per_page=100&_fields=id,slug,title,acf,status`);
  assert(existingRes.ok(),'Cannot verify existing published pages');const existing=await existingRes.json();
  const enExisting=existing.filter(p=>p.slug==='en' || (p.acf?.key==='home'&&(p.acf?.product_lang?.value||p.acf?.product_lang)==='en'));
  assert(enExisting.length<=1,'Ambiguous existing English home pages');
  let pageId=enExisting[0]?.id;
  if(pageId)await page.goto(`${wp}/wp-admin/post.php?post=${pageId}&action=edit`,{waitUntil:'domcontentloaded',timeout:45000});
  else {
    await page.goto(`${wp}/wp-admin/edit.php?post_type=page&post_status=all&s=Home`,{waitUntil:'domcontentloaded',timeout:45000});
    const drafts=await page.locator('#the-list tr[id^="post-"]').evaluateAll(rows=>rows.map(row=>({
      id:Number((row.id||'').replace(/^post-/,'')),title:(row.querySelector('a.row-title')?.textContent||'').trim()
    })).filter(row=>row.title==='Home'&&row.id>0));
    assert(drafts.length<=1,'Multiple Home drafts; cannot safely determine target');
    if(drafts.length){
      pageId=drafts[0].id;
      await page.goto(`${wp}/wp-admin/post.php?post=${pageId}&action=edit`,{waitUntil:'domcontentloaded',timeout:45000});
      const draft=await page.evaluate(()=>({
        status:document.querySelector('#post_status')?.value,
        title:document.querySelector('#title')?.value?.trim(),
        lang:document.querySelector('[data-name="product_lang"] select')?.value,
        key:document.querySelector('[data-name="key"] input')?.value,
        action:document.querySelector('[data-name="action"] input')?.value,
        origin:document.querySelector('[data-name="origin_page_id"] select')?.value,
        content:document.querySelector('#content')?.value||''
      }));
      console.log('EN_PAGE_DRAFT_RECOVERY='+JSON.stringify({...draft,id:pageId,contentLength:draft.content.length,content:undefined}));
      const knownIds=sources.map(v=>v+'_en');
      assert(draft.status==='draft'&&draft.title==='Home'
        &&['','vi','en'].includes(draft.lang||'')
        &&(!draft.key||draft.key==='home')
        &&(!draft.action||draft.action==='HomePage')
        &&(!draft.origin||draft.origin==='82467')
        &&(!draft.content.trim()||knownIds.some(v=>draft.content.includes(v))),
        'Home draft does not match incomplete English homepage; refusing modification');
    }else{
      // Create only if neither a published page nor an existing draft exists.
      await page.goto(`${wp}/wp-admin/post-new.php?post_type=page&esc_ml_origin=82467&esc_ml_lang=en`,{waitUntil:'domcontentloaded',timeout:45000});
    }
  }
  const fields=await page.locator('.acf-field[data-name]').evaluateAll(els=>els.filter(el=>['key','action','product_lang','origin_page_id'].includes(el.dataset.name)).map(el=>({name:el.dataset.name,inputs:[...el.querySelectorAll('input,select')].map(i=>({type:i.type,name:i.name,value:i.value,id:i.id,options:i.tagName==='SELECT'?[...i.options].map(x=>({value:x.value,label:x.text})):undefined})).slice(0,10)})));
  console.log('EN_PAGE_ACF_UI='+JSON.stringify(fields));
  await page.locator('#title').fill('Home');
  await page.locator('[data-name="key"] input[type="text"]').fill('home');
  await page.locator('[data-name="action"] input[type="text"]').fill('HomePage');
  const lang=page.locator('[data-name="product_lang"]');assert(await lang.count()===1,'Missing ACF language');
  if(await lang.locator('select').count())await lang.locator('select').first().selectOption('en');
  else if(await lang.locator('input[value="en"]').count())await lang.locator('input[value="en"]').first().check();
  else throw Error('Unsupported English language field');
  const parent=page.locator('[data-name="origin_page_id"]');assert(await parent.count()===1,'Missing translation parent field');
  if(await parent.locator('input[type="number"]').count())await parent.locator('input[type="number"]').first().fill('82467');
  else if(await parent.locator('input[type="text"]').count())await parent.locator('input[type="text"]').first().fill('82467');
  else if(await parent.locator('select').count()){
    const select=parent.locator('select').first();
    const selected=await select.inputValue();
    if(selected==='82467')console.log('EN_PAGE_NATIVE_ORIGIN_PREFILL=PASS');
    else {
      // ACF's AJAX-backed Select2 does not include unloaded IDs in <option>.
      // Use the native picker and verify the saved option's actual ID.
      const picker=parent.locator('.select2-selection').first();
      await page.waitForLoadState('load');
      await picker.waitFor({state:'visible',timeout:12000}).catch(()=>null);
      const pickerReady=await picker.isVisible().catch(()=>false);
      if(!pickerReady){
        const debug=await parent.evaluate(el=>({
          ui:el.querySelector('select')?.dataset.ui,
          ajax:el.querySelector('select')?.dataset.ajax,
          selectClass:el.querySelector('select')?.className,
          acfAvailable:Boolean(window.acf),
          readyState:document.readyState,
          childClasses:[...el.querySelectorAll('[class]')].map(z=>z.className).filter(x=>typeof x==='string').slice(0,10)
        }));
        console.log('EN_PAGE_ACF_PICKER_NOT_READY='+JSON.stringify(debug));
      }
      assert(pickerReady,'Native ACF origin picker is unavailable after initialization');
      await picker.click();
      const search=page.locator('.select2-container--open input.select2-search__field').first();
      await search.fill('Trang chủ');
      const options=page.locator('.select2-container--open .select2-results__option[role="option"]');
      await options.first().waitFor({state:'visible',timeout:15000});
      console.log('EN_PAGE_ORIGIN_RESULTS='+JSON.stringify((await options.allTextContents()).slice(0,8)));
      const result=options.filter({hasText:'Trang chủ'}).first();
      await result.waitFor({state:'visible',timeout:22000});
      console.log('EN_PAGE_ORIGIN_MATCH='+String(await result.textContent()).trim());
      assert(await result.count()>0,'WordPress did not offer the original Vietnamese homepage');
      await result.click();
      assert(await select.inputValue()==='82467','Selected translation origin is not the original homepage');
      console.log('EN_PAGE_NATIVE_ORIGIN_SELECTED=PASS');
    }
  }
  else throw Error('Unsupported origin_page_id ACF field, no publication');
  const content=await page.locator('#content').inputValue();
  const ids=sources.map(s=>s+'_en');assert(!content.trim()||ids.some(id=>content.includes(id)),'Existing English Page content not recognized; no overwrite');
  const visual=page.locator('#content-tmce');if(await visual.count())await visual.click();
  await page.waitForFunction(()=>Boolean(window.tinymce?.get('content')?.initialized&&!window.tinymce?.get('content')?.isHidden()),null,{timeout:22000});
  for(const id of ids){const current=await page.evaluate(()=>window.tinymce?.get('content')?.getContent?.()||document.querySelector('#content')?.value||'');if(current.includes(id)){console.log('EN_NATIVE_INSERT_SKIP='+id);continue;}
    await page.evaluate(()=>{const ed=window.tinymce.get('content');ed.focus();ed.selection.select(ed.getBody(),true);ed.selection.collapse(false);if(document.querySelector('#TB_window')&&window.tb_remove)window.tb_remove();});
    await page.evaluate(()=>{if(typeof window.tablepress_open_shortcode_thickbox!=='function')throw Error('Native Insert Code picker unavailable');window.tablepress_open_shortcode_thickbox();});
    const picker=page.frameLocator('#TB_iframeContent');const choose=picker.locator(`input.insert-shortcode[title*="${id}"]`);await choose.waitFor({state:'visible',timeout:22000});await choose.click();
    let found=false;for(let tries=0;tries<8;tries++){await page.waitForTimeout(400);let body=await page.evaluate(()=>window.tinymce?.get('content')?.getContent?.()||'');if(body.includes(id)){found=true;break;}}assert(found,'Native shortcode was not inserted '+id);console.log('EN_NATIVE_INSERT='+id+' PASS');
  }
  await page.locator('#content-html').click();const savedContent=await page.locator('#content').inputValue();assert(ids.every(id=>savedContent.includes(id)),'English page incomplete; no publish');
  const isPublished=await page.locator('#post_status').inputValue().then(x=>x==='publish').catch(()=>false);
  // First persist as draft, then validate title / lang / parent / slug before publication.
  if(!pageId){await page.locator('#save-post').click();await page.waitForTimeout(1800);pageId=Number(await page.locator('#post_ID').inputValue());assert(pageId>0,'Cannot identify newly saved English Page');}
  else {await (isPublished?page.locator('#publish'):page.locator('#save-post')).click();await page.waitForTimeout(1800);}
  await page.goto(`${wp}/wp-admin/post.php?post=${pageId}&action=edit`,{waitUntil:'domcontentloaded',timeout:45000});
  const slugEdit=page.locator('#edit-slug-buttons .edit-slug');if(await slugEdit.count()&&await slugEdit.isVisible()){
    await slugEdit.click();const field=page.locator('#new-post-slug');await field.fill('en');await page.locator('#edit-slug-buttons .save').click();await page.waitForTimeout(500);
  }else{const input=page.locator('#post_name');if(await input.count())await input.fill('en');else throw Error('Cannot set English Page slug');}
  const beforePublish=await page.evaluate(()=>({id:document.querySelector('#post_ID')?.value,slug:document.querySelector('#editable-post-name-full')?.textContent?.trim()||document.querySelector('#post_name')?.value,language:document.querySelector('[data-name="product_lang"] select')?.value||document.querySelector('[data-name="product_lang"] input:checked')?.value,origin:document.querySelector('[data-name="origin_page_id"] input')?.value||document.querySelector('[data-name="origin_page_id"] select')?.value,key:document.querySelector('[data-name="key"] input')?.value,content:document.querySelector('#content')?.value||''}));
  console.log('EN_PAGE_BEFORE_PUBLISH='+JSON.stringify({...beforePublish,content:`${beforePublish.content.length} chars` }));
  assert(beforePublish.key==='home'&&beforePublish.language==='en'&&String(beforePublish.origin)==='82467'&&String(beforePublish.slug).includes('en'),'English Page ACF/slug not verified');
  assert(ids.every(id=>beforePublish.content.includes(id)),'English Page shortcodes missing');
  await (isPublished?page.locator('#publish'):page.locator('#publish')).click();await page.waitForTimeout(2000);
  await page.goto(`${wp}/wp-admin/post.php?post=${pageId}&action=edit`,{waitUntil:'domcontentloaded',timeout:45000});
  const actual=await page.evaluate(()=>({status:document.querySelector('#post_status')?.value,slug:document.querySelector('#editable-post-name-full')?.textContent?.trim()||document.querySelector('#post_name')?.value,lang:document.querySelector('[data-name="product_lang"] select')?.value||document.querySelector('[data-name="product_lang"] input:checked')?.value,origin:document.querySelector('[data-name="origin_page_id"] input')?.value||document.querySelector('[data-name="origin_page_id"] select')?.value,content:document.querySelector('#content')?.value||''}));
  assert(actual.status==='publish'&&actual.lang==='en'&&actual.origin==='82467'&&actual.slug==='en'&&ids.every(x=>actual.content.includes(x)),'English Page readback incomplete: '+JSON.stringify({...actual,content:actual.content.length}));
  console.log(`EN_PAGE_PUBLISHED=PASS id=${pageId} slug=${actual.slug} blocks=${ids.length}`);
}
try{await page.goto(wp+'/wp-login.php',{waitUntil:'domcontentloaded',timeout:45000});await page.locator('#user_login').fill(user);await page.locator('#user_pass').fill(password);await Promise.all([page.waitForURL(/\/wp-admin\//,{timeout:45000}),page.locator('#wp-submit').click()]);console.log('EN_WRITE_AUTH=PASS');for(const id of sources)await ensureTable(id);await ensurePage();console.log('EN_HOME_CMS_COMPLETE=PASS');}finally{await browser.close();}
