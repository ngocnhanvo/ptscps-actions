import { chromium } from 'playwright';
import { mkdir, writeFile, unlink } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';

// RUN03 canonical source-recall QA. Read-only WordPress audit only.
// Public artifact contains aggregate metrics; the detailed report is encrypted.
const lines = (process.env.ENV_FILE || '').split(/\r?\n/)
  .filter(line => /^\s*(?:export\s+)?WC_URL\s*=/.test(line));
if (lines.length !== 1) throw new Error('Expected exactly one WordPress origin');
const raw = lines[0].split('=').slice(1).join('=').trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || origin.hostname !== 'admin-ptscps.thegioihosting.io.vn' ||
    origin.username || origin.password || origin.port || !['', '/'].includes(origin.pathname) ||
    origin.search || origin.hash) throw new Error('Unsafe WordPress origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('Missing WordPress admin credentials');

const browser = await chromium.launch({ headless: true });
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === origin.origin && u.pathname.startsWith('/wp-admin/'), { timeout: 45000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_retrieval_readonly_audit"])');
  await form.waitFor({ state: 'visible', timeout: 15000 });
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only audit nonce missing');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form: {
      action: 'esc_agent_retrieval_readonly_audit',
      _wpnonce: nonce,
      canonical_source: '1',
    },
    timeout: 120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only audit HTTP ${response.status()}`);
  report = await response.json();
} finally {
  await browser.close();
}

if (report?.report_version !== 1 || report?.mode !== 'read_only' ||
    report?.method !== 'canonical_published_metadata_by_runtime_mode_plus_existing_diagnostics' ||
    !Number.isSafeInteger(report?.source_count) || report.source_count < 1 ||
    !Array.isArray(report?.cases)) throw new Error('Unexpected canonical source audit schema');

const cases = report.cases.filter(row => row?.kind === 'canonical_source');
if (cases.length !== report.source_count) throw new Error('Canonical source case/source count mismatch');

const summary = {
  schema: 1,
  mode: 'read_only',
  source_sha: process.env.PTSCPS_SOURCE_SHA || '',
  source_count: report.source_count,
  case_count: cases.length,
  top5_hits: 0,
  top5_misses: 0,
  recall_at_5: 0,
  wrong_locale_hits: 0,
  by_type: {},
  by_language: {},
  miss_stages: {},
  gate: { min_recall_at_5: 0.95, require_zero_wrong_locale: true },
  notes: [
    'Canonical published metadata is measured with the runtime retrieval mode: TablePress=collection; other indexed source types=fact.',
    'No CMS source IDs, queries, source text, credentials, cookies, or visitor chat are stored in the public summary.',
    'Semantic paraphrase and factual-answer acceptance remain separate gates; this run measures source identity recall only.',
  ],
};

for (const row of cases) {
  if (!row || typeof row.expected_type !== 'string' || row.expected_type === '' ||
      typeof row.language !== 'string' || row.language === '' ||
      !Number.isSafeInteger(row.wrong_locale_hits) || row.wrong_locale_hits < 0 ||
      !Array.isArray(row.top5) || row.top5.length > 5) throw new Error('Malformed canonical source case');
  const expectedMode = row.expected_type === 'tablepress' ? 'collection' : 'fact';
  if (row.search_mode !== expectedMode) throw new Error('Canonical source runtime mode mismatch');
  const hit = Number.isInteger(row.expected_rank) && row.expected_rank >= 1 && row.expected_rank <= 5;
  summary.top5_hits += Number(hit);
  summary.top5_misses += Number(!hit);
  summary.wrong_locale_hits += row.wrong_locale_hits;

  const type = summary.by_type[row.expected_type] ||= { cases: 0, top5_hits: 0, wrong_locale_hits: 0 };
  type.cases += 1;
  type.top5_hits += Number(hit);
  type.wrong_locale_hits += row.wrong_locale_hits;

  const language = summary.by_language[row.language] ||= { cases: 0, top5_hits: 0, wrong_locale_hits: 0 };
  language.cases += 1;
  language.top5_hits += Number(hit);
  language.wrong_locale_hits += row.wrong_locale_hits;

  if (!hit) {
    const stage = typeof row.diagnostic?.stage === 'string' && row.diagnostic.stage !== ''
      ? row.diagnostic.stage : 'unknown';
    summary.miss_stages[stage] = (summary.miss_stages[stage] || 0) + 1;
  }
}
summary.recall_at_5 = Number((summary.top5_hits / summary.case_count).toFixed(4));
summary.qa_status = summary.recall_at_5 >= summary.gate.min_recall_at_5 &&
  summary.wrong_locale_hits === 0 ? 'PASS' : 'FAIL';

await mkdir('audit', { recursive: true });
const plaintext = 'audit/ptscps-agent-rag-run03-canonical-source-private.json';
await writeFile(plaintext, JSON.stringify(report), { mode: 0o600 });
try {
  execFileSync('openssl', ['cms', '-encrypt', '-binary', '-aes256', '-in', plaintext,
    '-outform', 'DER', '-out', 'audit/ptscps-agent-rag-run03-canonical-source-private.cms',
    '-recip', 'source-control/config/request-encryption-cert.pem'], { stdio: 'ignore' });
} finally {
  await unlink(plaintext);
}
await writeFile('audit/ptscps-agent-rag-run03-canonical-source-summary.json',
  JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
console.log(`PTSCPS_RUN03_CANONICAL_SOURCE_QA=${summary.qa_status} hits=${summary.top5_hits}/${summary.case_count} recall=${summary.recall_at_5} wrong_locale=${summary.wrong_locale_hits}`);
if (summary.qa_status !== 'PASS') throw new Error('RUN03 canonical source recall gate not met');
