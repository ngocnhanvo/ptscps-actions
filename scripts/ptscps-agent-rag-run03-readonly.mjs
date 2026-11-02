import { chromium } from 'playwright';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// Production RUN03: authenticated, read-only retrieval. Never print query, source IDs,
// CMS content, cookies or credentials. Encrypt the detailed report before uploading.
const lines = (process.env.ENV_FILE || '').split(/\r?\n/).filter(x => /^\s*(?:export\s+)?WC_URL\s*=/.test(x));
if (lines.length !== 1) throw new Error('Expected one WordPress origin');
const value = lines[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const url = new URL(value);
if (url.protocol !== 'https:' || !url.hostname || url.username || url.password || url.port ||
    !['', '/'].includes(url.pathname) || url.search || url.hash) throw new Error('Unsafe WordPress origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) throw new Error('Admin credentials missing');
const browser = await chromium.launch({headless:true});
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${url.origin}/wp-login.php`, {waitUntil:'domcontentloaded',timeout:45000});
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === url.origin && u.pathname.startsWith('/wp-admin/'), {timeout:45000}),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${url.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    {waitUntil:'domcontentloaded',timeout:45000});
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({state:'visible',timeout:15000});
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only QA nonce missing');
  const response = await page.context().request.post(`${url.origin}/wp-admin/admin-post.php`, {
    form: {action:'esc_agent_retrieval_readonly_audit',_wpnonce:nonce},timeout:120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only QA HTTP ${response.status()}`);
  report = await response.json();
  if (report?.mode !== 'read_only' || report?.report_version !== 1 || !Array.isArray(report.cases))
    throw new Error('Unexpected read-only retrieval report');
} finally { await browser.close(); }

const cases = report.cases;
const kinds = ['anchor','natural'];
const summary = {schema:1,mode:'read_only',source_sha:process.env.PTSCPS_SOURCE_SHA || '',
  source_count:report.source_count,case_count:cases.length,wrong_locale_hits:0,by_kind:{},by_language:{},
  missing_natural_cases:report.counts?.missing_natural_cases || [],
  note:'Anchor queries from live indexed headings/titles are NOT semantic/factual QA. Four natural probes reuse existing factual QA topics.'};
for (const kind of kinds) {
  const group = cases.filter(x => kind === 'natural' ? x.kind === 'natural' : x.kind?.startsWith('anchor_'));
  const hit = group.filter(x => Number.isInteger(x.expected_rank) && x.expected_rank >= 1 && x.expected_rank <= 5).length;
  summary.by_kind[kind] = {cases:group.length,top5_hits:hit,top5_misses:group.length-hit,
    recall_at_5:group.length ? Number((hit/group.length).toFixed(4)) : null};
}
for (const c of cases) {
  if (!['vi','en'].includes(c.language)) {
    // Other ACF locales remain valid; record them without changing classification.
    if (!/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/.test(c.language)) throw new Error('Invalid language in audit');
  }
  if (!Array.isArray(c.top5) || c.top5.length > 5 || !Number.isSafeInteger(c.wrong_locale_hits))
    throw new Error('Malformed retrieval case');
  const item = summary.by_language[c.language] ||= {cases:0,top5_hits:0,wrong_locale_hits:0};
  item.cases++;
  if (Number.isInteger(c.expected_rank) && c.expected_rank >= 1 && c.expected_rank <= 5) item.top5_hits++;
  item.wrong_locale_hits += c.wrong_locale_hits;
  summary.wrong_locale_hits += c.wrong_locale_hits;
}
if (!Number.isInteger(summary.source_count) || summary.source_count < 1 ||
    cases.length < 1 || report.counts?.cases !== cases.length ||
    report.counts?.wrong_locale_hits !== summary.wrong_locale_hits)
  throw new Error('Read-only QA counts inconsistent');
summary.qa_status = summary.wrong_locale_hits === 0 && summary.by_kind.anchor.cases >= summary.source_count &&
  summary.by_kind.anchor.recall_at_5 >= .95 && summary.by_kind.natural.cases === 4 &&
  summary.by_kind.natural.recall_at_5 >= .95 ? 'PASS' : 'FAIL';
await mkdir('audit', {recursive:true});
const plaintext = 'audit/ptscps-agent-rag-run03-private.json';
await writeFile(plaintext, JSON.stringify(report), {mode:0o600});
try {
  execFileSync('openssl',['cms','-encrypt','-binary','-aes256','-in',plaintext,
    '-outform','DER','-out','audit/ptscps-agent-rag-run03-private.cms',
    '-recip','source-control/config/request-encryption-cert.pem'], {stdio:'ignore'});
} finally { await unlink(plaintext); }
await writeFile('audit/ptscps-agent-rag-run03-summary.json',JSON.stringify(summary,null,2)+'\n',{mode:0o600});
console.log(`PTSCPS_RUN03_MEASUREMENT=PASS sources=${summary.source_count} anchors=${summary.by_kind.anchor.cases} anchor_hits=${summary.by_kind.anchor.top5_hits} natural=${summary.by_kind.natural.cases} natural_hits=${summary.by_kind.natural.top5_hits} wrong_locale=${summary.wrong_locale_hits}`);
console.log(`PTSCPS_RUN03_RETRIEVAL_QA=${summary.qa_status}`);
if (summary.qa_status !== 'PASS') throw new Error('RUN03 top-5 retrieval quality gate not met; inspect encrypted evidence');
