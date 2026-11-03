import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Four already-published synthetic QA questions, read-only classification.
// Never log or persist questions, CMS source IDs, text, tokens, URLs or secrets.
const raw = (process.env.ENV_FILE || '').split(/\r?\n/)
  .filter(line => /^\s*(?:export\s+)?WC_URL\s*=/.test(line));
if (raw.length !== 1) throw new Error('Expected exactly one WordPress origin');
const value = raw[0].split('=').slice(1).join('=').trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(value);
if (origin.protocol !== 'https:' || !origin.hostname || origin.username ||
    origin.password || origin.port || !['', '/'].includes(origin.pathname) ||
    origin.search || origin.hash) throw new Error('Unsafe origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('Missing WordPress admin credentials');

const browser = await chromium.launch({ headless:true });
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, {waitUntil:'domcontentloaded', timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin.origin && u.pathname.startsWith('/wp-admin/'), {timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    {waitUntil:'domcontentloaded', timeout:45000});
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({state:'visible', timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only audit nonce missing');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form:{action:'esc_agent_retrieval_readonly_audit', _wpnonce:nonce}, timeout:120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only endpoint HTTP ${response.status()}`);
  report = await response.json();
} finally { await browser.close(); }

if (report?.mode !== 'read_only' || report.report_version !== 1 ||
    !Array.isArray(report.cases) || report.counts?.cases !== report.cases.length)
  throw new Error('Invalid report schema');
const names = ['vi_services', 'en_services', 'vi_clients', 'en_clients'];
const allowedStages = new Set(['top5_hit','locale_or_runtime_mismatch','missing_index_rows',
  'no_meaningful_tokens','sql_no_lexical_match','sql_candidate_budget','rank_token_coverage',
  'rank_score_threshold','strong_authoritative_collapse','post_rank_final_selection',
  'rank_top_eight_competition']);
const cases = {};
let hits = 0;
let wrongLocale = 0;
for (const c of report.cases.filter(x => x.kind === 'natural')) {
  if (!names.includes(c.case_id) || Object.hasOwn(cases, c.case_id) ||
      !Array.isArray(c.top5) || c.top5.length > 5 ||
      !Number.isSafeInteger(c.wrong_locale_hits) || !allowedStages.has(c.diagnostic?.stage))
    throw new Error('Malformed natural-case diagnostic');
  const hit = Number.isInteger(c.expected_rank) && c.expected_rank >= 1 && c.expected_rank <= 5;
  if (hit !== (c.diagnostic.stage === 'top5_hit')) throw new Error('Natural-case hit/stage mismatch');
  cases[c.case_id] = {
    hit, stage:c.diagnostic.stage,
    rank:hit ? c.expected_rank : null,
    top5_count:c.top5.length,
    indexed_chunks:Number.isSafeInteger(c.diagnostic.indexed_chunks) ? c.diagnostic.indexed_chunks : null,
    sql_matching_chunks:Number.isSafeInteger(c.diagnostic.sql_matching_chunks) ? c.diagnostic.sql_matching_chunks : null,
    top1_score:Number.isSafeInteger(c.top5[0]?.score) ? c.top5[0].score : null,
  };
  hits += Number(hit);
  wrongLocale += c.wrong_locale_hits;
}
if (names.some(id => !Object.hasOwn(cases,id))) throw new Error('One or more natural QA cases absent');
const summary = {
  schema:1, mode:'read_only', diagnostic:'run03_natural_case_gate',
  production_php_sha:'0b96275c0da1b249ef3956a4b19188162eb0e2f7',
  total:names.length, hits, misses:names.length-hits, wrong_locale_hits:wrongLocale,
  cases:Object.fromEntries(names.map(id => [id, cases[id]])),
  notes:['Public synthetic case IDs only; no source IDs, source content, questions or credentials stored.',
    'Read-only diagnostic: no reindex, CMS write, LLM calls, PHP upload or Astro build.',
    'Four natural probes are not the >=100-case factual-answer acceptance suite.'],
};
await mkdir('audit',{recursive:true});
await writeFile('audit/ptscps-agent-rag-run03-natural-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(`PTSCPS_RUN03_NATURAL_DIAGNOSTIC=PASS natural_hits=${hits}/4 wrong_locale=${wrongLocale} stages=${JSON.stringify(Object.fromEntries(names.map(id => [id,cases[id].stage])))}`);
console.log('PTSCPS_RUN03_NATURAL_RETRIEVAL_QA='+(hits === 4 && wrongLocale === 0 ? 'PASS' : 'FAIL'));
