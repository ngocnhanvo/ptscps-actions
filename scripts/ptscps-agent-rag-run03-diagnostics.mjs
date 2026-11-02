import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// RUN03 targeted diagnostics: no CMS/index writes, provider calls or raw evidence artifacts.
// Fetch the existing privileged read-only audit and publish aggregates only.
const origins = (process.env.ENV_FILE || '').split(/\r?\n/).filter(x => /^\s*(?:export\s+)?WC_URL\s*=/.test(x));
if (origins.length !== 1) throw new Error('Expected exactly one WP origin');
const raw = origins[0].split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const origin = new URL(raw);
if (origin.protocol !== 'https:' || !origin.hostname || origin.username || origin.password || origin.port ||
    !['', '/'].includes(origin.pathname) || origin.search || origin.hash) throw new Error('Unsafe WP origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD) throw new Error('Missing admin credentials');
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
  if (!nonce) throw new Error('Missing read-only audit nonce');
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form: { action: 'esc_agent_retrieval_readonly_audit', _wpnonce: nonce }, timeout: 120000,
  });
  if (response.status() !== 200) throw new Error(`Read-only audit HTTP ${response.status()}`);
  report = await response.json();
} finally { await browser.close(); }
if (report?.mode !== 'read_only' || report.report_version !== 1 || !Array.isArray(report.cases) ||
    !Number.isSafeInteger(report.source_count) || report.source_count < 1 ||
    report.cases.length !== report.counts?.cases) throw new Error('Invalid retrieval report schema');

const aggregate = (rows) => {
  const hits = rows.filter(x => Number.isInteger(x.expected_rank) && x.expected_rank >= 1 && x.expected_rank <= 5);
  const misses = rows.filter(x => !hits.includes(x));
  const missingEmpty = misses.filter(x => x.top5.length === 0);
  const sameType = misses.filter(x => x.top5.some(y => y.source_type === x.expected_type));
  const top1Keys = misses.map(x => x.top5[0] ? `${x.top5[0].source_type}:${x.top5[0].source_id}` : '').filter(Boolean);
  const top1Counts = new Map();
  for (const k of top1Keys) top1Counts.set(k, (top1Counts.get(k) || 0) + 1);
  const scores = misses.map(x => Number(x.top5[0]?.score)).filter(Number.isFinite).sort((a,b)=>a-b);
  return { cases: rows.length, top5_hits: hits.length, top5_misses: misses.length,
    recall_at_5: rows.length ? Number((hits.length / rows.length).toFixed(4)) : null,
    empty_top5_misses: missingEmpty.length, same_type_competitor_misses: sameType.length,
    other_type_only_misses: misses.length - missingEmpty.length - sameType.length,
    misses_top1_score_ge_140: misses.filter(x => Number(x.top5[0]?.score) >= 140).length,
    distinct_top1_sources_on_misses: top1Counts.size,
    largest_repeated_top1_count: Math.max(0, ...top1Counts.values()),
    miss_top1_score_min: scores[0] ?? null, miss_top1_score_median: scores.length ? scores[Math.floor(scores.length/2)] : null,
  };
};
const cases = report.cases;
for (const c of cases) {
  if (!['anchor_indexed_heading','anchor_source_title','natural'].includes(c.kind) ||
      typeof c.language !== 'string' || !/^[a-z]{2,8}(?:-[a-z0-9]{2,8})*$/.test(c.language) ||
      typeof c.expected_type !== 'string' || !/^[a-z][a-z0-9_-]*$/.test(c.expected_type) ||
      !Array.isArray(c.top5) || c.top5.length > 5 || !Number.isSafeInteger(c.wrong_locale_hits))
    throw new Error('Invalid audit case');
}
const groupBy = (fn) => Object.fromEntries([...new Set(cases.map(fn))].sort().map(k =>
  [k, aggregate(cases.filter(c => fn(c) === k))]));
const summary = { schema: 1, mode: 'read_only', diagnostic: 'run03_miss_attribution_aggregates',
  source_sha: process.env.PTSCPS_SOURCE_SHA || '', source_count: report.source_count,
  total: aggregate(cases), by_kind: groupBy(c => c.kind),
  by_source_type: groupBy(c => c.expected_type), by_language: groupBy(c => c.language),
  by_type_and_language: groupBy(c => `${c.expected_type}/${c.language}`),
  wrong_locale_hits: cases.reduce((s,c)=>s+c.wrong_locale_hits,0),
  missing_natural_cases: report.counts?.missing_natural_cases || [],
  notes: [
    'Source-title/heading anchors are diagnostics, not factual QA.',
    'same_type_competitor_misses and top1 score are observations, not proof of SQL budget/threshold cause.',
    'No source IDs, queries, titles, URLs, excerpts, credentials or per-case data are persisted.',
    'No index rebuild, CMS write, LLM call, PHP upload or Astro build is performed.'
  ]
};
if (summary.wrong_locale_hits !== report.counts.wrong_locale_hits ||
    summary.total.top5_hits !== report.counts.top5_hits ||
    summary.total.cases !== report.counts.cases) throw new Error('Report counts mismatch');
await mkdir('audit', { recursive: true });
await writeFile('audit/ptscps-agent-rag-run03-diagnostics-summary.json',
  JSON.stringify(summary, null, 2) + '\n', { mode: 0o600 });
console.log(`PTSCPS_RUN03_DIAGNOSTICS=PASS sources=${summary.source_count} cases=${summary.total.cases} hits=${summary.total.top5_hits} misses=${summary.total.top5_misses} empty=${summary.total.empty_top5_misses} same_type_competitor=${summary.total.same_type_competitor_misses} wrong_locale=${summary.wrong_locale_hits}`);
