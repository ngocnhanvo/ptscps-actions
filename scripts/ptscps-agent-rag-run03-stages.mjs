import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// RUN03: authenticated read-only stage attribution. Never persist query/source IDs,
// source content, cookie, credentials, or per-case data. No CMS/index/provider writes.
const entries = (process.env.ENV_FILE || '').split(/\r?\n/).filter(x => /^\s*(?:export\s+)?WC_URL\s*=/.test(x));
if (entries.length !== 1) throw new Error('Expected exactly one WP origin');
const raw = entries[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || !origin.hostname || origin.username || origin.password || origin.port ||
    !['', '/'].includes(origin.pathname) || origin.search || origin.hash) throw new Error('Unsafe WP origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) throw new Error('Missing admin credentials');
const browser = await chromium.launch({headless:true});
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
  await form.waitFor({state:'visible',timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Missing read-only audit nonce');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form: {action:'esc_agent_retrieval_readonly_audit',_wpnonce:nonce}, timeout:120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only audit HTTP ${response.status()}`);
  report = await response.json();
} finally { await browser.close(); }
if (report?.mode !== 'read_only' || report.report_version !== 1 ||
    !Array.isArray(report.cases) || !Number.isSafeInteger(report.source_count) ||
    report.source_count < 1 || report.cases.length !== report.counts?.cases)
  throw new Error('Invalid retrieval report schema');
const allowed = new Set(['top5_hit','locale_or_runtime_mismatch','missing_index_rows','no_meaningful_tokens',
  'sql_no_lexical_match','sql_candidate_budget','rank_token_coverage','rank_score_threshold',
  'strong_authoritative_collapse','post_rank_final_selection','rank_top_eight_competition']);
const stages = {};
const byType = {};
const byLanguage = {};
let hits=0, misses=0, wrong=0;
for (const c of report.cases) {
  if (!Array.isArray(c.top5) || c.top5.length > 5 || !Number.isSafeInteger(c.wrong_locale_hits))
    throw new Error('Invalid per-case schema');
  const stage = c.diagnostic?.stage;
  if (!allowed.has(stage)) throw new Error('Missing/invalid live stage diagnostics');
  const hit = Number.isInteger(c.expected_rank) && c.expected_rank >= 1 && c.expected_rank <= 5;
  if (hit !== (stage === 'top5_hit')) throw new Error('Stage/hit mismatch');
  hits += Number(hit); misses += Number(!hit); wrong += c.wrong_locale_hits;
  stages[stage] = (stages[stage] || 0) + 1;
  for (const [target,key] of [[byType,c.expected_type],[byLanguage,c.language]]) {
    if (typeof key !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(key)) throw new Error('Unsafe grouping key');
    target[key] ||= {cases:0,hits:0,misses:0,stages:{}};
    target[key].cases++;
    target[key].hits += Number(hit);
    target[key].misses += Number(!hit);
    target[key].stages[stage] = (target[key].stages[stage] || 0) + 1;
  }
}
if (hits !== report.counts.top5_hits || misses !== report.counts.top5_misses ||
    wrong !== report.counts.wrong_locale_hits) throw new Error('Aggregate mismatch');
const summary = {schema:1,mode:'read_only',diagnostic:'run03_stage_attribution',
  source_sha:process.env.PTSCPS_SOURCE_SHA,source_count:report.source_count,
  cases:report.cases.length,top5_hits:hits,top5_misses:misses,wrong_locale_hits:wrong,
  recall_at_5:Number((hits/report.cases.length).toFixed(4)),stages,by_source_type:byType,
  by_language:byLanguage,
  notes:['No source IDs, queries, titles, URLs, excerpts, cookies, credentials or per-case data persisted.',
    'Stage labels identify the first observed gate, not proof of a single causal defect.',
    'No reindex, CMS write, LLM call or Astro build.']};
await mkdir('audit',{recursive:true});
await writeFile('audit/ptscps-agent-rag-run03-stages-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(`PTSCPS_RUN03_STAGES=PASS cases=${summary.cases} hits=${hits} misses=${misses} wrong_locale=${wrong} stage_counts=${JSON.stringify(stages)}`);
console.log('PTSCPS_RUN03_RETRIEVAL_QA='+(summary.recall_at_5 >= .95 && wrong === 0 ? 'PASS' : 'FAIL'));
