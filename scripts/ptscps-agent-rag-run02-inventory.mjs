import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// RUN 02: authenticated READ ONLY census; never persist CMS source IDs, content or credentials.
const values = (process.env.ENV_FILE || '').split(/\r?\n/)
  .filter(line => /^\s*(?:export\s+)?WC_URL\s*=/.test(line));
if (values.length !== 1) throw new Error('Expected exactly one configured WC_URL');
const raw = values[0].split('=').slice(1).join('=').trim()
  .replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b);
const url = new URL(raw);
if (url.protocol !== 'https:' || url.username || url.password || url.port ||
    !['', '/'].includes(url.pathname) || url.search || url.hash)
  throw new Error('Unsafe WordPress origin');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('Authorized WordPress Admin credentials unavailable');

const browser = await chromium.launch({ headless: true });
let report;
try {
  const page = await browser.newPage();
  await page.goto(`${url.origin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(u => u.origin === url.origin && u.pathname.startsWith('/wp-admin/'), { timeout: 45000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${url.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`,
    { waitUntil: 'domcontentloaded', timeout: 45000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_export_knowledge_inventory"])');
  await form.waitFor({ state: 'visible', timeout: 15000 });
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  if (!nonce) throw new Error('Read-only inventory nonce unavailable');
  const response = await page.context().request.post(`${url.origin}/wp-admin/admin-post.php`, {
    form: { action: 'esc_agent_export_knowledge_inventory', _wpnonce: nonce }, timeout: 120000,
  });
  if (!response.ok()) throw new Error(`Inventory HTTP ${response.status()}`);
  const data = await response.json();
  if (data?.mode !== 'read_only' || !Array.isArray(data.sources) || !data.counts || !data.types)
    throw new Error('Unrecognized read-only inventory schema');
  const counts = data.counts;
  const fields = ['total','published','eligible','vi','en','unclassified','indexed','missing_index','orphan_index'];
  for (const key of fields) if (!Number.isSafeInteger(counts[key]) || counts[key] < 0)
    throw new Error(`Invalid count: ${key}`);
  const sources = data.sources;
  const published = sources.filter(row => row.status === 'publish');
  const eligible = published.filter(row => typeof row.language === 'string' && row.language.length > 0);
  const missing = sources.filter(row => row.issue === 'missing_index');
  const orphans = sources.filter(row => row.issue === 'orphan_index');
  const observedLanguages = {};
  for (const row of eligible) observedLanguages[row.language] = (observedLanguages[row.language] || 0) + 1;
  if (counts.published !== published.length || counts.eligible !== eligible.length ||
      counts.missing_index !== missing.length || counts.orphan_index !== orphans.length ||
      counts.total !== sources.length - orphans.length ||
      counts.published !== counts.eligible + counts.unclassified ||
      counts.vi !== (observedLanguages.vi || 0) || counts.en !== (observedLanguages.en || 0))
    throw new Error('Inventory counts inconsistent with source enumeration');
  const dynamicCounts = counts.languages;
  const dynamicSchema = dynamicCounts && typeof dynamicCounts === 'object' && !Array.isArray(dynamicCounts);
  if (dynamicSchema) {
    for (const [language, count] of Object.entries(observedLanguages))
      if (dynamicCounts[language] !== count) throw new Error(`Language census mismatch for ${language}`);
    if (Object.values(dynamicCounts).some(n => !Number.isSafeInteger(n) || n < 0) ||
        Object.values(dynamicCounts).reduce((a, b) => a + b, 0) !== counts.eligible)
      throw new Error('Dynamic language census incomplete');
  }
  const orphanTypes = {};
  for (const row of orphans) orphanTypes[row.type] = (orphanTypes[row.type] || 0) + 1;
  const types = Object.fromEntries(Object.entries(data.types).map(([type, value]) => [type, {
    total: Number(value.total), published: Number(value.published), indexed: Number(value.indexed),
  }]));
  report = {
    schema: 1, mode: 'read_only', action_sha: process.env.GITHUB_SHA || '',
    inventory_http: response.status(), dynamic_language_schema: Boolean(dynamicSchema),
    counts: Object.fromEntries(fields.map(k => [k, counts[k]])),
    languages: observedLanguages, types, orphan_groups_by_type: orphanTypes,
    status: 'PASS_READ_ONLY_CENSUS',
    note: 'Not a deploy, index refresh, retrieval quality, or full RAG acceptance result.',
  };
  await mkdir('audit', { recursive: true });
  await writeFile('audit/ptscps-agent-rag-run02-inventory.json', JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  console.log(`PTSCPS_RUN02_CENSUS=PASS published=${counts.published} eligible=${counts.eligible} indexed=${counts.indexed} missing=${counts.missing_index} orphan_groups=${counts.orphan_index} dynamic_locale_schema=${Boolean(dynamicSchema)}`);
  console.log(`PTSCPS_RUN02_TYPES=${JSON.stringify(types)}`);
  console.log(`PTSCPS_RUN02_LANGUAGES=${JSON.stringify(observedLanguages)}`);
} finally {
  await browser.close();
}
