import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Read-only comparison of existing four source-grounded QA cases.
// Never log or persist source IDs, CMS content, queries, tokens, URLs or credentials.
const entries = (process.env.ENV_FILE || '').split(/\r?\n/)
  .filter(line => /^\s*(?:export\s+)?WC_URL\s*=/.test(line));
if (entries.length !== 1) throw new Error('Expected exactly one WordPress origin');
const raw = entries[0].split('=').slice(1).join('=').trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || !origin.hostname || origin.username || origin.password ||
    origin.port || !['', '/'].includes(origin.pathname) || origin.search || origin.hash)
  throw new Error('Unsafe WordPress origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('Missing WordPress admin credentials');

const browser = await chromium.launch({headless:true});
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, {waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin.origin && u.pathname.startsWith('/wp-admin/'), {timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    {waitUntil:'domcontentloaded',timeout:45000});
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({state:'visible',timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only audit nonce missing');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form:{action:'esc_agent_retrieval_readonly_audit',_wpnonce:nonce,compare_collection:'1'},
    timeout:120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only endpoint HTTP ${response.status()}`);
  report = await response.json();
} finally { await browser.close(); }

if (report?.mode !== 'read_only' || report.report_version !== 1 ||
    !Array.isArray(report.cases) || report.counts?.cases !== report.cases.length)
  throw new Error('Invalid read-only report schema');
const ids = ['vi_services','en_services','vi_clients','en_clients'];
const cases = {};
let factHits = 0, collectionHits = 0, wrongLocale = 0;
for (const c of report.cases.filter(x => x.kind === 'natural')) {
  if (!ids.includes(c.case_id) || Object.hasOwn(cases,c.case_id) ||
      !Number.isSafeInteger(c.wrong_locale_hits) || !Array.isArray(c.top5) || c.top5.length > 5)
    throw new Error('Malformed natural fact-mode case');
  const compare = c.collection_comparison;
  if (!compare || !Array.isArray(compare.methods) ||
      !Number.isSafeInteger(compare.top5_count) || compare.top5_count < 0 || compare.top5_count > 5 ||
      !Number.isSafeInteger(compare.wrong_locale_hits) || compare.wrong_locale_hits < 0 ||
      compare.methods.some(x => !['ranked','authoritative_anchor','published_collection_source'].includes(x)))
    throw new Error('Collection-mode comparison missing or invalid');
  const factHit = Number.isInteger(c.expected_rank) && c.expected_rank >= 1 && c.expected_rank <= 5;
  const collectionHit = Number.isInteger(compare.expected_rank) && compare.expected_rank >= 1 && compare.expected_rank <= 5;
  factHits += Number(factHit);
  collectionHits += Number(collectionHit);
  wrongLocale += c.wrong_locale_hits + compare.wrong_locale_hits;
  cases[c.case_id] = {
    fact_hit:factHit, collection_hit:collectionHit,
    fact_stage:c.diagnostic?.stage ?? 'unknown',
    collection_method:compare.methods,
    fact_top5_count:c.top5.length, collection_top5_count:compare.top5_count,
    wrong_locale_hits:c.wrong_locale_hits+compare.wrong_locale_hits,
  };
}
if (ids.some(id => !Object.hasOwn(cases,id))) throw new Error('Natural QA cases absent');
const summary = {
  schema:1, mode:'read_only', diagnostic:'run03_natural_fact_vs_collection',
  source_sha:process.env.PTSCPS_SOURCE_SHA || 'unverified',
  cases_count:ids.length, fact_hits:factHits, collection_hits:collectionHits,
  wrong_locale_hits:wrongLocale,
  cases:Object.fromEntries(ids.map(id => [id,cases[id]])),
  notes:['Existing four QA cases only; no source/query/content/credential in artifact.',
    'This is retrieval mode comparison, not factual answer or RUN07 acceptance.',
    'No CMS writes, reindex, provider calls, backfill or Astro build.'],
};
await mkdir('audit',{recursive:true});
await writeFile('audit/ptscps-agent-rag-run03-mode-compare-summary.json',
  JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(`PTSCPS_RUN03_MODE_COMPARE=PASS fact=${factHits}/4 collection=${collectionHits}/4 wrong_locale=${wrongLocale}`);
console.log('PTSCPS_RUN03_RETRIEVAL_GATE='+(factHits===4&&collectionHits===4&&wrongLocale===0?'PASS':'FAIL'));
