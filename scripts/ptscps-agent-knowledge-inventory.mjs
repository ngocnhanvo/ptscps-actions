import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';

// Credentialed, read-only WordPress Admin export. Never log cookies, source
// bodies, prompts, credentials, page text, or the downloaded source list.
const env = process.env.ENV_FILE || '';
const line = env.split(/\r?\n/).find(value => /^\s*WC_URL\s*=/.test(value));
const raw = line?.split('=').slice(1).join('=').trim().replace(/^(?:"(.*)"|'(.*)')$/, (_, a, b) => a ?? b) || '';
const origin = new URL(raw);
if (origin.protocol !== 'https:' || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash || origin.port)
  throw new Error('WordPress origin must be a clean HTTPS root');
if (!process.env.WP_ADMIN_USERNAME || !process.env.WP_ADMIN_PASSWORD)
  throw new Error('WordPress admin credentials unavailable');

const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.goto(`${origin.origin}/wp-login.php`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  await page.locator('#user_login').fill(process.env.WP_ADMIN_USERNAME);
  await page.locator('#user_pass').fill(process.env.WP_ADMIN_PASSWORD);
  await Promise.all([
    page.waitForURL(url => url.origin === origin.origin && url.pathname.startsWith('/wp-admin/'), { timeout: 45_000 }),
    page.locator('#wp-submit').click(),
  ]);
  await page.goto(`${origin.origin}/wp-admin/tools.php?page=esc-agent-knowledge-index`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
  const form = page.locator('form:has(input[name="action"][value="esc_agent_export_knowledge_inventory"])');
  await form.waitFor({ state: 'visible', timeout: 15_000 });
  const nonce = await form.locator('input[name="_wpnonce"]').inputValue();
  const response = await page.context().request.post(`${origin.origin}/wp-admin/admin-post.php`, {
    form: { action: 'esc_agent_export_knowledge_inventory', _wpnonce: nonce },
    timeout: 120_000,
  });
  if (!response.ok()) throw new Error('Authorized read-only inventory endpoint failed');
  const data = await response.json();
  if (data?.mode !== 'read_only' || data?.report_version !== 1 || !Array.isArray(data.sources))
    throw new Error('Unrecognized inventory report schema');
  const types = new Set(['page', 'post', 'product', 'tablepress']);
  if (!data.sources.every(row => types.has(row.type) || row.issue === 'orphan_index'))
    throw new Error('Inventory includes an unexpected source without orphan flag');
  const counts = data.counts || {};
  for (const name of ['total', 'published', 'eligible', 'vi', 'en', 'unclassified', 'missing_index', 'orphan_index']) {
    if (!Number.isSafeInteger(counts[name]) || counts[name] < 0) throw new Error(`Invalid inventory count ${name}`);
  }
  if (counts.published > counts.total || counts.vi + counts.en !== counts.eligible)
    throw new Error('Inconsistent inventory totals');
  await mkdir('audit', { recursive: true });
  await writeFile('audit/ptscps-agent-knowledge-inventory.json', JSON.stringify(data, null, 2) + '\n', { mode: 0o600 });
  console.log(`PTSCPS_AGENT_INVENTORY_READ_ONLY=PASS total=${counts.total} published=${counts.published} eligible=${counts.eligible} vi=${counts.vi} en=${counts.en} unclassified=${counts.unclassified} missing_index=${counts.missing_index} orphan_index=${counts.orphan_index}`);
} finally {
  await browser.close();
}
