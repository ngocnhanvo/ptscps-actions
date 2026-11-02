import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Production, read-only audit. Never log prompts, answers, credentials, sessions or CMS bodies.
const rawConfig = process.env.ENV_FILE || '';
function originFor(name, host) {
  const values = rawConfig.split(/\r?\n/).filter(line => new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=`).test(line));
  if (values.length !== 1) throw new Error(`Expected exactly one ${name}`);
  const raw = values[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
  const url = new URL(raw);
  if (url.protocol !== 'https:' || url.hostname !== host || !['', '/'].includes(url.pathname)
      || url.port || url.search || url.hash || url.username || url.password) {
    throw new Error(`Unexpected ${name} production origin`);
  }
  return url.origin;
}
const wordpress = originFor('WC_URL', 'admin-ptscps.thegioihosting.io.vn');
const frontend = originFor('WC_URL_CLIENT', 'ptscps.thegioihosting.io.vn');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) throw new Error('No authorized WP Admin session');

const tableIds = [
  'home_00', 'home_01', 'home_02', 'home_03', 'home_04', 'home_05', 'home_14', 'home_15',
  'home_00_en', 'home_01_en', 'home_02_en', 'home_03_en', 'home_04_en', 'home_05_en', 'home_14_en', 'home_15_en',
];
const report = {schema:1, mode:'read_only', php_sha:'3144e27804baa79f00b94fd64342a8b75a39a3b5',
  backfill_run:41381347856, action_sha:process.env.GITHUB_SHA || '', inventory:null, tablepress:null,
  agent_tests:[], notes:[]};
let browser;
try {
  browser = await chromium.launch({headless:true});
  const page = await browser.newPage();
  await page.goto(`${wordpress}/wp-login.php`, {waitUntil:'domcontentloaded', timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u=>u.origin===wordpress && u.pathname.startsWith('/wp-admin/'),{timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${wordpress}/wp-admin/tools.php?page=esc-agent-knowledge-index`, {waitUntil:'domcontentloaded',timeout:45000});
  const form = page.locator('form:has(input[name="action"][value="esc_agent_export_knowledge_inventory"])');
  await form.waitFor({state:'visible',timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Inventory nonce not found');
  const response = await page.context().request.post(`${wordpress}/wp-admin/admin-post.php`,{
    form:{action:'esc_agent_export_knowledge_inventory',_wpnonce:nonce},timeout:120000,
  });
  if (!response.ok()) throw new Error(`Authenticated inventory HTTP ${response.status()}`);
  const census = await response.json();
  const counts = census?.counts;
  if (census?.mode !== 'read_only' || !counts || !Array.isArray(census.sources))
    throw new Error('Inventory schema mismatch');
  const byType = census.types || {};
  const missing = census.sources.filter(x=>x.issue==='missing_index').length;
  const tableEntries = census.sources.filter(x=>x.type==='tablepress' && x.status==='publish');
  const types = Object.fromEntries(['page','post','product','tablepress_table'].map(type =>
    [type,{total:Number(byType[type]?.total??-1), published:Number(byType[type]?.published??-1), indexed:Number(byType[type]?.indexed??-1)}]));
  const orphanBreakdown = Object.fromEntries(Object.entries(census.sources.filter(x=>x.issue==='orphan_index').reduce((acc,x)=>{
    acc[String(x.type)] = (acc[String(x.type)] || 0)+1; return acc;
  },{})).sort(([a],[b])=>a.localeCompare(b)));
  const covered = counts.eligible===18 && counts.indexed===18 && counts.missing_index===0
    && missing===0 && counts.vi===9 && counts.en===9 && tableEntries.length===16
    && tableEntries.every(x=>x.indexed_chunks>0) && types.page.published===2
    && types.post.published===0 && types.product.published===0 && types.tablepress_table.published===16;
  report.inventory = {status:covered?'PASS':'FAIL',counts,types,orphan_groups_by_type:orphanBreakdown};
  if (!covered) throw new Error('Production source census changed or has missing index');
  console.log(`PTSCPS_POSTBACKFILL_INVENTORY=PASS indexed=${counts.indexed}/${counts.eligible} missing=${missing} posts=${types.post.published} products=${types.product.published} orphan_groups=${counts.orphan_index}`);

  const clean = v => String(v??'').replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
    .replace(/<[^>]*>/g,' ').replace(/&(?:nbsp|amp|lt|gt|quot|#\d+);/gi,' ').replace(/\s+/g,' ').trim();
  const samples = {};
  let textRows = 0;
  for (const id of tableIds) {
    const res = await fetch(`${wordpress}/wp-json/tablepress/v1/table/${encodeURIComponent(id)}`, {
      redirect:'manual',headers:{Accept:'application/json'},signal:AbortSignal.timeout(25000)});
    if(res.status!==200) throw new Error(`Published TablePress unavailable: ${id} HTTP ${res.status}`);
    const table = await res.json();
    if(table?.success!==true || table.id!==id || !Array.isArray(table.items))
      throw new Error(`TablePress contract changed: ${id}`);
    const itemTexts = table.items.map(item => Object.values(item).map(clean).filter(Boolean).join(' ')).filter(Boolean);
    textRows += itemTexts.length;
    samples[id] = itemTexts;
  }
  report.tablepress = {status:'PASS',sources:tableIds.length,text_rows:textRows,vi:8,en:8};
  console.log(`PTSCPS_POSTBACKFILL_TABLEPRESS=PASS sources=16 text_rows=${textRows} vi=8 en=8`);

  // Limited live factual smoke, not the 100+ ground-truth acceptance suite.
  const cases = [
    {id:'vi_services',language:'vi',table:'home_03',question:'Những lĩnh vực dịch vụ nào được giới thiệu trên trang chủ PTSC?'},
    {id:'en_services',language:'en',table:'home_03_en',question:"Which service areas are listed on PTSC's homepage?"},
    {id:'vi_clients',language:'vi',table:'home_15',question:'Những khách hàng tiêu biểu nào được giới thiệu trên trang chủ PTSC?'},
    {id:'en_clients',language:'en',table:'home_15_en',question:'Which featured customers are shown on the PTSC homepage?'},
  ];
  const normalize = s => String(s??'').toLocaleLowerCase('vi').normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/đ/g,'d').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const exclusion = new Set(['and','the','for','ptsc','with','services','service','công','ty','khach','hang','dich','vu','trang','chu','ban','vi','en','home','company','these','this','nhung','tai','cua','duoc','gioi','thieu']);
  for (const c of cases) {
    const start = Date.now();
    let status=0,answer='',error='';
    try {
      const res = await fetch(`${frontend}/api/agent/chat`, {
        method:'POST',headers:{'Content-Type':'application/json',Origin:frontend,Accept:'application/json'},
        body:JSON.stringify({message:c.question,language:c.language}),redirect:'manual',
        signal:AbortSignal.timeout(65000),
      });
      status = res.status;
      const obj = await res.json().catch(()=>({}));
      answer = typeof obj.reply==='string'?obj.reply.trim():'';
      if (!answer) error='empty_reply';
    } catch (e) {error= e instanceof Error ? e.name : 'unknown_error';}
    const answerNorm = normalize(answer);
    const candidates = samples[c.table].flatMap(s=>{
      const terms=normalize(s).split(' ').filter(t=>t.length>=5 && !exclusion.has(t));
      return [...new Set(terms)].slice(0,12);
    });
    const distinct = [...new Set(candidates)];
    const grounding = distinct.filter(term => answerNorm.split(' ').includes(term)).length;
    const englishWords = (answer.match(/\b(?:the|and|website|services|company|client|clients|customers|our|provides|listed|includes|are|is|for|with|which)\b/gi)||[]).length;
    const vietnameseWords = (answer.match(/(?:^|\s)(?:khách|hàng|dịch|vụ|trang|công|ty|những|gồm|được|có|các|và|của|thông|tin)(?=\s|[.,;:!?]|$)/giu)||[]).length;
    const localeOK = c.language==='en' ? englishWords>=2 && vietnameseWords<=4 : vietnameseWords>=2;
    const pass = status===200 && answer.length>=40 && localeOK && grounding>=1 && !/PetroVietnam Transportation Corporation/i.test(answer);
    const diagnostic = {id:c.id,status:pass?'PASS':'FAIL',http_status:status,answer_chars:answer.length,
      locale_evidence:localeOK,grounding_word_hits:grounding,reference_word_count:distinct.length,
      elapsed_ms:Date.now()-start,error:error||null};
    report.agent_tests.push(diagnostic);
    console.log(`PTSCPS_POSTBACKFILL_AGENT_QA case=${c.id} status=${diagnostic.status} http=${status} locale=${localeOK} grounded_terms=${grounding} chars=${answer.length}`);
  }
} finally {
  await mkdir('audit',{recursive:true});
  report.agent_summary = {passed:report.agent_tests.filter(x=>x.status==='PASS').length,
    total:report.agent_tests.length, all_pass:report.agent_tests.length===4&&report.agent_tests.every(x=>x.status==='PASS')};
  await writeFile('audit/ptscps-agent-postbackfill-live-qa-result.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
  if(browser) await browser.close();
}
if (!report.agent_summary.all_pass) throw new Error('Grounded bilingual production Agent QA not fully verified; inspect artifact diagnostics');
console.log('PTSCPS_POSTBACKFILL_AGENT_LIVE_QA=PASS cases=4 (limited smoke, not 100-question acceptance)');
