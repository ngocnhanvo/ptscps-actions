import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Admin-authenticated read-only attribution for the TWO already failed second-row queries.
// Do not retain the queries, source IDs, row text, CMS documents or credentials.
const originLines = (process.env.ENV_FILE || '').split(/\r?\n/)
  .filter(x => /^\s*(?:export\s+)?WC_URL\s*=/.test(x));
if (originLines.length !== 1) throw new Error('Missing or ambiguous WordPress origin');
const raw = originLines[0].split('=').slice(1).join('=').trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['', '/'].includes(url.pathname) || url.search || url.hash ||
    !url.hostname.endsWith('thegioihosting.io.vn')) throw new Error('Unsafe origin');
const origin = url.origin;
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('Missing admin credentials');

const browser = await chromium.launch({ headless: true });
let report;
try {
  const page = await browser.newPage();
  await page.goto(origin + '/wp-login.php', { waitUntil:'domcontentloaded', timeout:45000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin && u.pathname.startsWith('/wp-admin/'), { timeout:45000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(origin + '/wp-admin/tools.php?page=esc-agent-knowledge-index',
    { waitUntil:'domcontentloaded', timeout:45000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({state:'visible', timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('No audit nonce');
  const response = await page.context().request.post(origin + '/wp-admin/admin-post.php', {
    form: {action:'esc_agent_retrieval_readonly_audit', _wpnonce:nonce, ordinal_only:'1'},
    timeout:120000,
  });
  if (response.status() !== 200) throw new Error('Audit HTTP '+response.status());
  report = await response.json();
} finally {await browser.close();}
if (report?.report_version !== 1 || report?.mode !== 'read_only' ||
    report.scope !== 'two_failed_second_service_rows' || !Array.isArray(report.cases) ||
    report.cases.length !== 2) throw new Error('Unexpected audit scope');
const expected = ['vi_services_second', 'en_services_second'];
const results = report.cases.map((c, i) => {
  if (c?.case !== expected[i] || !['read', 'missing_published_source', 'not_published'].includes(c.status))
    throw new Error('Unexpected case');
  if (c.status !== 'read') return {case:expected[i],status:c.status};
  const nums = ['post_metadata_affinity','canonical_metadata_affinity','top5_count','indexed_chunks',
                'indexed_positions','wrong_locale_hits'];
  if (!nums.every(k => Number.isSafeInteger(c[k]) && c[k] >= 0) ||
      typeof c.model_loaded !== 'boolean' || typeof c.first_source_matches !== 'boolean' ||
      typeof c.indexed_second_position !== 'boolean' ||
      !(c.expected_source_rank === null || (Number.isInteger(c.expected_source_rank) &&
        c.expected_source_rank >= 1 && c.expected_source_rank <= 5)))
    throw new Error('Invalid audit metrics');
  return {case: expected[i], status: 'read', model_loaded: c.model_loaded,
    post_metadata_affinity:c.post_metadata_affinity,
    canonical_metadata_affinity:c.canonical_metadata_affinity,
    expected_source_rank:c.expected_source_rank,
    first_source_matches:c.first_source_matches,
    first_retrieval_method: String(c.first_retrieval_method || 'none').slice(0,40),
    top5_count:c.top5_count, indexed_chunks:c.indexed_chunks,
    indexed_positions:c.indexed_positions,
    indexed_second_position:c.indexed_second_position,
    wrong_locale_hits:c.wrong_locale_hits};
});
const summary = {schema:1,mode:'read_only',php_sha:process.env.PTSCPS_SOURCE_SHA,
  scope:'two_existing_second_row_failures',cases:results,
  note:'No questions, source IDs, labels, answers, secrets, LLM calls, CMS writes or reindex.'};
await mkdir('audit',{recursive:true});
await writeFile('audit/ptscps-agent-ordinal-source-audit-summary.json',JSON.stringify(summary,null,2)+'\n',
  {mode:0o600});
for (const row of results) console.log('PTSCPS_ORDINAL_READONLY_CASE='+JSON.stringify(row));
if (results.some(r => r.status !== 'read')) throw new Error('Published source unavailable');
