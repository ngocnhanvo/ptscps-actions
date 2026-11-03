import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Admin-authenticated read-only collection source probe; aggregate output only.
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

const browser = await chromium.launch({ headless:true });
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, { waitUntil:'domcontentloaded', timeout:45000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin.origin && u.pathname.startsWith('/wp-admin/'), { timeout:45000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    { waitUntil:'domcontentloaded', timeout:45000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({ state:'visible', timeout:15000 });
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only audit nonce missing');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form:{ action:'esc_agent_retrieval_readonly_audit', _wpnonce:nonce, compare_collection:'1' },
    timeout:120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only endpoint HTTP ${response.status()}`);
  report = await response.json();
} finally { await browser.close(); }

if (report?.mode !== 'read_only' || report.report_version !== 1 ||
    !Array.isArray(report.cases)) throw new Error('Invalid read-only audit report');
const ids = ['vi_services','en_services','vi_clients','en_clients'];
const out = {};
for (const id of ids) {
  const rows = report.cases.filter(x => x.kind === 'natural' && x.case_id === id);
  if (rows.length !== 1) throw new Error(`QA case ${id} missing or duplicated`);
  const c = rows[0];
  const p = c.collection_source_probe;
  if (!p || !Number.isSafeInteger(p.metadata_affinity) || p.metadata_affinity < 0 ||
      !Number.isSafeInteger(p.title_words) || !Number.isSafeInteger(p.description_words) ||
      !Number.isSafeInteger(p.image_elements) || !Number.isSafeInteger(p.indexed_chunks) ||
      typeof p.has_source_text !== 'boolean') throw new Error('Missing source probe metrics');
  out[id] = {
    fact_hit:Number.isInteger(c.expected_rank) && c.expected_rank >= 1 && c.expected_rank <= 5,
    collection_hit:Number.isInteger(c.collection_comparison?.expected_rank) &&
      c.collection_comparison.expected_rank >= 1 && c.collection_comparison.expected_rank <= 5,
    stage:c.diagnostic?.stage ?? 'unknown',
    metadata_affinity:p.metadata_affinity, title_words:p.title_words,
    description_words:p.description_words, image_elements:p.image_elements,
    indexed_chunks:p.indexed_chunks, has_source_text:p.has_source_text,
    wrong_locale_hits:c.wrong_locale_hits + c.collection_comparison.wrong_locale_hits,
  };
}
const result = { schema:1, mode:'read_only', source_sha:process.env.PTSCPS_SOURCE_SHA,
  cases:out, note:'Published-source aggregate metadata only. No source text, IDs, queries or credentials.' };
await mkdir('audit',{ recursive:true });
await writeFile('audit/ptscps-agent-rag-run03-source-probe-summary.json',
  JSON.stringify(result,null,2)+'\n',{mode:0o600});
console.log('PTSCPS_RUN03_SOURCE_PROBE=PASS cases=4 metadata_only=1 wrong_locale='+
  Object.values(out).reduce((sum,x)=>sum+x.wrong_locale_hits,0));
